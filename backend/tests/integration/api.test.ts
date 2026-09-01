import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, beforeEach, afterAll, describe, expect, test } from 'vitest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { estaContenido, seSuperpone } from '../../src/geometria.js';
import { establecimiento, lote, clima, medicionOptica, medicionRadar } from '../helpers/fixtures.js';
import { migrateTestDatabase, resetTestDatabase } from '../helpers/db.js';
import { openMeteo } from '../../src/services/open-meteo.js';
import { analizadorSatelital, type GatewayEstadisticas } from '../../src/copernicus/analizar.js';
import type { IntervaloEstadisticas, StatsCrudas } from '../../src/copernicus/types.js';
import { reiniciarRateLimitAuth } from '../../src/http/auth-rate-limit.js';

const tieneBaseDeTest = Boolean(process.env.TEST_DATABASE_URL);
const integration = tieneBaseDeTest ? describe : describe.skip;

if (!tieneBaseDeTest) console.warn('TEST_DATABASE_URL no configurada: tests de integración omitidos para no tocar DATABASE_URL.');

let app: Express;
let pool: Pool;

type Agent = ReturnType<typeof request.agent>;

async function registrar(username: string, password = 'password-segura-2026'): Promise<Agent> {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ username, password });
  expect(response.status).toBe(201);
  return agent;
}

async function crearEstablecimiento(agent: Agent) {
  const response = await agent.post('/api/establecimiento').send({ nombre: 'Campo de prueba', polygon: establecimiento });
  expect(response.status).toBe(201);
  return response.body.establecimiento;
}

async function crearLote(agent: Agent, min = 1, max = 2) {
  const response = await agent.post('/api/lotes').send({ polygon: lote(min, max) });
  expect(response.status).toBe(201);
  return response.body.lote;
}

async function prepararLote(username = `usuario_${Date.now()}_${Math.random()}`) {
  const agent = await registrar(username);
  await crearEstablecimiento(agent);
  const lot = await crearLote(agent);
  return { agent, lot };
}

async function insertarNotificacion(username: string, titulo: string, createdAt: string, opciones: { readAt?: string | null; loteId?: string | null } = {}) {
  const usuario = await pool.query<{ id: string }>('SELECT id FROM usuarios WHERE username = $1', [username]);
  const result = await pool.query(
    `INSERT INTO notificaciones (user_id, lote_id, tipo, titulo, mensaje, read_at, metadata, created_at)
     VALUES ($1, $2, 'prueba', $3, $4, $5, $6::jsonb, $7) RETURNING *`,
    [usuario.rows[0].id, opciones.loteId ?? null, titulo, `Mensaje ${titulo}`, opciones.readAt ?? null, JSON.stringify({ prueba: true }), createdAt],
  );
  return result.rows[0];
}

type EstadisticaSeed = { media?: number; mediana?: number };
type MedicionSeed = {
  fuente: 'sentinel-1' | 'sentinel-2';
  observedAt: string;
  consultedAt: string | Date;
  coberturaValida?: number;
  ndvi?: EstadisticaSeed;
  ndmi?: EstadisticaSeed;
  ndwi?: EstadisticaSeed;
  evi?: EstadisticaSeed;
  rvi?: EstadisticaSeed;
  puntaje?: number;
  categoria?: string;
  alertas?: string[];
};

async function insertarMedicion(loteId: string, payload: MedicionSeed) {
  return pool.query(
    `INSERT INTO mediciones_satelitales
       (lote_id, fuente, observed_at, consulted_at, cobertura_valida,
        ndvi_media, ndvi_mediana, ndmi_media, ndmi_mediana, ndwi_media, ndwi_mediana,
        evi_media, evi_mediana, rvi_media, rvi_mediana, puntaje, categoria, alertas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
     ON CONFLICT (lote_id, fuente, observed_at) DO UPDATE SET
       consulted_at = EXCLUDED.consulted_at,
       cobertura_valida = EXCLUDED.cobertura_valida,
       ndvi_media = EXCLUDED.ndvi_media, ndvi_mediana = EXCLUDED.ndvi_mediana,
       ndmi_media = EXCLUDED.ndmi_media, ndmi_mediana = EXCLUDED.ndmi_mediana,
       ndwi_media = EXCLUDED.ndwi_media, ndwi_mediana = EXCLUDED.ndwi_mediana,
       evi_media = EXCLUDED.evi_media, evi_mediana = EXCLUDED.evi_mediana,
       rvi_media = EXCLUDED.rvi_media, rvi_mediana = EXCLUDED.rvi_mediana,
       puntaje = EXCLUDED.puntaje, categoria = EXCLUDED.categoria, alertas = EXCLUDED.alertas`,
    [
      loteId, payload.fuente, payload.observedAt, payload.consultedAt, payload.coberturaValida ?? null,
      payload.ndvi?.media ?? null, payload.ndvi?.mediana ?? null,
      payload.ndmi?.media ?? null, payload.ndmi?.mediana ?? null,
      payload.ndwi?.media ?? null, payload.ndwi?.mediana ?? null,
      payload.evi?.media ?? null, payload.evi?.mediana ?? null,
      payload.rvi?.media ?? null, payload.rvi?.mediana ?? null,
      payload.puntaje ?? null, payload.categoria ?? null, JSON.stringify(payload.alertas ?? null),
    ],
  );
}

async function insertarClima(loteId: string, payload = clima('manual')): Promise<string> {
  const consulta = await pool.query<{ id: string }>(
    `INSERT INTO consultas_clima
       (lote_id, consulted_at, lluvia_ultimos_7_dias, lluvia_proximos_dias, categoria, origen)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [loteId, new Date(payload.consultedAt), payload.lluviaUltimos7Dias, payload.lluviaProximosDias, payload.categoria, payload.origen],
  );
  for (const dia of payload.dias) {
    await pool.query(
      `INSERT INTO dias_clima (consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max, es_pronostico)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [consulta.rows[0].id, dia.fecha, dia.lluviaMm, dia.tempMin, dia.tempMax, dia.esPronostico],
    );
  }
  return consulta.rows[0].id;
}

function registroClima(offset = 0, lluviaFaltante = false) {
  const fechas = Array.from({ length: 12 }, (_, i) => `2026-08-${String(10 + i).padStart(2, '0')}`);
  const lluvias: Array<number | null> = Array(12).fill(1 + offset);
  if (lluviaFaltante) lluvias[2] = null;
  return { daily: {
    time: fechas,
    precipitation_sum: lluvias,
    temperature_2m_max: Array(12).fill(20 + offset),
    temperature_2m_min: Array(12).fill(8 + offset),
  } };
}

function fechaUtc(diasAtras: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - diasAtras);
  return date.toISOString().slice(0, 10);
}

function statsSatelital(media: number): StatsCrudas {
  return { min: -0.2, max: 0.8, mean: media, stDev: 0.1, sampleCount: 100, noDataCount: 10, percentiles: { '50.0': media + 0.01 } };
}

function intervaloS2(fecha = fechaUtc(1)): IntervaloEstadisticas {
  const output = (media: number) => ({ bands: { B0: { stats: statsSatelital(media) } } });
  return { interval: { from: `${fecha}T00:00:00Z`, to: `${fecha}T23:59:59Z` }, outputs: { ndvi: output(0.49), ndmi: output(0.125), ndwi: output(-0.1), evi: output(0.325) } };
}

function intervaloS1(fecha = fechaUtc(0)): IntervaloEstadisticas {
  return { interval: { from: `${fecha}T00:00:00Z`, to: `${fecha}T23:59:59Z` }, outputs: { rvi: { bands: { B0: { stats: statsSatelital(0.6) } } } } };
}

function gatewaySatelital(optico: IntervaloEstadisticas[] = [intervaloS2()], radar: IntervaloEstadisticas[] = []): GatewayEstadisticas {
  return { obtenerEstadisticas: async (cuerpo) => ({ status: 200, texto: JSON.stringify({ data: JSON.parse(cuerpo).input.data[0].type === 'sentinel-2-l2a' ? optico : radar }) }) };
}

integration('API backend de RODEO', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'https://app.rodeo.test';
    const modules = await Promise.all([import('../../src/app.mjs'), import('../../src/base-datos/pool.js')]);
    app = modules[0].app;
    pool = modules[1].pool;
    await migrateTestDatabase(pool);
  });

  beforeEach(async () => {
    await reiniciarRateLimitAuth();
    await resetTestDatabase(pool);
  });

  afterAll(async () => { await pool.end(); });

  describe('health y autenticación', () => {
    test('health responde ok y comprueba la base', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', database: 'ok' });
      expect((await request(app).get('/api/health/live')).body).toEqual({ status: 'ok' });
      expect((await request(app).get('/api/health/ready')).body).toEqual({ status: 'ok', database: 'ok' });
    });

    test('registra username trimmeado, hash y onboarding pendiente', async () => {
      const agent = request.agent(app);
      const response = await agent.post('/api/auth/register').send({ username: '  ana  ', password: 'password-segura-2026' });
      expect(response.status).toBe(201);
      expect(response.body.user.username).toBe('ana');
      expect(response.body.user.onboardingCompleted).toBe(false);
      expect(JSON.stringify(response.body)).not.toContain('password_hash');
      const row = await pool.query('SELECT username, password_hash, onboarding_completed_at FROM usuarios WHERE username = $1', ['ana']);
      expect(row.rows[0].password_hash).not.toBe('password-segura-2026');
      expect(row.rows[0].onboarding_completed_at).toBeNull();
    });

    test('rechaza payload inválido y username duplicado', async () => {
      const agent = request.agent(app);
      expect((await agent.post('/api/auth/register').send({ username: 'corto', password: '123' })).status).toBe(400);
      expect((await agent.post('/api/auth/register').send({ username: 'duplicado', password: 'password-segura-2026' })).status).toBe(201);
      const duplicate = await request(app).post('/api/auth/register').send({ username: 'duplicado', password: 'password-segura-2026' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('USERNAME_TAKEN');
    });

    test('login no filtra usuario inexistente, crea cookie HttpOnly y /me devuelve la sesión', async () => {
      await registrar('login_user');
      const wrongUser = await request(app).post('/api/auth/login').send({ username: 'no_existe', password: 'password-segura-2026' });
      const wrongPassword = await request(app).post('/api/auth/login').send({ username: 'login_user', password: 'incorrecta-2026' });
      expect(wrongUser.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect(wrongUser.body.error.code).toBe('INVALID_CREDENTIALS');
      const agent = request.agent(app);
      const login = await agent.post('/api/auth/login').send({ username: 'login_user', password: 'password-segura-2026' });
      expect(login.status).toBe(200);
      const cookie = login.headers['set-cookie'][0];
      expect(cookie).toMatch(/rodeo_session=.*HttpOnly/);
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).not.toMatch(/;\s*Secure/i);
      expect(login.body).not.toHaveProperty('token');
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.username).toBe('login_user');
      expect(me.body.user.onboardingCompleted).toBe(false);
    });

    test('logout invalida el flujo de sesión del agente', async () => {
      const agent = await registrar('logout_user');
      expect((await agent.post('/api/auth/logout')).status).toBe(204);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
    });
  });

  describe('gateway Copernicus', () => {
    test('rechaza usuario sin sesión', async () => {
      expect((await request(app).get('/api/copernicus/estado')).status).toBe(401);
      expect((await request(app).post('/api/copernicus/statistics').send({})).status).toBe(401);
    });

    test('estado refleja credenciales opcionales', async () => {
      const anteriorId = process.env.COPERNICUS_CLIENT_ID;
      const anteriorSecret = process.env.COPERNICUS_CLIENT_SECRET;
      try {
        const { agent } = await prepararLote('copernicus_state_user');
        delete process.env.COPERNICUS_CLIENT_ID;
        delete process.env.COPERNICUS_CLIENT_SECRET;
        expect((await agent.get('/api/copernicus/estado')).body).toEqual({ configurado: false });
        process.env.COPERNICUS_CLIENT_ID = 'id-de-prueba';
        process.env.COPERNICUS_CLIENT_SECRET = 'secret-de-prueba';
        expect((await agent.get('/api/copernicus/estado')).body).toEqual({ configurado: true });
      } finally {
        if (anteriorId === undefined) delete process.env.COPERNICUS_CLIENT_ID; else process.env.COPERNICUS_CLIENT_ID = anteriorId;
        if (anteriorSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET; else process.env.COPERNICUS_CLIENT_SECRET = anteriorSecret;
      }
    });

    test('ya no expone el proxy raw de statistics a usuarios autenticados', async () => {
      const { agent } = await prepararLote('copernicus_raw_removed_user');
      expect((await agent.post('/api/copernicus/statistics').send({ input: {} })).status).toBe(404);
    });
  });

  describe('actualización satelital centralizada', () => {
    test('requiere sesión y valida UUID e input batch', async () => {
      expect((await request(app).post(`/api/lotes/${crypto.randomUUID()}/satelite/actualizar`)).status).toBe(401);
      const { agent } = await prepararLote('satellite_update_validation_user');
      expect((await agent.post('/api/lotes/no-es-uuid/satelite/actualizar')).body.error.code).toBe('INVALID_LOT_ID');
      for (const loteIds of [undefined, 'no-array', [], ['no-es-uuid']]) {
        expect((await agent.post('/api/lotes/satelite/actualizar').send({ loteIds })).body.error.code).toBe('INVALID_LOT_IDS');
      }
    });

    test('no revela lotes ajenos ni soft-deleted y no consulta el upstream', async () => {
      const owner = await prepararLote('satellite_update_owner');
      const other = await prepararLote('satellite_update_other');
      let llamadas = 0;
      const anterior = analizadorSatelital.reemplazarGateway({ obtenerEstadisticas: async () => { llamadas += 1; return { status: 200, texto: '{"data":[]}' }; } });
      try {
        expect((await other.agent.post(`/api/lotes/${owner.lot.id}/satelite/actualizar`)).body.error.code).toBe('LOT_NOT_FOUND');
        await owner.agent.delete(`/api/lotes/${owner.lot.id}`);
        expect((await owner.agent.post(`/api/lotes/${owner.lot.id}/satelite/actualizar`)).body.error.code).toBe('LOT_NOT_FOUND');
        expect(llamadas).toBe(0);
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });

    test('credenciales ausentes producen un error controlado y no crean historial', async () => {
      const { agent, lot } = await prepararLote('satellite_update_missing_credentials_user');
      const anteriorId = process.env.COPERNICUS_CLIENT_ID;
      const anteriorSecret = process.env.COPERNICUS_CLIENT_SECRET;
      const anteriorGateway = analizadorSatelital.reemplazarGateway((await import('../../src/services/copernicus.js')).copernicus);
      try {
        delete process.env.COPERNICUS_CLIENT_ID;
        delete process.env.COPERNICUS_CLIENT_SECRET;
        const response = await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`);
        expect(response.status).toBe(200);
        expect(response.body.resultado).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('no está configurado') });
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM mediciones_satelitales WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(0);
      } finally {
        analizadorSatelital.reemplazarGateway(anteriorGateway);
        if (anteriorId === undefined) delete process.env.COPERNICUS_CLIENT_ID; else process.env.COPERNICUS_CLIENT_ID = anteriorId;
        if (anteriorSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET; else process.env.COPERNICUS_CLIENT_SECRET = anteriorSecret;
      }
    });

    test('consulta S2 con el polígono de DB, devuelve ResultadoLote y persiste usando reloj servidor', async () => {
      const { agent, lot } = await prepararLote('satellite_update_s2_user');
      let cuerpo: Record<string, any> | null = null;
      const base = gatewaySatelital();
      const anterior = analizadorSatelital.reemplazarGateway({ obtenerEstadisticas: async (requestBody) => { const parsed = JSON.parse(requestBody); if (parsed.input.data[0].type === 'sentinel-2-l2a') cuerpo = parsed; return base.obtenerEstadisticas(requestBody); } });
      try {
        const antes = Date.now();
        const response = await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`);
        expect(response.status).toBe(200);
        expect(response.body.resultado).toMatchObject({ estado: 'ok', loteId: lot.id, condicion: { fecha: fechaUtc(1), categoria: 'buena' } });
        expect((cuerpo as Record<string, any> | null)?.input.bounds.geometry).toEqual(lot.polygon.geometry);
        const rows = await pool.query('SELECT fuente, observed_at, consulted_at, ndvi_mediana, alertas FROM mediciones_satelitales WHERE lote_id = $1', [lot.id]);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].fuente).toBe('sentinel-2');
        expect(rows.rows[0].observed_at).toBe(fechaUtc(1));
        expect(rows.rows[0].consulted_at.getTime()).toBeGreaterThanOrEqual(antes);
        expect(rows.rows[0].alertas).toEqual([]);
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });

    test('repetir observed_at hace upsert y no duplica', async () => {
      const { agent, lot } = await prepararLote('satellite_update_upsert_user');
      const anterior = analizadorSatelital.reemplazarGateway(gatewaySatelital());
      try {
        expect((await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`)).status).toBe(200);
        expect((await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`)).status).toBe(200);
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM mediciones_satelitales WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(1);
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });

    test('persiste S1 y S2 en filas separadas cuando radar gana por frescura', async () => {
      const { agent, lot } = await prepararLote('satellite_update_radar_user');
      const anterior = analizadorSatelital.reemplazarGateway(gatewaySatelital([intervaloS2(fechaUtc(3))], [intervaloS1(fechaUtc(0))]));
      try {
        const response = await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`);
        expect(response.body.resultado).toMatchObject({ estado: 'radar', loteId: lot.id, optico: { fecha: fechaUtc(3) } });
        const rows = await pool.query('SELECT fuente, ndvi_mediana, rvi_mediana, consulted_at FROM mediciones_satelitales WHERE lote_id = $1 ORDER BY fuente', [lot.id]);
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows.map((row) => row.fuente)).toEqual(['sentinel-1', 'sentinel-2']);
        expect(rows.rows[0].ndvi_mediana).toBeNull();
        expect(rows.rows[1].rvi_mediana).toBeNull();
        expect(rows.rows[0].consulted_at.toISOString()).toBe(rows.rows[1].consulted_at.toISOString());
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });

    test('error upstream y sin datos devuelven estado explícito sin persistir', async () => {
      const { agent, lot } = await prepararLote('satellite_update_no_data_user');
      let anterior = analizadorSatelital.reemplazarGateway({ obtenerEstadisticas: async (cuerpo) => JSON.parse(cuerpo).input.data[0].type === 'sentinel-2-l2a' ? { status: 429, texto: '{}' } : { status: 200, texto: '{"data":[]}' } });
      try {
        expect((await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`)).body.resultado).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('(429)') });
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
      anterior = analizadorSatelital.reemplazarGateway(gatewaySatelital([], []));
      try {
        expect((await agent.post(`/api/lotes/${lot.id}/satelite/actualizar`)).body.resultado.estado).toBe('sin-datos');
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM mediciones_satelitales WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(0);
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });

    test('batch mantiene asociación, valida ownership conjunto y limita a dos lotes simultáneos', async () => {
      const agent = await registrar('satellite_update_batch_user');
      await crearEstablecimiento(agent);
      const lotes = [await crearLote(agent, 1, 2), await crearLote(agent, 3, 4), await crearLote(agent, 5, 6)];
      const ajeno = await prepararLote('satellite_update_batch_other');
      let activas = 0;
      let maximas = 0;
      const anterior = analizadorSatelital.reemplazarGateway({ obtenerEstadisticas: async (cuerpo) => {
        activas += 1; maximas = Math.max(maximas, activas);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activas -= 1;
        return { status: 200, texto: JSON.stringify({ data: JSON.parse(cuerpo).input.data[0].type === 'sentinel-2-l2a' ? [intervaloS2()] : [] }) };
      } });
      try {
        const response = await agent.post('/api/lotes/satelite/actualizar').send({ loteIds: lotes.map((item) => item.id) });
        expect(response.status).toBe(200);
        expect(response.body.resultados.map((item: { loteId: string }) => item.loteId)).toEqual(lotes.map((item) => item.id));
        expect(maximas).toBeLessThanOrEqual(4);
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM mediciones_satelitales WHERE lote_id = ANY($1::uuid[])', [lotes.map((item) => item.id)])).rows[0].count).toBe(3);
        expect((await agent.post('/api/lotes/satelite/actualizar').send({ loteIds: [lotes[0].id, ajeno.lot.id] })).body.error.code).toBe('LOT_NOT_FOUND');
      } finally { analizadorSatelital.reemplazarGateway(anterior); }
    });
  });

  describe('actualización climática centralizada', () => {
    test('requiere sesión, valida IDs y origen, y retira escrituras legacy', async () => {
      expect((await request(app).post('/api/lotes/clima/actualizar').send({ loteIds: [], origen: 'manual' })).status).toBe(401);
      const { agent, lot } = await prepararLote('climate_update_validation_user');
      expect((await agent.post('/api/lotes/no-es-uuid/clima/actualizar').send({ origen: 'manual' })).body.error.code).toBe('INVALID_LOT_ID');
      expect((await agent.post('/api/lotes/clima/actualizar').send({ loteIds: 'no-array', origen: 'manual' })).body.error.code).toBe('INVALID_LOT_IDS');
      expect((await agent.post('/api/lotes/clima/actualizar').send({ loteIds: [lot.id], origen: 'desconocido' })).body.error.code).toBe('INVALID_CLIMATE_ORIGIN');
      expect((await agent.post('/api/clima/consultar').send({ loteIds: [lot.id] })).status).toBe(404);
      expect((await agent.post(`/api/lotes/${lot.id}/clima`).send(clima())).status).toBe(404);
      expect((await agent.post(`/api/lotes/${lot.id}/mediciones-satelitales`).send(medicionOptica)).status).toBe(404);
    });

    test('consulta y persiste un lote con polygon y reloj del backend', async () => {
      const { agent, lot } = await prepararLote('climate_update_single_user');
      let urlConsultada = '';
      const anterior = openMeteo.reemplazarTransporte(async (url) => {
        urlConsultada = url;
        return { ok: true, status: 200, json: async () => registroClima() };
      });
      try {
        const antes = Date.now();
        const response = await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({
          origen: 'manual',
          lluviaUltimos7Dias: 999,
          consultedAt: '2000-01-01T00:00:00.000Z',
        });
        expect(response.status).toBe(200);
        expect(response.body.resultado).toMatchObject({ estado: 'ok', loteId: lot.id, persistencia: { guardado: true } });
        expect(new URL(urlConsultada).searchParams.get('latitude')).toBe('1.5000');
        const consultas = await pool.query('SELECT consulted_at, lluvia_ultimos_7_dias, origen FROM consultas_clima WHERE lote_id = $1', [lot.id]);
        expect(consultas.rows).toHaveLength(1);
        expect(consultas.rows[0].consulted_at.getTime()).toBeGreaterThanOrEqual(antes);
        expect(consultas.rows[0].lluvia_ultimos_7_dias).toBe(7);
        expect(consultas.rows[0].origen).toBe('manual');
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM dias_clima')).rows[0].count).toBe(12);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('batch usa una llamada multi-coordinate, mantiene asociación y aísla resultados inválidos', async () => {
      const agent = await registrar('climate_update_batch_user');
      await crearEstablecimiento(agent);
      const first = await crearLote(agent, 1, 2);
      const second = await crearLote(agent, 3, 4);
      let llamadas = 0;
      const anterior = openMeteo.reemplazarTransporte(async (url) => {
        llamadas += 1;
        expect(new URL(url).searchParams.get('latitude')?.split(',')).toHaveLength(2);
        return { ok: true, status: 200, json: async () => [registroClima(), { daily: { time: [] } }] };
      });
      try {
        const response = await agent.post('/api/lotes/clima/actualizar').send({ loteIds: [first.id, second.id], origen: 'manual' });
        expect(response.status).toBe(200);
        expect(Object.keys(response.body.resultados)).toEqual([first.id, second.id]);
        expect(response.body.resultados[first.id].estado).toBe('ok');
        expect(response.body.resultados[second.id].estado).toBe('error');
        expect(llamadas).toBe(1);
        const filas = await pool.query('SELECT lote_id FROM consultas_clima ORDER BY lote_id');
        expect(filas.rows.map((row) => row.lote_id)).toEqual([first.id]);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('rechaza lote ajeno y soft-deleted sin consultar Open-Meteo', async () => {
      const owner = await prepararLote('climate_update_owner');
      const other = await prepararLote('climate_update_other');
      let llamadas = 0;
      const anterior = openMeteo.reemplazarTransporte(async () => { llamadas += 1; return { ok: true, status: 200, json: async () => registroClima() }; });
      try {
        expect((await other.agent.post('/api/lotes/clima/actualizar').send({ loteIds: [owner.lot.id], origen: 'manual' })).body.error.code).toBe('LOT_NOT_FOUND');
        await owner.agent.delete(`/api/lotes/${owner.lot.id}`);
        expect((await owner.agent.post(`/api/lotes/${owner.lot.id}/clima/actualizar`).send({ origen: 'manual' })).body.error.code).toBe('LOT_NOT_FOUND');
        expect(llamadas).toBe(0);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('batch valida ownership completo antes del upstream y no persiste parcialmente', async () => {
      const owner = await prepararLote('climate_batch_owner');
      const other = await prepararLote('climate_batch_other');
      let llamadas = 0;
      const anterior = openMeteo.reemplazarTransporte(async () => { llamadas += 1; return { ok: true, status: 200, json: async () => registroClima() }; });
      try {
        const response = await owner.agent.post('/api/lotes/clima/actualizar').send({ loteIds: [owner.lot.id, other.lot.id], origen: 'manual' });
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('LOT_NOT_FOUND');
        expect(llamadas).toBe(0);
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM consultas_clima')).rows[0].count).toBe(0);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('no persiste errores upstream y preserva null sin inventar cero', async () => {
      const { agent, lot } = await prepararLote('climate_update_null_user');
      let anterior = openMeteo.reemplazarTransporte(async () => ({ ok: false, status: 503, json: async () => ({}) }));
      try {
        expect((await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' })).body.resultado.estado).toBe('error');
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM consultas_clima')).rows[0].count).toBe(0);
      } finally { openMeteo.reemplazarTransporte(anterior); }

      anterior = openMeteo.reemplazarTransporte(async () => ({ ok: true, status: 200, json: async () => registroClima(0, true) }));
      try {
        const response = await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' });
        expect(response.body.resultado).toMatchObject({ estado: 'ok', categoria: null, clima: { lluviaUltimos7Dias: null } });
        const fila = await pool.query('SELECT lluvia_ultimos_7_dias, categoria FROM consultas_clima WHERE lote_id = $1', [lot.id]);
        expect(fila.rows[0]).toMatchObject({ lluvia_ultimos_7_dias: null, categoria: null });
        const dia = await pool.query("SELECT lluvia_mm FROM dias_clima WHERE fecha = '2026-08-12'::date");
        expect(dia.rows[0].lluvia_mm).toBeNull();
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('datos meteorológicos completamente ausentes producen error sin historial', async () => {
      const { agent, lot } = await prepararLote('climate_update_missing_data_user');
      const anterior = openMeteo.reemplazarTransporte(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ daily: { time: registroClima().daily.time, precipitation_sum: Array(12).fill(null) } }),
      }));
      try {
        const response = await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' });
        expect(response.body.resultado).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('Sin datos') });
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM consultas_clima WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(0);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('deduplica automáticas concurrentes de forma atómica y conserva manuales', async () => {
      const { agent, lot } = await prepararLote('climate_update_dedupe_user');
      const anterior = openMeteo.reemplazarTransporte(async () => ({ ok: true, status: 200, json: async () => registroClima() }));
      try {
        const automáticas = await Promise.all([
          agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'automatico' }),
          agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'automatico' }),
        ]);
        expect(automáticas.every((response) => response.status === 200)).toBe(true);
        expect(automáticas.map((response) => response.body.resultado.persistencia.guardado).sort()).toEqual([false, true]);
        expect((await pool.query("SELECT COUNT(*)::int AS count FROM consultas_clima WHERE lote_id = $1 AND origen = 'automatico'", [lot.id])).rows[0].count).toBe(1);
        await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' });
        await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' });
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM consultas_clima WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(3);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });

    test('una manual reciente no bloquea la primera automática', async () => {
      const { agent, lot } = await prepararLote('climate_update_origin_scope_user');
      const anterior = openMeteo.reemplazarTransporte(async () => ({ ok: true, status: 200, json: async () => registroClima() }));
      try {
        await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'manual' });
        const automatico = await agent.post(`/api/lotes/${lot.id}/clima/actualizar`).send({ origen: 'automatico' });
        expect(automatico.body.resultado.persistencia.guardado).toBe(true);
        const origenes = await pool.query('SELECT origen FROM consultas_clima WHERE lote_id = $1 ORDER BY created_at', [lot.id]);
        expect(origenes.rows.map((row) => row.origen)).toEqual(['manual', 'automatico']);
      } finally { openMeteo.reemplazarTransporte(anterior); }
    });
  });

  describe('notificaciones', () => {
    test('requiere sesión para listar y marcar', async () => {
      expect((await request(app).get('/api/notificaciones')).status).toBe(401);
      expect((await request(app).patch('/api/notificaciones/leidas')).status).toBe(401);
    });

    test('aísla usuarios, ordena, pagina, filtra y calcula noLeidas globales', async () => {
      const owner = await registrar('notifications_owner');
      await registrar('notifications_other');
      await insertarNotificacion('notifications_owner', 'Primera', '2026-08-20T10:00:00.000Z');
      await insertarNotificacion('notifications_owner', 'Segunda', '2026-08-20T11:00:00.000Z', { readAt: '2026-08-20T11:30:00.000Z' });
      await insertarNotificacion('notifications_owner', 'Tercera', '2026-08-20T12:00:00.000Z');
      await insertarNotificacion('notifications_other', 'Ajena', '2026-08-20T13:00:00.000Z');

      const pagina = await owner.get('/api/notificaciones?limit=2&offset=0');
      expect(pagina.status).toBe(200);
      expect(pagina.body.notificaciones.map((item: { titulo: string }) => item.titulo)).toEqual(['Tercera', 'Segunda']);
      expect(pagina.body.noLeidas).toBe(2);
      expect(pagina.body.paginacion).toEqual({ limit: 2, offset: 0, total: 3, hayMas: true });
      expect(JSON.stringify(pagina.body)).not.toContain('Ajena');

      const noLeidas = await owner.get('/api/notificaciones?soloNoLeidas=true');
      expect(noLeidas.body.notificaciones.map((item: { titulo: string }) => item.titulo)).toEqual(['Tercera', 'Primera']);
      expect(noLeidas.body.paginacion.total).toBe(2);
      expect((await owner.get('/api/notificaciones?limit=0')).status).toBe(400);
      expect((await owner.get('/api/notificaciones?soloNoLeidas=si')).status).toBe(400);
    });

    test('marca una de forma idempotente y oculta notificaciones ajenas', async () => {
      const owner = await registrar('notifications_mark_owner');
      const other = await registrar('notifications_mark_other');
      const item = await insertarNotificacion('notifications_mark_owner', 'Pendiente', '2026-08-20T12:00:00.000Z');
      const primera = await owner.patch(`/api/notificaciones/${item.id}/leida`);
      expect(primera.status).toBe(200);
      expect(primera.body.notificacion.leida).toBe(true);
      const readAt = primera.body.notificacion.readAt;
      const segunda = await owner.patch(`/api/notificaciones/${item.id}/leida`);
      expect(segunda.body.notificacion.readAt).toBe(readAt);
      expect((await other.patch(`/api/notificaciones/${item.id}/leida`)).status).toBe(404);
      expect((await owner.patch('/api/notificaciones/id-invalido/leida')).status).toBe(400);
    });

    test('marca todas sólo para el usuario y conserva read_at existente', async () => {
      const owner = await registrar('notifications_all_owner');
      await registrar('notifications_all_other');
      const previa = '2026-08-19T09:00:00.000Z';
      const leida = await insertarNotificacion('notifications_all_owner', 'Ya leída', '2026-08-19T08:00:00.000Z', { readAt: previa });
      await insertarNotificacion('notifications_all_owner', 'Nueva 1', '2026-08-20T10:00:00.000Z');
      await insertarNotificacion('notifications_all_owner', 'Nueva 2', '2026-08-20T11:00:00.000Z');
      const ajena = await insertarNotificacion('notifications_all_other', 'Ajena pendiente', '2026-08-20T12:00:00.000Z');
      const response = await owner.patch('/api/notificaciones/leidas');
      expect(response.body).toEqual({ actualizadas: 2 });
      const rows = await pool.query('SELECT id, read_at FROM notificaciones WHERE id = ANY($1::uuid[]) ORDER BY id', [[leida.id, ajena.id]]);
      expect(new Date(rows.rows.find((row) => row.id === leida.id).read_at).toISOString()).toBe(previa);
      expect(rows.rows.find((row) => row.id === ajena.id).read_at).toBeNull();
      expect((await owner.get('/api/notificaciones')).body.noLeidas).toBe(0);
    });
  });

  describe('establecimiento y onboarding', () => {
    test('crea, lee, renombra y rechaza un segundo establecimiento', async () => {
      const agent = await registrar('establecimiento_user');
      expect((await agent.get('/api/establecimiento')).body.establecimiento).toBeNull();
      await crearEstablecimiento(agent);
      expect((await agent.post('/api/establecimiento').send({ nombre: 'Otro', polygon: establecimiento })).body.error.code).toBe('ESTABLISHMENT_EXISTS');
      const patch = await agent.patch('/api/establecimiento').send({ nombre: 'Campo renombrado' });
      expect(patch.status).toBe(200);
      expect(patch.body.establecimiento.nombre).toBe('Campo renombrado');
      expect((await agent.post('/api/establecimiento').send({ nombre: '', polygon: establecimiento })).body.error.code).toBe('INVALID_NAME');
      expect((await agent.post('/api/establecimiento').send({ nombre: 'Invalido', polygon: { type: 'Point' } })).body.error.code).toBe('INVALID_POLYGON');
    });

    test('el primer lote completa onboarding y /me lo refleja', async () => {
      const { agent } = await prepararLote('onboarding_user');
      const me = await agent.get('/api/auth/me');
      expect(me.body.user.onboardingCompleted).toBe(true);
    });
  });

  describe('aislamiento y geometría', () => {
    test('un usuario no puede operar sobre establecimiento, lote ni historial ajenos', async () => {
      const owner = await prepararLote('owner_user');
      const other = await registrar('other_user');
      expect((await other.get('/api/establecimiento')).body.establecimiento).toBeNull();
      expect((await other.get('/api/lotes')).status).toBe(409);
      const paths = [
        other.patch(`/api/lotes/${owner.lot.id}`).send({ activo: false }),
        other.delete(`/api/lotes/${owner.lot.id}`),
        other.get(`/api/lotes/${owner.lot.id}/historial`),
        other.post(`/api/lotes/${owner.lot.id}/satelite/actualizar`),
        other.post(`/api/lotes/${owner.lot.id}/clima/actualizar`).send({ origen: 'manual' }),
        other.post(`/api/lotes/${owner.lot.id}/usos`).send({ fecha: '2026-08-20' }),
        other.get(`/api/lotes/${owner.lot.id}/estado`),
      ];
      for (const response of await Promise.all(paths)) expect(response.status).toBe(404);
    });

    test('rechaza lotes fuera, parcialmente fuera y superpuestos', async () => {
      const agent = await registrar('geometry_create_user');
      await crearEstablecimiento(agent);
      expect((await agent.post('/api/lotes').send({ polygon: lote(20, 21) })).body.error.code).toBe('LOT_OUTSIDE_ESTABLISHMENT');
      expect((await agent.post('/api/lotes').send({ polygon: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[9, 9], [11, 9], [11, 11], [9, 11], [9, 9]]] } } })).body.error.code).toBe('LOT_OUTSIDE_ESTABLISHMENT');
      await crearLote(agent, 1, 3);
      expect((await agent.post('/api/lotes').send({ polygon: lote(2, 4) })).body.error.code).toBe('LOT_OVERLAPS_EXISTING');
    });

    test('edición de establecimiento protege lotes activos e inactivos, pero no soft-deleted', async () => {
      const agent = await registrar('boundary_user');
      await crearEstablecimiento(agent);
      const lot = await crearLote(agent, 6, 8);
      const invalid = await agent.patch('/api/establecimiento').send({ polygon: lote(0, 7) });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('ESTABLISHMENT_GEOMETRY_INVALID');
      expect((await agent.get('/api/establecimiento')).body.establecimiento.polygon).toEqual(establecimiento);
      expect((await agent.patch(`/api/lotes/${lot.id}`).send({ activo: false })).status).toBe(200);
      expect((await agent.patch('/api/establecimiento').send({ polygon: lote(0, 7) })).status).toBe(400);
      expect((await agent.delete(`/api/lotes/${lot.id}`)).status).toBe(204);
      expect((await agent.patch('/api/establecimiento').send({ polygon: lote(0, 7) })).status).toBe(200);
    });

    test('edita un lote, pero conserva el polygon anterior cuando falla', async () => {
      const agent = await registrar('lot_edit_user');
      await crearEstablecimiento(agent);
      const first = await crearLote(agent, 1, 2);
      await crearLote(agent, 4, 5);
      expect((await agent.patch(`/api/lotes/${first.id}`).send({ polygon: lote(2, 3) })).status).toBe(200);
      const outside = await agent.patch(`/api/lotes/${first.id}`).send({ polygon: lote(9, 11) });
      expect(outside.body.error.code).toBe('LOT_OUTSIDE_ESTABLISHMENT');
      const overlap = await agent.patch(`/api/lotes/${first.id}`).send({ polygon: lote(4.2, 4.8) });
      expect(overlap.body.error.code).toBe('LOT_OVERLAPS_EXISTING');
      const row = await pool.query('SELECT polygon FROM lotes WHERE id = $1', [first.id]);
      expect(row.rows[0].polygon).toEqual(lote(2, 3));
    });
  });

  describe('lotes, numeración, soft delete y estado', () => {
    test('asigna números históricos y no reutiliza el de un lote eliminado', async () => {
      const agent = await registrar('numbering_user');
      await crearEstablecimiento(agent);
      const first = await crearLote(agent, 1, 2);
      const second = await crearLote(agent, 3, 4);
      expect(second.numero).toBe(2);
      expect((await agent.delete(`/api/lotes/${second.id}`)).status).toBe(204);
      const third = await crearLote(agent, 5, 6);
      expect(third.numero).toBe(3);
      expect((await agent.delete(`/api/lotes/${second.id}`)).body.error.code).toBe('LOT_NOT_FOUND');
      const dbRow = await pool.query('SELECT deleted_at FROM lotes WHERE id = $1', [second.id]);
      expect(dbRow.rows[0].deleted_at).not.toBeNull();
      const list = await agent.get('/api/lotes');
      expect(list.body.lotes.map((item: { id: string }) => item.id)).toEqual([first.id, third.id]);
    });

    test('persiste activar y desactivar un lote', async () => {
      const { agent, lot } = await prepararLote('active_user');
      expect((await agent.patch(`/api/lotes/${lot.id}`).send({ activo: false })).body.lote.activo).toBe(false);
      expect((await agent.patch(`/api/lotes/${lot.id}`).send({ activo: true })).body.lote.activo).toBe(true);
      expect((await pool.query('SELECT activo FROM lotes WHERE id = $1', [lot.id])).rows[0].activo).toBe(true);
    });
  });

  describe('lectura de persistencia satelital', () => {
    test('mantiene fuentes separadas, upsert, DATE y TIMESTAMPTZ al leer historial', async () => {
      const { agent, lot } = await prepararLote('satellite_history_user');
      await insertarMedicion(lot.id, medicionOptica);
      await insertarMedicion(lot.id, { ...medicionOptica, consultedAt: '2026-08-20T13:00:00.000Z', puntaje: 90, alertas: ['actualizada'] });
      await insertarMedicion(lot.id, medicionRadar);
      const response = await agent.get(`/api/lotes/${lot.id}/mediciones-satelitales`);
      expect(response.status).toBe(200);
      expect(response.body.mediciones).toHaveLength(2);
      expect(response.body.mediciones.find((item: { fuente: string }) => item.fuente === 'sentinel-2')).toMatchObject({
        observedAt: '2026-08-16',
        consultedAt: '2026-08-20T13:00:00.000Z',
        puntaje: 90,
        alertas: ['actualizada'],
      });
      expect(response.body.mediciones.find((item: { fuente: string }) => item.fuente === 'sentinel-1').rvi.mediana).toBe(0.62);
    });
  });

  describe('usos e historial consolidado', () => {
    test('conserva usos múltiples y los ordena por fecha descendente', async () => {
      const { agent, lot } = await prepararLote('usage_user');
      await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2026-08-14' });
      await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2026-08-20' });
      const response = await agent.get(`/api/lotes/${lot.id}/usos`);
      expect(response.status).toBe(200);
      expect(response.body.usos.map((item: { fecha: string }) => item.fecha)).toEqual(['2026-08-20', '2026-08-14']);
      expect(response.body.usos[0].createdAt).toMatch(/T/);
      expect((await pool.query('SELECT COUNT(*)::int AS count FROM usos_lote WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(2);
    });

    test('rechaza fechas de uso futuras en el backend', async () => {
      const { agent, lot } = await prepararLote('future_usage_user');
      const response = await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2999-01-01' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('FUTURE_USE_DATE');
      expect((await pool.query('SELECT COUNT(*)::int AS count FROM usos_lote WHERE lote_id = $1', [lot.id])).rows[0].count).toBe(0);
    });

    test('historial devuelve satélite, clima y usos únicamente del lote pedido', async () => {
      const { agent, lot } = await prepararLote('history_user');
      await insertarMedicion(lot.id, medicionRadar);
      await insertarClima(lot.id);
      await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2026-08-20' });
      const history = await agent.get(`/api/lotes/${lot.id}/historial`);
      expect(history.status).toBe(200);
      expect(history.body.satelite).toHaveLength(1);
      expect(history.body.clima).toHaveLength(1);
      expect(history.body.usos).toHaveLength(1);
      expect(history.body.satelite[0].fuente).toBe('sentinel-1');
    });

    test('historial climático expone el origen persistido, incluido legacy', async () => {
      const { agent, lot } = await prepararLote('history_climate_origin_user');
      await insertarClima(lot.id, { ...clima('manual'), origen: 'legacy' as never });
      const response = await agent.get(`/api/lotes/${lot.id}/clima`);
      expect(response.status).toBe(200);
      expect(response.body.consultas[0].origen).toBe('legacy');
    });
  });

  describe('paginación y filtros de historial', () => {
    test('pagina mediciones con total y hayMas, y filtra por fuente y fechas', async () => {
      const { agent, lot } = await prepararLote('pagination_satellite_user');
      for (const [fuente, fechas] of [['sentinel-2', ['2026-08-16', '2026-08-17', '2026-08-18']], ['sentinel-1', ['2026-08-10']]] as const) {
        for (const observedAt of fechas) await insertarMedicion(lot.id, { ...(fuente === 'sentinel-2' ? medicionOptica : medicionRadar), fuente, observedAt });
      }
      const primera = await agent.get(`/api/lotes/${lot.id}/mediciones-satelitales?limit=2&offset=0`);
      expect(primera.body.mediciones).toHaveLength(2);
      expect(primera.body.mediciones.map((item: { observedAt: string }) => item.observedAt)).toEqual(['2026-08-18', '2026-08-17']);
      expect(primera.body.paginacion).toEqual({ limit: 2, offset: 0, total: 4, hayMas: true });
      const segunda = await agent.get(`/api/lotes/${lot.id}/mediciones-satelitales?limit=2&offset=2`);
      expect(segunda.body.mediciones).toHaveLength(2);
      const soloRadar = await agent.get(`/api/lotes/${lot.id}/mediciones-satelitales?fuente=sentinel-1&desde=2026-08-09&hasta=2026-08-11`);
      expect(soloRadar.body.mediciones).toHaveLength(1);
      expect(soloRadar.body.mediciones[0].fuente).toBe('sentinel-1');
    });

    test('pagina y filtra usos y clima sin cambiar sus fechas calendario', async () => {
      const { agent, lot } = await prepararLote('pagination_history_user');
      for (const fecha of ['2026-08-14', '2026-08-15', '2026-08-16']) await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha });
      const usos = await agent.get(`/api/lotes/${lot.id}/usos?limit=2&offset=0&desde=2026-08-14&hasta=2026-08-16`);
      expect(usos.body.usos.map((item: { fecha: string }) => item.fecha)).toEqual(['2026-08-16', '2026-08-15']);
      expect(usos.body.paginacion).toEqual({ limit: 2, offset: 0, total: 3, hayMas: true });
      for (const [dia, lluvia] of [['2026-08-16', 1], ['2026-08-17', 2], ['2026-08-18', 3]] as const) {
        await insertarClima(lot.id, { ...clima('manual'), consultedAt: `${dia}T12:00:00.000Z`, dias: [{ fecha: dia, lluviaMm: lluvia, tempMin: 8, tempMax: 20, esPronostico: false }] });
      }
      const climaPage = await agent.get(`/api/lotes/${lot.id}/clima?limit=2&offset=1&desde=2026-08-17&hasta=2026-08-18`);
      expect(climaPage.body.consultas).toHaveLength(1);
      expect(climaPage.body.paginacion.total).toBe(2);
      expect(climaPage.body.consultas[0].dias[0].fecha).toMatch(/^2026-08-/);
    });

    test('rechaza parámetros de paginación, fechas y fuente inválidos', async () => {
      const { agent, lot } = await prepararLote('invalid_query_user');
      for (const query of ['limit=0', 'limit=-1', 'limit=abc', 'limit=101', 'offset=-1', 'desde=2026-02-30', 'hasta=2026-01-01&desde=2026-01-02', 'fuente=landsat']) {
        expect((await agent.get(`/api/lotes/${lot.id}/mediciones-satelitales?${query}`)).status).toBe(400);
      }
    });
  });

  describe('estado actual consolidado', () => {
    test('devuelve sólo la medición óptica, radar, clima y uso más recientes', async () => {
      const { agent, lot } = await prepararLote('state_user');
      await insertarMedicion(lot.id, { ...medicionOptica, observedAt: '2026-08-10' });
      await insertarMedicion(lot.id, { ...medicionOptica, observedAt: '2026-08-18', puntaje: 90 });
      await insertarMedicion(lot.id, { ...medicionRadar, observedAt: '2026-08-11' });
      await insertarMedicion(lot.id, { ...medicionRadar, observedAt: '2026-08-19' });
      await insertarClima(lot.id, { ...clima('manual'), consultedAt: '2026-08-10T12:00:00.000Z' });
      await insertarClima(lot.id, { ...clima('manual'), consultedAt: '2026-08-19T12:00:00.000Z' });
      await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2026-08-14' });
      await agent.post(`/api/lotes/${lot.id}/usos`).send({ fecha: '2026-08-19' });
      const response = await agent.get(`/api/lotes/${lot.id}/estado`);
      expect(response.status).toBe(200);
      expect(response.body.satelite.optico.observedAt).toBe('2026-08-18');
      expect(response.body.satelite.optico.puntaje).toBe(90);
      expect(response.body.satelite.radar.observedAt).toBe('2026-08-19');
      expect(response.body.satelite.radar).not.toHaveProperty('puntaje');
      expect(response.body.clima.consultedAt).toBe('2026-08-19T12:00:00.000Z');
      expect(response.body.clima.origen).toBe('manual');
      expect(response.body.uso.ultimoUso).toEqual({ fecha: '2026-08-19', origen: 'manual' });
      expect(response.body.uso.diasDescanso).toBeGreaterThanOrEqual(0);
    });

    test('representa correctamente un lote sin historial', async () => {
      const { agent, lot } = await prepararLote('empty_state_user');
      const response = await agent.get(`/api/lotes/${lot.id}/estado`);
      expect(response.body.satelite).toEqual({ optico: null, radar: null });
      expect(response.body.clima).toBeNull();
      expect(response.body.uso).toEqual({ ultimoUso: null, diasDescanso: null });
    });

    test('devuelve todos los lotes activos ordenados y conserva datos separados por lote', async () => {
      const agent = await registrar('bulk_state_user');
      await crearEstablecimiento(agent);
      const lote1 = await crearLote(agent, 1, 2);
      const lote2 = await crearLote(agent, 3, 4);
      const lote3 = await crearLote(agent, 5, 6);
      await insertarMedicion(lote1.id, { ...medicionOptica, ndvi: { ...medicionOptica.ndvi, mediana: 0.2 } });
      await insertarClima(lote1.id);
      await agent.post(`/api/lotes/${lote1.id}/usos`).send({ fecha: '2026-08-19' });
      await insertarMedicion(lote2.id, { ...medicionOptica, ndvi: { ...medicionOptica.ndvi, mediana: 0.8 } });
      const response = await agent.get('/api/lotes/estado');
      expect(response.status).toBe(200);
      expect(response.body.lotes.map((item: { lote: { numero: number } }) => item.lote.numero)).toEqual([1, 2, 3]);
      expect(response.body.lotes[0].satelite.optico.ndvi.mediana).toBe(0.2);
      expect(response.body.lotes[1].satelite.optico.ndvi.mediana).toBe(0.8);
      expect(response.body.lotes[1].clima).toBeNull();
      expect(response.body.lotes[2].satelite).toEqual({ optico: null, radar: null });
      expect(response.body.lotes[2].clima).toBeNull();
      expect(response.body.lotes[2].uso).toEqual({ ultimoUso: null, diasDescanso: null });
      expect(lote3.id).toBe(response.body.lotes[2].lote.id);
    });

    test('filtra inactivos y nunca devuelve soft-deleted', async () => {
      const agent = await registrar('bulk_inactive_user');
      await crearEstablecimiento(agent);
      const activo = await crearLote(agent, 1, 2);
      const inactivo = await crearLote(agent, 3, 4);
      await agent.patch(`/api/lotes/${inactivo.id}`).send({ activo: false });
      expect((await agent.get('/api/lotes/estado')).body.lotes.map((item: { lote: { id: string } }) => item.lote.id)).toEqual([activo.id]);
      const ambos = await agent.get('/api/lotes/estado?incluirInactivos=true');
      expect(ambos.body.lotes.map((item: { lote: { id: string } }) => item.lote.id)).toEqual([activo.id, inactivo.id]);
      await agent.delete(`/api/lotes/${inactivo.id}`);
      expect((await agent.get('/api/lotes/estado?incluirInactivos=true')).body.lotes.map((item: { lote: { id: string } }) => item.lote.id)).toEqual([activo.id]);
    });

    test('aísla el estado consolidado entre usuarios y valida incluirInactivos', async () => {
      const owner = await prepararLote('bulk_owner_user');
      const other = await prepararLote('bulk_other_user');
      const foreign = await other.agent.get('/api/lotes/estado');
      expect(foreign.body.lotes).toHaveLength(1);
      expect(foreign.body.lotes[0].lote.id).toBe(other.lot.id);
      expect(foreign.body.lotes[0].lote.id).not.toBe(owner.lot.id);
      expect((await owner.agent.get('/api/lotes/estado?incluirInactivos=hola')).status).toBe(400);
    });

    test('mantiene consistencia conceptual entre estado individual y colección', async () => {
      const { agent, lot } = await prepararLote('bulk_consistency_user');
      await insertarMedicion(lot.id, medicionRadar);
      const individual = await agent.get(`/api/lotes/${lot.id}/estado`);
      const collection = await agent.get('/api/lotes/estado');
      const item = collection.body.lotes.find((estado: { lote: { id: string } }) => estado.lote.id === lot.id);
      expect(item).toBeDefined();
      expect(item.lote).toEqual(individual.body.lote);
      expect(item.satelite.radar.observedAt).toBe(individual.body.satelite.radar.observedAt);
      expect(item.satelite.radar.rvi).toEqual(individual.body.satelite.radar.rvi);
      expect(item.clima).toEqual(individual.body.clima);
      expect(item.uso).toEqual(individual.body.uso);
    });
  });

  describe('sugerencia de lotes con IA', () => {
    let servicioFalso: Server;
    let urlServicio: string;
    let ultimoCuerpo: unknown;
    let respuesta: { status: number; json: unknown };
    const urlOriginal = process.env.IA_LOTES_URL;

    beforeAll(async () => {
      // Un microservicio de mentira: el objetivo es probar el puente y el
      // recorte de Express, no el modelo, que vive en otro proceso.
      servicioFalso = createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (chunk) => { cuerpo += chunk; });
        req.on('end', () => {
          ultimoCuerpo = JSON.parse(cuerpo);
          res.writeHead(respuesta.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(respuesta.json));
        });
      });
      await new Promise<void>((resolve) => servicioFalso.listen(0, '127.0.0.1', resolve));
      const direccion = servicioFalso.address() as AddressInfo;
      urlServicio = `http://127.0.0.1:${direccion.port}`;
    });

    afterAll(async () => {
      if (urlOriginal === undefined) delete process.env.IA_LOTES_URL; else process.env.IA_LOTES_URL = urlOriginal;
      await new Promise<void>((resolve, reject) => servicioFalso.close((error) => error ? reject(error) : resolve()));
    });

    beforeEach(() => {
      process.env.IA_LOTES_URL = urlServicio;
      // El modelo propone tres cosas: una que se sale del establecimiento, una
      // que pisa el lote que ya existe y una entera afuera.
      respuesta = {
        status: 200,
        json: {
          poligonos: [
            { ...lote(8, 14), properties: { confianza: 0.7 } },
            { ...lote(0, 3), properties: { confianza: 0.6 } },
            { ...lote(20, 25), properties: { confianza: 0.5 } },
          ],
          meta: { modelo: 'falso.pt', dispositivo: 'cpu', zoom: 17, tiles: 4, metrosPorPixel: 1.2, detectadas: 3, segundos: 1.5 },
        },
      };
    });

    test('exige sesión en estado y en la sugerencia', async () => {
      expect((await request(app).get('/api/ia/estado')).status).toBe(401);
      expect((await request(app).post('/api/ia/sugerir-lotes')).status).toBe(401);
    });

    test('el estado refleja si el microservicio está configurado', async () => {
      const agent = await registrar('ia_estado_user');
      delete process.env.IA_LOTES_URL;
      expect((await agent.get('/api/ia/estado')).body).toEqual({ configurado: false });
      process.env.IA_LOTES_URL = urlServicio;
      expect((await agent.get('/api/ia/estado')).body).toEqual({ configurado: true });
    });

    test('sin establecimiento no hay nada que subdividir', async () => {
      const agent = await registrar('ia_sin_establecimiento_user');
      const response = await agent.post('/api/ia/sugerir-lotes');
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ESTABLISHMENT_REQUIRED');
    });

    test('manda sólo el polígono, recorta lo que vuelve y no persiste nada', async () => {
      const { agent, lot } = await prepararLote('ia_sugerencias_user');
      const response = await agent.post('/api/ia/sugerir-lotes');

      expect(response.status).toBe(200);
      expect(ultimoCuerpo).toEqual({ polygon: establecimiento });

      // La de afuera se descarta; las otras dos sobreviven recortadas.
      expect(response.body.sugerencias).toHaveLength(2);
      expect(response.body.meta).toMatchObject({ modelo: 'falso.pt', detectadas: 3, descartadas: 1 });
      for (const sugerencia of response.body.sugerencias) {
        expect(estaContenido(sugerencia.polygon, establecimiento)).toBe(true);
        expect(seSuperpone(sugerencia.polygon, lote(1, 2))).toBe(false);
        expect(sugerencia.hectareas).toBeGreaterThan(0);
      }

      // Nada se guardó: sigue existiendo sólo el lote creado a mano.
      const lotes = await agent.get('/api/lotes');
      expect(lotes.body.lotes).toHaveLength(1);
      expect(lotes.body.lotes[0].id).toBe(lot.id);
    });

    test('una sugerencia se puede confirmar tal cual contra POST /api/lotes', async () => {
      const { agent } = await prepararLote('ia_confirmacion_user');
      const sugerencias = (await agent.post('/api/ia/sugerir-lotes')).body.sugerencias;

      for (const sugerencia of sugerencias) {
        const creado = await agent.post('/api/lotes').send({ polygon: sugerencia.polygon });
        expect(creado.status).toBe(201);
      }
      expect((await agent.get('/api/lotes')).body.lotes).toHaveLength(1 + sugerencias.length);
    });

    test('traduce la caída del microservicio sin inventar una división', async () => {
      const { agent } = await prepararLote('ia_error_user');
      respuesta = { status: 503, json: { detail: 'Faltan los pesos del modelo.' } };

      const response = await agent.post('/api/ia/sugerir-lotes');
      expect(response.status).toBe(502);
      expect(response.body.error).toEqual({ code: 'IA_UPSTREAM_ERROR', message: 'Faltan los pesos del modelo.' });
      expect((await agent.get('/api/lotes')).body.lotes).toHaveLength(1);
    });
  });
});
