import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request } from 'express';
import { ApiError } from '../../src/http/errors.js';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: db }));
import { eliminarNotificacionLeida, marcarNotificacionLeida, marcarTodasLeidas, obtenerNotificaciones } from '../../src/controllers/notificaciones.js';

const establecimientoId = '00000000-0000-4000-8000-000000000001';
const propietarioId = '00000000-0000-4000-8000-000000000002';
const idLeida = '00000000-0000-4000-8000-000000000003';
const idNoLeida = '00000000-0000-4000-8000-000000000004';
const otraCuentaId = '00000000-0000-4000-8000-000000000005';
const otroEstablecimientoId = '00000000-0000-4000-8000-000000000006';
const puestoId = '00000000-0000-4000-8000-000000000007';
const otroPuestoId = '00000000-0000-4000-8000-000000000008';

type Row = { id: string; puesto_operativo_id: string; establecimiento_id: string; read_at: Date | null; deleted_at: Date | null; created_at: Date; tipo: string; titulo: string; mensaje: string; lote_id: null; metadata: null };
let filas: Row[];
let auditoria: string[];

function request(rol: 'PROPIETARIO' | 'ADMINISTRADOR' | 'VISOR' = 'ADMINISTRADOR', id = propietarioId, eid = establecimientoId, post = puestoId): Request {
  return {
    params: { id: idLeida }, query: {},
    usuario: { id },
    membresia: { establecimientoId: eid, userId: id, puestoOperativoId: post, rol, principal: rol === 'PROPIETARIO', permisos: [], capacidades: [] },
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
    { id: idLeida, puesto_operativo_id: puestoId, establecimiento_id: establecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: idNoLeida, puesto_operativo_id: puestoId, establecimiento_id: establecimientoId, read_at: null, deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: otraCuentaId, puesto_operativo_id: otroPuestoId, establecimiento_id: establecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
    { id: otroEstablecimientoId, puesto_operativo_id: puestoId, establecimiento_id: otroEstablecimientoId, read_at: new Date(), deleted_at: null, created_at: new Date(), tipo: 'cambios_limites', titulo: 'Límites modificados', mensaje: 'Cambio', lote_id: null, metadata: null },
  ];
  auditoria = ['evento-preservado', 'entrega-preservada'];
  db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SET deleted_at = NOW()')) {
      const row = filas.find((item) => item.id === values[3] && item.puesto_operativo_id === values[0] && item.establecimiento_id === values[1] && item.read_at !== null && item.deleted_at === null);
      if (!row) return { rows: [] };
      row.deleted_at = new Date();
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('SELECT n.read_at, n.deleted_at')) {
      const row = filas.find((item) => item.id === values[3] && item.puesto_operativo_id === values[0] && item.establecimiento_id === values[1]);
      return { rows: row ? [{ read_at: row.read_at, deleted_at: row.deleted_at }] : [] };
    }
    if (sql.includes('COUNT(*)')) {
      const visible = filas.filter((row) => row.puesto_operativo_id === values[0] && row.establecimiento_id === values[1] && row.deleted_at === null);
      const noLeidas = sql.includes('read_at IS NULL');
      return { rows: [{ total: String(visible.filter((row) => !noLeidas || row.read_at === null).length) }] };
    }
    if (sql.includes('SELECT n.id, n.establecimiento_id')) {
      return { rows: filas.filter((row) => row.puesto_operativo_id === values[0] && row.establecimiento_id === values[1] && row.deleted_at === null).slice(values[4] as number, (values[4] as number) + (values[3] as number)) };
    }
    if (sql.includes('UPDATE notificaciones n SET read_at')) {
      expect(sql).toContain('deleted_at IS NULL');
      if (sql.includes('COALESCE(n.read_at, NOW())')) {
        const row = filas.find(item => item.id === values[3] && item.puesto_operativo_id === values[0] && item.establecimiento_id === values[1] && item.deleted_at === null);
        if (row) { row.read_at ??= new Date(); return { rows: [row], rowCount: 1 }; }
      }
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
    ['otro puesto', otroPuestoId, establecimientoId],
    ['otro establecimiento', puestoId, otroEstablecimientoId],
  ])('no permite ocultar una notificación de %s', async (_caso, post, eid) => {
    const req = request('ADMINISTRADOR', propietarioId, eid, post);
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
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), [puestoId, establecimientoId, propietarioId]);
  });

  test('dos trabajadores del mismo puesto comparten lectura y eliminación', async () => {
    const pedro = request('ADMINISTRADOR', propietarioId);
    pedro.params.id = idNoLeida;
    await marcarNotificacionLeida(pedro, response() as never);
    expect(filas.find(row => row.id === idNoLeida)?.read_at).toBeInstanceOf(Date);
    const juan = request('ADMINISTRADOR', otraCuentaId);
    juan.params.id = idNoLeida;
    const bandeja = response();
    await obtenerNotificaciones(juan, bandeja as never);
    expect(bandeja.json.mock.calls[0][0].notificaciones.find((row: { id: string }) => row.id === idNoLeida)?.leida).toBe(true);
    await eliminarNotificacionLeida(juan, response() as never);
    expect(filas.find(row => row.id === idNoLeida)?.deleted_at).toBeInstanceOf(Date);
  });

  test('una notificación histórica no expone nombre personal ni metadatos de auditoría', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '1' }] };
      return { rows: [{ id: idLeida, establecimiento_id: establecimientoId, puesto_operativo_id: null,
        lote_id: null, tipo: 'cambios_limites', titulo: 'Pedro modificó límites',
        mensaje: 'Pedro modificó límites', read_at: new Date(), created_at: new Date(),
        metadata: { username: 'Pedro', eventos: [{ detalles: { username: 'Pedro' } }] } }] };
    });
    const res = response();
    await obtenerNotificaciones(request(), res as never);
    const aviso = res.json.mock.calls[0][0].notificaciones[0];
    expect(aviso.titulo).toBe('Límites modificados');
    expect(aviso.mensaje).toBe('Se modificaron los límites del establecimiento o de un lote.');
    expect(JSON.stringify(aviso)).not.toContain('Pedro');
    expect(db.query.mock.calls[0][0]).toContain('n.user_id = $3');
    expect(db.query.mock.calls[0][0]).toContain('p.legacy_user_id = $3');
  });
});
