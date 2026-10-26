import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), conPastura: true, encontrados: [] as string[] }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: mock.connect } }));
vi.mock('../../src/base-datos/columnas-pastura.js', () => ({ columnasPasturaDisponibles: async () => mock.conPastura }));
import { MAXIMO_LOTES_PASTURA, asignarPasturaLotes } from '../../src/controllers/lotes.js';

const eid = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const lid1 = '00000000-0000-4000-8000-000000000011';
const lid2 = '00000000-0000-4000-8000-000000000012';
const actor: Membresia = { establecimientoId: eid, userId, rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] };

function req(body: unknown): Request {
  return { body, params: {}, usuario: { id: userId }, membresia: actor } as unknown as Request;
}
function res(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}
const numeros: Record<string, number> = { [lid1]: 1, [lid2]: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mock.conPastura = true;
  mock.encontrados = [lid2, lid1];
  mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FOR UPDATE')) return { rows: [{ id: eid }] };
    if (sql.startsWith('UPDATE lotes SET tipo_pastura')) {
      return { rows: mock.encontrados.map((id) => ({ id, numero: numeros[id], apodo: null, polygon: null, activo: true, tipo_pastura: values[0], fecha_siembra: null, created_at: new Date(), updated_at: new Date() })) };
    }
    if (sql.includes('FROM lotes_favoritos')) return { rows: [{ lote_id: lid2 }] };
    throw new Error(`Consulta no prevista: ${sql}`);
  });
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
});

describe('PATCH …/lotes/pastura', () => {
  test('guarda la misma pastura en todos los lotes del establecimiento y los devuelve por número', async () => {
    const response = res();
    await asignarPasturaLotes(req({ loteIds: [lid1, lid2, lid1], tipoPastura: 'festuca_alta' }), response);
    const update = mock.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE lotes SET tipo_pastura'))!;
    expect(String(update[0])).toContain('establecimiento_id = $2');
    expect(String(update[0])).toContain('deleted_at IS NULL');
    expect(update[1]).toEqual(['festuca_alta', eid, [lid1, lid2]]);
    expect(mock.query).toHaveBeenCalledWith('COMMIT');
    const { lotes } = vi.mocked(response.json).mock.calls[0][0];
    expect(lotes.map((lote: { numero: number }) => lote.numero)).toEqual([1, 2]);
    expect(lotes).toEqual([
      expect.objectContaining({ id: lid1, tipoPastura: 'festuca_alta', favorito: false }),
      expect.objectContaining({ id: lid2, tipoPastura: 'festuca_alta', favorito: true }),
    ]);
    expect(mock.release).toHaveBeenCalled();
  });

  test('si algún lote es ajeno o está eliminado, no guarda ninguno', async () => {
    mock.encontrados = [lid1];
    await expect(asignarPasturaLotes(req({ loteIds: [lid1, lid2], tipoPastura: 'alfalfa' }), res())).rejects.toMatchObject({ status: 404, code: 'LOT_NOT_FOUND' });
    expect(mock.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mock.query).not.toHaveBeenCalledWith('COMMIT');
  });

  test.each([
    [{ tipoPastura: 'alfalfa' }, 'INVALID_LOT_IDS'],
    [{ loteIds: [], tipoPastura: 'alfalfa' }, 'INVALID_LOT_IDS'],
    [{ loteIds: ['no-es-uuid'], tipoPastura: 'alfalfa' }, 'INVALID_LOT_IDS'],
    [{ loteIds: Array(MAXIMO_LOTES_PASTURA + 1).fill(lid1), tipoPastura: 'alfalfa' }, 'INVALID_LOT_IDS'],
    [{ loteIds: [lid1], tipoPastura: 'soja' }, 'INVALID_PASTURE_TYPE'],
    [{ loteIds: [lid1], tipoPastura: null }, 'INVALID_PASTURE_TYPE'],
  ])('rechaza %j con %s sin tocar la base', async (body, codigo) => {
    await expect(asignarPasturaLotes(req(body), res())).rejects.toMatchObject({ status: 400, code: codigo });
    expect(mock.connect).not.toHaveBeenCalled();
  });

  test('sin la migración 015 responde un error explícito', async () => {
    mock.conPastura = false;
    await expect(asignarPasturaLotes(req({ loteIds: [lid1], tipoPastura: 'alfalfa' }), res())).rejects.toMatchObject({ status: 503, code: 'PASTURE_MIGRATION_PENDING' });
    expect(mock.connect).not.toHaveBeenCalled();
  });
});
