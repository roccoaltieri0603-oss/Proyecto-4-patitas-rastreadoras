import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: async () => ({ query: mock.query, release: () => {} }) } }));
vi.mock('../../src/configuracion/env.js', () => ({ env: { authJwtSecret: 'secreto-unitario-jornadas', cookieSameSite: 'lax', cookieSecure: false } }));
vi.mock('../../src/autenticacion/operativa.js', () => ({
  requiereSesionOperativa: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (!req.usuario) { next(new Error('Falta autenticación personal.')); return; }
    req.membresia = { ...actor, establecimientoId: req.params.establecimientoId, puestoOperativoId: '00000000-0000-4000-8000-000000000011' };
    next();
  },
  entrarPuesto: vi.fn(), salirPuesto: vi.fn(),
}));

import { establecimientosRouter } from '../../src/routes/establecimientos.js';
import { crearToken } from '../../src/autenticacion/session.js';
import { errorResponse } from '../../src/http/errors.js';

const eid = '00000000-0000-4000-8000-000000000001';
const uid = '00000000-0000-4000-8000-000000000002';
const lid = '00000000-0000-4000-8000-000000000004';
const usoId = '00000000-0000-4000-8000-000000000005';

const app = express();
app.use(express.json());
app.use('/api/establecimientos', establecimientosRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const r = errorResponse(error);
  res.status(r.status).json(r.body);
});

const cookie = () => `rodeo_session=${crearToken(uid)}`;
const base = `/api/establecimientos/${eid}/lotes/${lid}`;

let actor: Membresia;
interface Fila {
  id: string; lote_id: string; fecha: string; origen: string; created_at: Date;
  ingreso_at: Date | null; salida_at: Date | null;
  animales_adultos: number | null; animales_toretes_vaconas: number | null; animales_terneros: number | null; altura_remanente_cm: number | null;
}
let fila: Fila | null;
let duplicada: boolean;

function filaDesde(valores: unknown[]): Fila {
  const [, fecha, ingreso, salida, adultos, toretes, terneros, altura] = valores as [string, string, Date, Date | null, number | null, number | null, number | null, number | null];
  return { id: usoId, lote_id: lid, fecha, origen: 'manual', created_at: new Date(), ingreso_at: ingreso, salida_at: salida, animales_adultos: adultos, animales_toretes_vaconas: toretes, animales_terneros: terneros, altura_remanente_cm: altura };
}

beforeEach(() => {
  vi.clearAllMocks();
  actor = { establecimientoId: eid, userId: uid, rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] };
  fila = null;
  duplicada = false;
  mock.query.mockImplementation(async (sql: string, valores: unknown[] = []) => {
    if (sql.includes('FROM usuarios WHERE id')) return { rows: [{ id: uid, email: 'test@example.test', username: 'Test', onboarding_completed_at: null }] };
    if (sql.includes('FROM lotes l JOIN establecimientos e')) return { rows: [{ id: lid }] };
    if (sql.startsWith('INSERT INTO usos_lote')) {
      if (duplicada) throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'usos_lote_jornada_abierta_unique_idx' });
      fila = filaDesde(valores);
      return { rows: [fila] };
    }
    if (sql.includes('FROM usos_lote WHERE id = $1 AND lote_id = $2 FOR UPDATE')) return { rows: fila ? [fila] : [] };
    if (sql.startsWith('UPDATE usos_lote SET salida_at')) {
      fila = { ...fila!, salida_at: valores[2] as Date, altura_remanente_cm: valores[3] as number | null };
      return { rows: [fila] };
    }
    if (sql.startsWith('DELETE FROM usos_lote')) {
      const borrada = fila && fila.id === valores[0] ? [{ id: fila.id }] : [];
      if (borrada.length) fila = null;
      return { rows: borrada };
    }
    if (sql.startsWith('UPDATE usos_lote SET fecha')) {
      const [, , fecha, ingreso, salida, adultos, toretes, terneros, altura] = valores as [string, string, string, Date | null, Date | null, number | null, number | null, number | null, number | null];
      fila = { ...fila!, fecha, ingreso_at: ingreso, salida_at: salida, animales_adultos: adultos, animales_toretes_vaconas: toretes, animales_terneros: terneros, altura_remanente_cm: altura };
      return { rows: [fila] };
    }
    return { rows: [], rowCount: 0 };
  });
});

function abierta(ingreso = '2026-10-20T11:30:00.000Z'): Fila {
  return { id: usoId, lote_id: lid, fecha: '2026-10-20', origen: 'manual', created_at: new Date(), ingreso_at: new Date(ingreso), salida_at: null, animales_adultos: 40, animales_toretes_vaconas: null, animales_terneros: 10, altura_remanente_cm: null };
}

describe('iniciar jornada', () => {
  test('guarda la entrada con hora, los animales por categoría y la fecha en el calendario argentino', async () => {
    // 01:30 del 21/10 en UTC son las 22:30 del 20/10 en Buenos Aires.
    const respuesta = await request(app).post(`${base}/jornadas`).set('Cookie', cookie())
      .send({ ingresoAt: '2026-10-21T01:30:00.000Z', adultos: 40, terneros: 10 });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.uso).toMatchObject({
      fecha: '2026-10-20', ingresoAt: '2026-10-21T01:30:00.000Z', salidaAt: null, enCurso: true,
      animales: { adultos: 40, toretesVaconas: null, terneros: 10, total: 50 }, alturaRemanenteCm: null, diasOcupacion: null,
    });
  });

  test('puede registrar una jornada pasada completa, con salida y remanente', async () => {
    const respuesta = await request(app).post(`${base}/jornadas`).set('Cookie', cookie())
      .send({ ingresoAt: '2026-09-01T11:00:00-03:00', salidaAt: '2026-09-04T17:00:00-03:00', adultos: 25, alturaRemanenteCm: 6 });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.uso).toMatchObject({ enCurso: false, alturaRemanenteCm: 6, diasOcupacion: 3.3 });
  });

  test.each([
    [{ adultos: 10 }, 'INVALID_DATETIME'],
    [{ ingresoAt: '2026-10-20 08:00', adultos: 10 }, 'INVALID_DATETIME'],
    [{ ingresoAt: '2026-10-20T08:00:00', adultos: 10 }, 'INVALID_DATETIME'],
    [{ ingresoAt: '2999-01-01T00:00:00Z', adultos: 10 }, 'FUTURE_DATETIME'],
    [{ ingresoAt: '2026-10-20T08:00:00Z' }, 'ANIMALS_REQUIRED'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', adultos: 0, terneros: 0 }, 'ANIMALS_REQUIRED'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', adultos: 2.5 }, 'INVALID_ANIMAL_COUNT'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', adultos: -1 }, 'INVALID_ANIMAL_COUNT'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', adultos: '10' }, 'INVALID_ANIMAL_COUNT'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', salidaAt: '2026-10-20T07:00:00Z', adultos: 10 }, 'EXIT_BEFORE_ENTRY'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', adultos: 10, alturaRemanenteCm: 5 }, 'REMNANT_WITHOUT_EXIT'],
    [{ ingresoAt: '2026-10-20T08:00:00Z', salidaAt: '2026-10-21T08:00:00Z', adultos: 10, alturaRemanenteCm: 0 }, 'INVALID_REMNANT_HEIGHT'],
  ])('rechaza %j con %s sin escribir', async (cuerpo, codigo) => {
    const respuesta = await request(app).post(`${base}/jornadas`).set('Cookie', cookie()).send(cuerpo);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe(codigo);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  test('con otra jornada abierta en el lote responde 409', async () => {
    duplicada = true;
    const respuesta = await request(app).post(`${base}/jornadas`).set('Cookie', cookie()).send({ ingresoAt: '2026-10-20T08:00:00Z', adultos: 10 });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.code).toBe('GRAZING_ALREADY_OPEN');
  });

  test('el Visor no puede iniciar', async () => {
    actor = { ...actor, rol: 'VISOR', principal: false };
    expect((await request(app).post(`${base}/jornadas`).set('Cookie', cookie()).send({ ingresoAt: '2026-10-20T08:00:00Z', adultos: 10 })).status).toBe(403);
  });
});

describe('finalizar jornada', () => {
  test('guarda la salida y la altura del remanente', async () => {
    fila = abierta();
    const respuesta = await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie())
      .send({ salidaAt: '2026-10-22T20:30:00.000Z', alturaRemanenteCm: 7.5 });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.uso).toMatchObject({ enCurso: false, salidaAt: '2026-10-22T20:30:00.000Z', alturaRemanenteCm: 7.5, diasOcupacion: 2.4 });
  });

  test('la altura es opcional: si no se midió queda sin dato', async () => {
    fila = abierta();
    const respuesta = await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie()).send({ salidaAt: '2026-10-22T20:30:00.000Z' });
    expect(respuesta.body.uso.alturaRemanenteCm).toBeNull();
  });

  test('una salida anterior a la entrada se rechaza', async () => {
    fila = abierta();
    const respuesta = await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie()).send({ salidaAt: '2026-10-19T20:30:00.000Z' });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe('EXIT_BEFORE_ENTRY');
  });

  test('una jornada ya cerrada o un uso viejo no se finalizan', async () => {
    fila = { ...abierta(), salida_at: new Date('2026-10-21T12:00:00Z') };
    expect((await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie()).send({ salidaAt: '2026-10-22T12:00:00Z' })).body.error.code).toBe('GRAZING_NOT_OPEN');
    fila = { ...abierta(), ingreso_at: null, animales_adultos: null, animales_terneros: null };
    expect((await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie()).send({ salidaAt: '2026-10-22T12:00:00Z' })).body.error.code).toBe('GRAZING_NOT_OPEN');
  });

  test('un uso que no es del lote responde 404', async () => {
    const respuesta = await request(app).post(`${base}/jornadas/${usoId}/finalizar`).set('Cookie', cookie()).send({ salidaAt: '2026-10-22T12:00:00Z' });
    expect(respuesta.status).toBe(404);
  });
});

describe('borrar jornada', () => {
  test('una jornada abierta cargada por error se borra, y después se puede iniciar otra', async () => {
    fila = abierta();
    expect((await request(app).delete(`${base}/usos/${usoId}`).set('Cookie', cookie())).status).toBe(204);
    expect(fila).toBeNull();
    expect((await request(app).post(`${base}/jornadas`).set('Cookie', cookie()).send({ ingresoAt: '2026-10-20T08:00:00Z', adultos: 10 })).status).toBe(201);
  });

  test('borrar un uso que no es del lote responde 404', async () => {
    expect((await request(app).delete(`${base}/usos/${usoId}`).set('Cookie', cookie())).status).toBe(404);
  });

  test('el Visor no puede borrar', async () => {
    fila = abierta();
    actor = { ...actor, rol: 'VISOR', principal: false };
    expect((await request(app).delete(`${base}/usos/${usoId}`).set('Cookie', cookie())).status).toBe(403);
    expect(fila).not.toBeNull();
  });
});

describe('editar uso o jornada', () => {
  test('un uso viejo sigue cambiando sólo su fecha', async () => {
    fila = { ...abierta(), ingreso_at: null, animales_adultos: null, animales_terneros: null };
    const respuesta = await request(app).patch(`${base}/usos/${usoId}`).set('Cookie', cookie()).send({ fecha: '2026-10-18' });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.uso).toMatchObject({ fecha: '2026-10-18', ingresoAt: null, enCurso: false });
  });

  test('cambiar la entrada de una jornada mueve también su fecha', async () => {
    fila = abierta();
    const respuesta = await request(app).patch(`${base}/usos/${usoId}`).set('Cookie', cookie()).send({ ingresoAt: '2026-10-19T10:00:00-03:00', toretesVaconas: 5 });
    expect(respuesta.body.uso).toMatchObject({ fecha: '2026-10-19', animales: { adultos: 40, toretesVaconas: 5, terneros: 10, total: 55 } });
  });

  test('a una jornada con hora no se le cambia la fecha suelta', async () => {
    fila = abierta();
    const respuesta = await request(app).patch(`${base}/usos/${usoId}`).set('Cookie', cookie()).send({ fecha: '2026-10-10' });
    expect(respuesta.body.error.code).toBe('USE_HAS_TIMES');
  });

  test('dejar una jornada sin animales se rechaza', async () => {
    fila = abierta();
    const respuesta = await request(app).patch(`${base}/usos/${usoId}`).set('Cookie', cookie()).send({ adultos: null, terneros: null });
    expect(respuesta.body.error.code).toBe('ANIMALS_REQUIRED');
  });
});
