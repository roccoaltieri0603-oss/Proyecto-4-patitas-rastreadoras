import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mocks.query } }));
import { listarNotificacionesPersonales, marcarTodasPersonalesLeidas } from '../../src/controllers/notificaciones-personales.js';

const usuarioId = '00000000-0000-4000-8000-000000000001';

function respuesta() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Response;
}

beforeEach(() => vi.clearAllMocks());

describe('avisos personales visibles', () => {
  test('lista avisos personales ligados al nombre del campo y al usuario autenticado', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'aviso-1', establecimiento_id: 'campo-1', establecimiento_nombre: 'Los Álamos',
        tipo: 'ingreso_forzado', titulo: 'Ingreso forzado a tu puesto', mensaje: 'Juan forzó el ingreso.',
        metadata: {}, created_at: new Date('2026-10-10T12:00:00Z'), read_at: null }] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });
    const res = respuesta();
    await listarNotificacionesPersonales({ usuario: { id: usuarioId }, query: {} } as unknown as Request, res);
    const [itemsSql, itemsParams] = mocks.query.mock.calls[0];
    expect(itemsSql).not.toContain('n.tipo =');
    expect(itemsSql).toContain('JOIN establecimientos e ON e.id = n.establecimiento_id');
    expect(itemsParams).toEqual([usuarioId, 20, 0]);
    for (const [sql] of mocks.query.mock.calls.slice(1)) expect(sql).toContain('user_id = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ notificaciones: [expect.objectContaining({
      establecimientoId: 'campo-1', establecimientoNombre: 'Los Álamos', tipo: 'ingreso_forzado',
    })] }));
  });

  test('marcar todos sólo actualiza los avisos personales visibles, sin borrar filas históricas', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const res = respuesta();
    await marcarTodasPersonalesLeidas({ usuario: { id: usuarioId } } as unknown as Request, res);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('user_id = ');
    expect(sql).toContain('read_at IS NULL AND deleted_at IS NULL');
    expect(sql).not.toMatch(/^\s*(?:DELETE|TRUNCATE)\b/im);
    expect(params).toEqual([usuarioId]);
  });
});
