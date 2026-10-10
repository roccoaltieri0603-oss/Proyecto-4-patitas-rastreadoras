import type { Request, Response } from 'express';
import type { Membresia } from '../../src/autorizacion/catalogo.js';
import { establecimiento, lote } from '../helpers/fixtures.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: mock.connect } }));
import { actualizarEstablecimiento } from '../../src/controllers/establecimiento.js';
import { actualizarLote } from '../../src/controllers/lotes.js';

const eid = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';
const lid = '00000000-0000-4000-8000-000000000004';
const geometriaVieja = lote(1, 2);
const geometriaNueva = lote(1, 2.5);
let actor: Membresia;
let fallaNotificacion: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  fallaNotificacion = false;
  actor = { establecimientoId: eid, userId: ownerId, rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE')) return { rows: [{ id: eid }] };
    if (sql.includes('SELECT l.id, l.numero')) return { rows: [{ id: lid, numero: 1, apodo: null, polygon: geometriaVieja, activo: true, created_at: new Date(), updated_at: new Date(), establecimiento_id: eid }] };
    if (sql === 'SELECT polygon FROM establecimientos WHERE id = $1') return { rows: [{ polygon: establecimiento }] };
    if (sql.startsWith('SELECT polygon FROM lotes WHERE establecimiento_id')) return { rows: [] };
    if (sql.startsWith('SELECT id, nombre, polygon, created_at')) return { rows: [{ id: eid, nombre: 'Campo', polygon: establecimiento, created_at: new Date(), updated_at: new Date(), onboarding_completed_at: new Date() }] };
    if (sql.startsWith('UPDATE establecimientos SET')) return { rows: [{ id: eid, nombre: 'Campo', polygon: values[1], created_at: new Date(), updated_at: new Date(), onboarding_completed_at: new Date() }] };
    if (sql.startsWith('UPDATE lotes SET')) return { rows: [{ id: lid, numero: 1, apodo: null, polygon: values[2], activo: true, created_at: new Date(), updated_at: new Date() }] };
    if (sql === 'SELECT username FROM usuarios WHERE id = $1') return { rows: [{ username: actor.rol === 'PROPIETARIO' ? 'Propietario' : 'Administrador' }] };
    if (sql.includes('INSERT INTO eventos_establecimiento')) return { rows: [{ id: '00000000-0000-4000-8000-000000000010' }] };
    if (sql.includes('SELECT DISTINCT m.user_id')) return { rows: [{ user_id: actor.rol === 'PROPIETARIO' ? adminId : ownerId }] };
    if (sql.includes('INSERT INTO entregas_eventos_notificacion')) return { rows: [{ evento_id: 'evento' }] };
    if (sql.includes('INSERT INTO notificaciones')) {
      if (fallaNotificacion) throw new Error('fallo simulado al insertar notificación');
      return { rows: [{ id: '00000000-0000-4000-8000-000000000020' }] };
    }
    if (sql.includes('UPDATE entregas_eventos_notificacion SET notificacion_id')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT EXISTS (SELECT 1 FROM lotes_favoritos')) return { rows: [{ favorito: false }] };
    if (sql.includes('FROM gps_simulado_posicion')) return { rows: [] };
    throw new Error(`Consulta no prevista: ${sql}; valores=${JSON.stringify(values)}`);
  });
  mock.query.mockImplementation(query);
  mock.connect.mockResolvedValue({ query: mock.query, release: vi.fn() });
});

function req(body: unknown): Request {
  return {
    body, params: { id: lid }, usuario: { id: actor.userId }, membresia: actor,
  } as unknown as Request;
}
function res(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Response;
}

describe('eventos de límites con el actor y destinatario correctos', () => {
  test.each([
    ['propietario', 'PROPIETARIO'],
    ['administrador autorizado', 'ADMINISTRADOR'],
  ] as const)('%s modifica límites de lote y la transacción genera su evento y aviso', async (_quien, rol) => {
    actor = { establecimientoId: eid, userId: rol === 'PROPIETARIO' ? ownerId : adminId, rol, principal: rol === 'PROPIETARIO', permisos: rol === 'ADMINISTRADOR' ? ['editar_geometria_lotes'] : [], capacidades: [] };
    const response = res();
    await actualizarLote(req({ polygon: geometriaNueva }), response);
    expect(response.json).toHaveBeenCalledOnce();
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO eventos_establecimiento'))).toBe(true);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO entregas_eventos_notificacion'))).toBe(true);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notificaciones'))).toBe(true);
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    const seleccion = mock.query.mock.calls.find(([sql]) => String(sql).includes('SELECT DISTINCT m.user_id'))!;
    expect(seleccion[1]?.[0]).toBe(eid);
    expect(seleccion[1]?.[3]).toBe(actor.userId);
    expect(String(seleccion[0])).toContain('m.user_id <> $4');
    expect(String(seleccion[0])).not.toContain("m.rol = 'VISOR'");
  });

  test.each([
    ['propietario', 'PROPIETARIO'],
    ['administrador autorizado', 'ADMINISTRADOR'],
  ] as const)('%s modifica el límite del establecimiento y registra el evento en la misma transacción', async (_quien, rol) => {
    actor = { establecimientoId: eid, userId: rol === 'PROPIETARIO' ? ownerId : adminId, rol, principal: rol === 'PROPIETARIO', permisos: rol === 'ADMINISTRADOR' ? ['editar_limite_establecimiento'] : [], capacidades: [] };
    const response = res();
    await actualizarEstablecimiento(req({ polygon: geometriaNueva }), response);
    expect(response.json).toHaveBeenCalledOnce();
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO eventos_establecimiento'))).toBe(true);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notificaciones'))).toBe(true);
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    const seleccion = mock.query.mock.calls.find(([sql]) => String(sql).includes('SELECT DISTINCT m.user_id'))!;
    expect(seleccion[1]?.[3]).toBe(actor.userId);
  });

  test('guardar la misma geometría no registra otro evento ni notificación', async () => {
    const response = res();
    await actualizarLote(req({ polygon: geometriaVieja }), response);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO eventos_establecimiento'))).toBe(false);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notificaciones'))).toBe(false);
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  test('guardar el mismo límite de establecimiento no genera un aviso nuevo', async () => {
    const response = res();
    await actualizarEstablecimiento(req({ polygon: establecimiento }), response);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO eventos_establecimiento'))).toBe(false);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notificaciones'))).toBe(false);
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  test('un error al crear la notificación revierte la transacción completa', async () => {
    fallaNotificacion = true;
    const response = res();
    await expect(actualizarLote(req({ polygon: geometriaNueva }), response)).rejects.toThrow('fallo simulado');
    expect(mock.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mock.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });
});
