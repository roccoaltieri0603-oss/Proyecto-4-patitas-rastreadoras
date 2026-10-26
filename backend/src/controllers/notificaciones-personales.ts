import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { leerBooleano, leerPaginacion } from '../http/query.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function destinatario(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

export async function listarNotificacionesPersonales(req: Request, res: Response): Promise<void> {
  const userId = destinatario(req);
  const pag = leerPaginacion(req.query, 20);
  const noLeidas = leerBooleano(req.query, 'soloNoLeidas') === true;
  const filtro = noLeidas ? ' AND n.read_at IS NULL' : '';
  const [items, total, unread] = await Promise.all([
    pool.query(`SELECT n.id, n.establecimiento_id, e.nombre AS establecimiento_nombre, n.tipo,
        n.titulo, n.mensaje, n.metadata, n.created_at, n.read_at
      FROM notificaciones_personales n
      JOIN establecimientos e ON e.id = n.establecimiento_id
      WHERE n.user_id = $1 AND n.deleted_at IS NULL${filtro}
      ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`, [userId, pag.limit, pag.offset]),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text total FROM notificaciones_personales
      WHERE user_id = $1 AND deleted_at IS NULL${noLeidas ? ' AND read_at IS NULL' : ''}`, [userId]),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text total FROM notificaciones_personales
      WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL`, [userId]),
  ]);
  res.json({ notificaciones: items.rows.map((row) => ({ id: row.id, establecimientoId: row.establecimiento_id,
    establecimientoNombre: row.establecimiento_nombre,
    tipo: row.tipo, titulo: row.titulo, mensaje: row.mensaje, metadata: row.metadata,
    createdAt: row.created_at, leida: row.read_at !== null, readAt: row.read_at })),
    noLeidas: Number(unread.rows[0].total), paginacion: { ...pag, total: Number(total.rows[0].total),
      hayMas: pag.offset + items.rows.length < Number(total.rows[0].total) } });
}

export async function marcarTodasPersonalesLeidas(req: Request, res: Response): Promise<void> {
  const result = await pool.query(`UPDATE notificaciones_personales SET read_at = NOW()
    WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL`, [destinatario(req)]);
  res.json({ actualizadas: result.rowCount ?? 0 });
}

export async function marcarNotificacionPersonalLeida(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(`UPDATE notificaciones_personales SET read_at = COALESCE(read_at, NOW())
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [req.params.id, destinatario(req)]);
  if (!result.rows.length) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  res.status(204).send();
}

export async function eliminarNotificacionPersonalLeida(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(`UPDATE notificaciones_personales SET deleted_at = NOW()
    WHERE id = $1 AND user_id = $2 AND read_at IS NOT NULL AND deleted_at IS NULL RETURNING id`,
  [req.params.id, destinatario(req)]);
  if (result.rows.length) { res.status(204).send(); return; }
  const existe = await pool.query(`SELECT read_at, deleted_at FROM notificaciones_personales
    WHERE id = $1 AND user_id = $2`, [req.params.id, destinatario(req)]);
  if (!existe.rows.length || existe.rows[0].deleted_at) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  throw new ApiError(409, 'NOTIFICATION_UNREAD', 'Sólo podés eliminar notificaciones que ya marcaste como leídas.');
}
