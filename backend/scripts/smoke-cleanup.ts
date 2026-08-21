import type { Pool, PoolClient } from 'pg';

const USERNAME_SMOKE = /^rodeo_smoke_[0-9]{13}$/;

export function validarUsernameSmoke(username: string | undefined): string {
  if (!username || !USERNAME_SMOKE.test(username)) {
    throw new Error('SMOKE_USERNAME no tiene el formato estricto rodeo_smoke_<timestamp>.');
  }
  return username;
}

async function limpiar(client: PoolClient, userId: string): Promise<void> {
  const lotes = `SELECT l.id FROM lotes l
    JOIN establecimientos e ON e.id = l.establecimiento_id
    WHERE e.user_id = $1`;
  await client.query('DELETE FROM notificaciones WHERE user_id = $1', [userId]);
  await client.query(`DELETE FROM usos_lote WHERE lote_id IN (${lotes})`, [userId]);
  await client.query(`DELETE FROM mediciones_satelitales WHERE lote_id IN (${lotes})`, [userId]);
  await client.query(`DELETE FROM dias_clima WHERE consulta_clima_id IN (
    SELECT c.id FROM consultas_clima c WHERE c.lote_id IN (${lotes})
  )`, [userId]);
  await client.query(`DELETE FROM consultas_clima WHERE lote_id IN (${lotes})`, [userId]);
  await client.query('DELETE FROM lotes WHERE establecimiento_id IN (SELECT id FROM establecimientos WHERE user_id = $1)', [userId]);
  await client.query('DELETE FROM establecimientos WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM usuarios WHERE id = $1', [userId]);
}

export async function eliminarUsuarioSmoke(db: Pool, usernameSinValidar: string | undefined): Promise<boolean> {
  const username = validarUsernameSmoke(usernameSinValidar);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const usuario = await client.query<{ id: string }>(
      'SELECT id FROM usuarios WHERE username = $1 FOR UPDATE',
      [username],
    );
    if (!usuario.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await limpiar(client, usuario.rows[0].id);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
