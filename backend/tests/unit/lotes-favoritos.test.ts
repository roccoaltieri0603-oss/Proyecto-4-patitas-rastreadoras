import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: db.query, connect: db.connect } }));
import { actualizarFavoritoLote, obtenerLotes } from '../../src/controllers/lotes.js';
import { guardarFavorito } from '../../src/services/lotes-favoritos.js';

const loteId = '00000000-0000-4000-8000-000000000001';
const usuarioId = '00000000-0000-4000-8000-000000000002';
const req = (body: unknown = { favorito: true }) => ({ params: { id: loteId }, body, usuario: { id: usuarioId } }) as unknown as Request;
const res = () => ({ json: vi.fn() }) as unknown as Response;

beforeEach(() => {
  vi.resetAllMocks();
  db.connect.mockResolvedValue({ query: db.query, release: db.release });
  db.query.mockResolvedValue({ rows: [] });
});

describe('favoritos sin conexión a PostgreSQL', () => {
  test.each([{}, { favorito: null }, { favorito: 'true' }, { favorito: 1 }, { favorito: [] }, null])('rechaza body inválido %j antes de consultar DB', async (body) => {
    await expect(actualizarFavoritoLote(req(body), res())).rejects.toMatchObject({ status: 400, code: 'INVALID_FAVORITE_FLAG' });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('requiere usuario y valida UUID', async () => {
    const anonimo = req(); delete anonimo.usuario;
    await expect(actualizarFavoritoLote(anonimo, res())).rejects.toMatchObject({ status: 401 });
    const invalido = req(); invalido.params.id = 'no-uuid';
    await expect(actualizarFavoritoLote(invalido, res())).rejects.toMatchObject({ status: 400, code: 'INVALID_LOT_ID' });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test.each([true, false])('no modifica preferencias si ownership/soft delete no encuentra lote (%s)', async (favorito) => {
    await expect(guardarFavorito(usuarioId, loteId, favorito)).rejects.toMatchObject({ status: 404, code: 'LOT_NOT_FOUND' });
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('e.user_id = $2 AND l.deleted_at IS NULL FOR UPDATE OF l'), [loteId, usuarioId]);
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => /INSERT|DELETE|UPDATE lotes SET/.test(sql))).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });

  test.each([true, false])('usa el usuario autenticado, confirma y devuelve preferencia (%s)', async (favorito) => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: loteId }] });
    const response = res();
    await actualizarFavoritoLote(req({ favorito, user_id: 'ignorado' }), response);
    expect(db.query).toHaveBeenNthCalledWith(3, favorito
      ? 'INSERT INTO lotes_favoritos (user_id, lote_id) VALUES ($1, $2) ON CONFLICT (user_id, lote_id) DO NOTHING'
      : 'DELETE FROM lotes_favoritos WHERE user_id = $1 AND lote_id = $2', [usuarioId, loteId]);
    expect(db.query).toHaveBeenLastCalledWith('COMMIT');
    expect(response.json).toHaveBeenCalledWith({ loteId, favorito });
    expect(db.release).toHaveBeenCalledOnce();
  });

  test('hace rollback y libera conexión si falla persistencia', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: loteId }] }).mockRejectedValueOnce(new Error('fallo DB'));
    await expect(guardarFavorito(usuarioId, loteId, true)).rejects.toThrow('fallo DB');
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(db.release).toHaveBeenCalledOnce();
  });

  test.each([false, true])('GET conserva el favorito consultado para el usuario (%s)', async (favorito) => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'establecimiento' }] }).mockResolvedValueOnce({ rows: [{ id: loteId, favorito }] });
    const response = res();
    await obtenerLotes(req(), response);
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('f.user_id = $2'), ['establecimiento', usuarioId]);
    expect(response.json).toHaveBeenCalledWith({ lotes: [expect.objectContaining({ id: loteId, favorito })] });
  });
});
