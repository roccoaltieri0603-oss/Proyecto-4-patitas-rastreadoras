import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request } from 'express';
import { ApiError } from '../../src/http/errors.js';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: db }));
import { eliminarNotificacionLeida, marcarTodasLeidas, obtenerNotificaciones } from '../../src/controllers/notificaciones.js';

const establecimientoId = '00000000-0000-4000-8000-000000000001';
const propietarioId = '00000000-0000-4000-8000-000000000002';
const idLeida = '00000000-0000-4000-8000-000000000003';
const idNoLeida = '00000000-0000-4000-8000-000000000004';
const otraCuentaId = '00000000-0000-4000-8000-000000000005';
const otroEstablecimientoId = '00000000-0000-4000-8000-000000000006';

type Row = { id: string; user_id: string; establecimiento_id: string; read_at: Date | null; deleted_at: Date | null; created_at: Date; tipo: string; titulo: string; mensaje: string; lote_id: null; metadata: null };
let filas: Row[];
let auditoria: string[];

function request(rol: 'PROPIETARIO' | 'ADMINISTRADOR' | 'VISOR' = 'PROPIETARIO', id = propietarioId, eid = establecimientoId): Request {
  return {
    params: { id: idLeida }, query: {},
    usuario: { id },
    membresia: { establecimientoId: eid, userId: id, rol, principal: rol === 'PROPIETARIO', permisos: [], capacidades: [] },
  } as unknown as Request;
}

function response() {
  const res = { status: vi.fn(), send: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  filas = [
    { id: idLeida, user_id: propietarioId, establecimiento_id: establecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: idNoLeida, user_id: propietarioId, establecimiento_id: establecimientoId, read_at: null, deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: otraCuentaId, user_id: otraCuentaId, establecimiento_id: establecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: otroEstablecimientoId, user_id: propietarioId, establecimiento_id: otroEstablecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
  ];
  auditoria = ['evento-preservado', 'entrega-preservada'];
  db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('UPDATE notificaciones SET deleted_at')) {
      const row = filas.find((item) => item.id === values[0] && item.user_id === values[1] && item.establecimiento_id === values[2] && item.read_at !== null && item.deleted_at === null);
      if (!row) return { rows: [] };
      row.deleted_at = new Date();
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('SELECT read_at, deleted_at')) {
      const row = filas.find((item) => item.id === values[0] && item.user_id === values[1] && item.establecimiento_id === values[2]);
      return { rows: row ? [{ read_at: row.read_at, deleted_at: row.deleted_at }] : [] };
    }
    if (sql.includes('COUNT(*)')) {
      const visible = filas.filter((row) => row.user_id === values[0] && row.establecimiento_id === values[1] && row.deleted_at === null);
      const noLeidas = sql.includes('read_at IS NULL');
      return { rows: [{ total: String(visible.filter((row) => !noLeidas || row.read_at === null).length) }] };
    }
    if (sql.startsWith('SELECT id, establecimiento_id')) {
      return { rows: filas.filter((row) => row.user_id === values[0] && row.establecimiento_id === values[3] && row.deleted_at === null).slice(values[2] as number, (values[2] as number) + (values[1] as number)) };
    }
    if (sql.startsWith('UPDATE notificaciones SET read_at')) {
      expect(sql).toContain('deleted_at IS NULL');
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Consulta no prevista en el test: ${sql}`);
  });
});

describe('bandeja: ocultamiento lógico por destinatario', () => {
  test('rechaza eliminar una notificación no leída con error explícito', async () => {
    const req = request(); req.params.id = idNoLeida;
    await expect(eliminarNotificacionLeida(req, response() as never)).rejects.toMatchObject({ status: 409, code: 'NOTIFICATION_UNREAD' });
    expect(filas.find((row) => row.id === idNoLeida)?.deleted_at).toBeNull();
  });

  test('oculta de forma persistente una notificación leída sin borrar auditoría ni entregas', async () => {
    const res = response();
    await eliminarNotificacionLeida(request(), res as never);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(filas.find((row) => row.id === idLeida)?.deleted_at).toBeInstanceOf(Date);
    expect(auditoria).toEqual(['evento-preservado', 'entrega-preservada']);
    expect(db.query.mock.calls.some(([sql]) => String(sql).startsWith('DELETE FROM'))).toBe(false);

    const bandeja = response();
    await obtenerNotificaciones(request(), bandeja as never);
    expect(bandeja.json.mock.calls[0][0].notificaciones.map((row: Row) => row.id)).not.toContain(idLeida);
    expect(bandeja.json.mock.calls[0][0].paginacion.total).toBe(1);
    expect(bandeja.json.mock.calls[0][0].noLeidas).toBe(1);
  });

  test.each([
    ['otra cuenta', otraCuentaId, establecimientoId],
    ['otro establecimiento', propietarioId, otroEstablecimientoId],
  ])('no permite ocultar una notificación de %s', async (_caso, id, eid) => {
    const req = request('PROPIETARIO', id, eid);
    await expect(eliminarNotificacionLeida(req, response() as never)).rejects.toMatchObject({ status: 404, code: 'NOTIFICATION_NOT_FOUND' });
    expect(filas.find((row) => row.id === idLeida)?.deleted_at).toBeNull();
  });

  test('el Visor no puede eliminar ni consultar la bandeja', async () => {
    const req = request('VISOR');
    await expect(eliminarNotificacionLeida(req, response() as never)).rejects.toMatchObject({ status: 403, code: 'NOTIFICATIONS_FORBIDDEN' });
    await expect(obtenerNotificaciones(req, response() as never)).rejects.toMatchObject({ status: 403, code: 'NOTIFICATIONS_FORBIDDEN' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('marcar todas sólo actualiza notificaciones visibles', async () => {
    const res = response();
    await marcarTodasLeidas(request(), res as never);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), [propietarioId, establecimientoId]);
  });
});
