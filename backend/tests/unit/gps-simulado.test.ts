import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: async () => ({ query: mock.query, release: () => {} }) } }));
vi.mock('../../src/services/notificaciones.js', () => ({ mantenerIncidenciaActiva: vi.fn(), resolverIncidencia: vi.fn(), registrarEventoAdministrativo: vi.fn(), notificarResponsableGpsSiHayIncidencia: vi.fn(), notificarGpsSimuladoEnLote: vi.fn() }));
vi.mock('../../src/configuracion/env.js', () => ({ env: { authJwtSecret: 'secreto-unitario-gps-simulado', cookieSameSite: 'lax', cookieSecure: false } }));
// Este archivo verifica GPS y permisos; las sesiones exclusivas tienen su suite propia.
vi.mock('../../src/autenticacion/operativa.js', () => ({
  requiereSesionOperativa: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (!req.usuario) { next(new Error('Falta autenticación personal.')); return; }
    if (!actor || !membresias.includes(req.params.establecimientoId)) {
      next(new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Establecimiento no disponible.')); return;
    }
    req.membresia = { ...actor, establecimientoId: req.params.establecimientoId,
      puestoOperativoId: '00000000-0000-4000-8000-000000000011' };
    next();
  },
  entrarPuesto: vi.fn(), salirPuesto: vi.fn(),
}));

import { establecimientosRouter } from '../../src/routes/establecimientos.js';
import { crearToken } from '../../src/autenticacion/session.js';
import { ApiError, errorResponse } from '../../src/http/errors.js';
import { establecimiento, lote } from '../helpers/fixtures.js';
import { mantenerIncidenciaActiva, notificarGpsSimuladoEnLote, resolverIncidencia } from '../../src/services/notificaciones.js';

const eid = '00000000-0000-4000-8000-000000000001';
const otroEid = '00000000-0000-4000-8000-000000000009';
const uid = '00000000-0000-4000-8000-000000000002';

const app = express();
app.use(express.json());
app.use('/api/establecimientos', establecimientosRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const r = errorResponse(error);
  res.status(r.status).json(r.body);
});

const cookie = () => `rodeo_session=${crearToken(uid)}`;
const url = (establecimientoId = eid) => `/api/establecimientos/${establecimientoId}/gps-simulado`;

// Fila persistida por establecimiento: una sola, sin historial.
let filas: Record<string, { latitud: number; longitud: number; updated_at: Date }>;
// Lotes activos del establecimiento, para saber en cuál quedó el punto.
let lotesActivos: Array<{ id: string; numero: number; apodo: string | null; polygon: unknown }>;
let actor: Membresia | null;
// Establecimientos donde el usuario sí tiene membresía.
let membresias: string[];

beforeEach(() => {
  vi.clearAllMocks();
  filas = {};
  lotesActivos = [];
  membresias = [eid];
  actor = { establecimientoId: eid, userId: uid, rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] };
  mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM usuarios WHERE id')) return { rows: [{ id: uid, email: 'test@example.test', username: 'Test', onboarding_completed_at: null }] };
    if (sql.includes('FROM membresias m JOIN establecimientos')) {
      return { rows: actor && membresias.includes(String(values[0])) ? [{ ...actor, establecimientoId: values[0] }] : [] };
    }
    if (sql.includes('SELECT polygon FROM establecimientos')) return { rows: [{ polygon: establecimiento }] };
    if (sql.startsWith('SELECT id, numero, apodo, polygon FROM lotes')) return { rows: lotesActivos };
    if (sql.startsWith('SELECT latitud')) {
      const fila = filas[String(values[0])];
      return { rows: fila ? [fila] : [] };
    }
    if (sql.startsWith('INSERT INTO gps_simulado_posicion')) {
      const [establecimientoId, latitud, longitud] = values as [string, number, number, string];
      filas[establecimientoId] = { latitud, longitud, updated_at: new Date('2026-01-01T00:00:00.000Z') };
      return { rows: [filas[establecimientoId]] };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('posición del GPS simulado', () => {
  test('evalúa posiciones interiores y el borde como dentro; fuera abre la incidencia', async () => {
    for (const punto of [{ latitud: 5, longitud: 5 }, { latitud: 0, longitud: 5 }]) {
      expect((await request(app).put(url()).set('Cookie', cookie()).send(punto)).status).toBe(200);
    }
    expect(resolverIncidencia).toHaveBeenCalledTimes(2);
    expect(mantenerIncidenciaActiva).not.toHaveBeenCalled();
    expect((await request(app).put(url()).set('Cookie', cookie()).send({ latitud: 20, longitud: 20 })).status).toBe(200);
    expect(mantenerIncidenciaActiva).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tipo: 'gps_simulado_fuera_establecimiento', clave: 'gps_simulado', soloResponsableGps: true,
    }));
  });

  test('sin sesión responde 401 y no consulta la tabla', async () => {
    expect((await request(app).get(url())).status).toBe(401);
    expect((await request(app).put(url()).send({ latitud: -34, longitud: -58 })).status).toBe(401);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('gps_simulado_posicion'))).toBe(false);
  });

  test('sin membresía responde 404 y no escribe', async () => {
    actor = null;
    expect((await request(app).get(url()).set('Cookie', cookie())).status).toBe(404);
    expect((await request(app).put(url()).set('Cookie', cookie()).send({ latitud: -34, longitud: -58 })).status).toBe(404);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  test('sin posición guardada devuelve null, no un centroide inventado', async () => {
    const respuesta = await request(app).get(url()).set('Cookie', cookie());
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ posicion: null });
  });

  test('el Visor lee pero no escribe', async () => {
    actor!.rol = 'VISOR';
    actor!.principal = false;
    expect((await request(app).get(url()).set('Cookie', cookie())).status).toBe(200);
    const respuesta = await request(app).put(url()).set('Cookie', cookie()).send({ latitud: -34, longitud: -58 });
    expect(respuesta.status).toBe(403);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  test('el Administrador sin permisos especiales sí escribe', async () => {
    actor!.rol = 'ADMINISTRADOR';
    actor!.principal = false;
    expect((await request(app).put(url()).set('Cookie', cookie()).send({ latitud: -34, longitud: -58 })).status).toBe(200);
  });

  test.each([
    [{ latitud: 91, longitud: -58 }],
    [{ latitud: -91, longitud: -58 }],
    [{ latitud: -34, longitud: 181 }],
    [{ latitud: -34, longitud: -181 }],
    [{ latitud: Number.NaN, longitud: -58 }],
    [{ latitud: '-34', longitud: -58 }],
    [{ latitud: -34 }],
    [{}],
  ])('rechaza coordenadas inválidas %j sin escribir', async (body) => {
    const respuesta = await request(app).put(url()).set('Cookie', cookie()).send(body);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe('INVALID_GPS_POSITION');
    expect(mock.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  test('acepta los extremos válidos del rango', async () => {
    for (const body of [{ latitud: -90, longitud: -180 }, { latitud: 90, longitud: 180 }]) {
      expect((await request(app).put(url()).set('Cookie', cookie()).send(body)).status).toBe(200);
    }
  });

  test('el upsert pisa la fila anterior y no acumula historial', async () => {
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: -34.1, longitud: -58.1 });
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: -34.2, longitud: -58.2 });
    expect(Object.keys(filas)).toEqual([eid]);
    const respuesta = await request(app).get(url()).set('Cookie', cookie());
    expect(respuesta.body.posicion).toMatchObject({ latitud: -34.2, longitud: -58.2 });
    expect(respuesta.body.posicion.actualizadaEn).toBeTruthy();
  });

  test('cada establecimiento tiene su propia posición y el ajeno no se filtra', async () => {
    membresias = [eid, otroEid];
    await request(app).put(url(eid)).set('Cookie', cookie()).send({ latitud: -34, longitud: -58 });
    expect((await request(app).get(url(otroEid)).set('Cookie', cookie())).body).toEqual({ posicion: null });
    await request(app).put(url(otroEid)).set('Cookie', cookie()).send({ latitud: -31, longitud: -64 });
    expect((await request(app).get(url(eid)).set('Cookie', cookie())).body.posicion).toMatchObject({ latitud: -34, longitud: -58 });
  });

  test('avisa cuando el punto guardado queda en otro lote, y sólo entonces', async () => {
    lotesActivos = [
      { id: 'lote-1', numero: 1, apodo: null, polygon: lote(0, 4) },
      { id: 'lote-2', numero: 2, apodo: 'El Bajo', polygon: lote(5, 9) },
    ];
    // Entra al lote 1 desde ningún lote.
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: 2, longitud: 2 });
    expect(notificarGpsSimuladoEnLote).toHaveBeenCalledTimes(1);
    expect(notificarGpsSimuladoEnLote).toHaveBeenLastCalledWith(expect.anything(), {
      establecimientoId: eid, lote: { id: 'lote-1', numero: 1, apodo: null }, anterior: null,
    });
    // Se mueve dentro del mismo lote: no avisa.
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: 3, longitud: 3 });
    expect(notificarGpsSimuladoEnLote).toHaveBeenCalledTimes(1);
    // Pasa al lote 2: avisa con el lote anterior.
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: 7, longitud: 7 });
    expect(notificarGpsSimuladoEnLote).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      lote: { id: 'lote-2', numero: 2, apodo: 'El Bajo' }, anterior: { id: 'lote-1', numero: 1, apodo: null },
    }));
    // Sale de todos los lotes: no avisa la salida.
    await request(app).put(url()).set('Cookie', cookie()).send({ latitud: 4.5, longitud: 4.5 });
    expect(notificarGpsSimuladoEnLote).toHaveBeenCalledTimes(2);
  });

  test('el establecimiento sale de la URL y nunca de un id del cuerpo', async () => {
    await request(app).put(url(eid)).set('Cookie', cookie()).send({ latitud: -34, longitud: -58, establecimientoId: otroEid });
    expect(Object.keys(filas)).toEqual([eid]);
  });
});
