import { contexto } from '../autorizacion/membresia.js';
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
    establecimientoId: row.establecimiento_id,
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
  const miembro = contexto(req);
  if (miembro.rol === 'VISOR') throw new ApiError(403, 'NOTIFICATIONS_FORBIDDEN', 'La bandeja de notificaciones no está disponible para Visores.');
  const userId = usuarioId(req);
  const paginacion = leerPaginacion(req.query, 20);
  const soloNoLeidas = leerBooleano(req.query, 'soloNoLeidas');
  const filtro = soloNoLeidas === true ? ' AND read_at IS NULL' : '';
  const [items, total, noLeidas] = await Promise.all([
    pool.query(`SELECT id, establecimiento_id, lote_id, tipo, titulo, mensaje, read_at, metadata, created_at FROM notificaciones WHERE user_id = $1 AND establecimiento_id = $4 AND deleted_at IS NULL${filtro} ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [userId, paginacion.limit, paginacion.offset, miembro.establecimientoId]),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM notificaciones WHERE user_id = $1 AND establecimiento_id = $2 AND deleted_at IS NULL${filtro}`, [userId, miembro.establecimientoId]),
    pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM notificaciones WHERE user_id = $1 AND establecimiento_id = $2 AND read_at IS NULL AND deleted_at IS NULL', [userId, miembro.establecimientoId]),
  ]);
  const totalNumber = Number(total.rows[0].total);
  res.json({
    notificaciones: items.rows.map(dto),
    noLeidas: Number(noLeidas.rows[0].total),
    paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + items.rows.length < totalNumber },
  });
}

export async function marcarTodasLeidas(req: Request, res: Response): Promise<void> {
  const miembro = contexto(req);
  if (miembro.rol === 'VISOR') throw new ApiError(403, 'NOTIFICATIONS_FORBIDDEN', 'La bandeja de notificaciones no está disponible para Visores.');
  const result = await pool.query('UPDATE notificaciones SET read_at = NOW() WHERE user_id = $1 AND establecimiento_id = $2 AND read_at IS NULL AND deleted_at IS NULL', [usuarioId(req), miembro.establecimientoId]);
  res.json({ actualizadas: result.rowCount ?? 0 });
}

export async function marcarNotificacionLeida(req: Request, res: Response): Promise<void> {
  const miembro = contexto(req);
  if (miembro.rol === 'VISOR') throw new ApiError(403, 'NOTIFICATIONS_FORBIDDEN', 'La bandeja de notificaciones no está disponible para Visores.');
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(
    `UPDATE notificaciones SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2 AND establecimiento_id = $3 AND deleted_at IS NULL
     RETURNING id, establecimiento_id, lote_id, tipo, titulo, mensaje, read_at, metadata, created_at`,
    [req.params.id, usuarioId(req), miembro.establecimientoId],
  );
  if (!result.rows[0]) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  res.json({ notificacion: dto(result.rows[0]) });
}

export async function eliminarNotificacionLeida(req: Request, res: Response): Promise<void> {
  const miembro = contexto(req);
  if (miembro.rol === 'VISOR') throw new ApiError(403, 'NOTIFICATIONS_FORBIDDEN', 'La bandeja de notificaciones no está disponible para Visores.');
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const userId = usuarioId(req);
  const result = await pool.query(
    `UPDATE notificaciones SET deleted_at = NOW()
     WHERE id = $1 AND user_id = $2 AND establecimiento_id = $3
       AND read_at IS NOT NULL AND deleted_at IS NULL
     RETURNING id`,
    [req.params.id, userId, miembro.establecimientoId],
  );
  if (result.rows[0]) { res.status(204).send(); return; }

  const existente = await pool.query<{ read_at: Date | null; deleted_at: Date | null }>(
    `SELECT read_at, deleted_at FROM notificaciones
     WHERE id = $1 AND user_id = $2 AND establecimiento_id = $3`,
    [req.params.id, userId, miembro.establecimientoId],
  );
  if (!existente.rows[0] || existente.rows[0].deleted_at !== null) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  }
  throw new ApiError(409, 'NOTIFICATION_UNREAD', 'Sólo podés eliminar notificaciones que ya marcaste como leídas.');
}
