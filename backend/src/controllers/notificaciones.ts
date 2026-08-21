import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { leerBooleano, leerPaginacion } from '../http/query.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usuarioId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    loteId: row.lote_id,
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    leida: row.read_at !== null,
    readAt: row.read_at,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function obtenerNotificaciones(req: Request, res: Response): Promise<void> {
  const userId = usuarioId(req);
  const paginacion = leerPaginacion(req.query, 20);
  const soloNoLeidas = leerBooleano(req.query, 'soloNoLeidas');
  const filtro = soloNoLeidas === true ? ' AND read_at IS NULL' : '';
  const [items, total, noLeidas] = await Promise.all([
    pool.query(`SELECT id, lote_id, tipo, titulo, mensaje, read_at, metadata, created_at FROM notificaciones WHERE user_id = $1${filtro} ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [userId, paginacion.limit, paginacion.offset]),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM notificaciones WHERE user_id = $1${filtro}`, [userId]),
    pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM notificaciones WHERE user_id = $1 AND read_at IS NULL', [userId]),
  ]);
  const totalNumber = Number(total.rows[0].total);
  res.json({
    notificaciones: items.rows.map(dto),
    noLeidas: Number(noLeidas.rows[0].total),
    paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + items.rows.length < totalNumber },
  });
}

export async function marcarTodasLeidas(req: Request, res: Response): Promise<void> {
  const result = await pool.query('UPDATE notificaciones SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [usuarioId(req)]);
  res.json({ actualizadas: result.rowCount ?? 0 });
}

export async function marcarNotificacionLeida(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(
    `UPDATE notificaciones SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id, lote_id, tipo, titulo, mensaje, read_at, metadata, created_at`,
    [req.params.id, usuarioId(req)],
  );
  if (!result.rows[0]) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  res.json({ notificacion: dto(result.rows[0]) });
}
