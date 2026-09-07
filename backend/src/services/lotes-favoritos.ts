import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';

export async function guardarFavorito(userId: string, loteId: string, favorito: boolean, establecimientoId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa cambios de preferencia y evita marcar un lote mientras se elimina.
    const lote = await client.query(
      `SELECT l.id FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id JOIN membresias m ON m.establecimiento_id = e.id
       WHERE l.id = $1 AND m.user_id = $2 AND e.id = $3 AND l.deleted_at IS NULL FOR UPDATE OF l`,
      [loteId, userId, establecimientoId],
    );
    if (!lote.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
    if (favorito) {
      await client.query('INSERT INTO lotes_favoritos (user_id, lote_id) VALUES ($1, $2) ON CONFLICT (user_id, lote_id) DO NOTHING', [userId, loteId]);
    } else {
      await client.query('DELETE FROM lotes_favoritos WHERE user_id = $1 AND lote_id = $2', [userId, loteId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
