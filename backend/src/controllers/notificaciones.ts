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

function destino(req: Request): [string, string, string] {
  const miembro = contexto(req);
  if (miembro.rol === 'VISOR') throw new ApiError(403, 'NOTIFICATIONS_FORBIDDEN', 'La bandeja de notificaciones no está disponible para Visores.');
  if (!miembro.puestoOperativoId) throw new ApiError(409, 'OPERATION_SESSION_REQUIRED', 'Entrá a una cuenta operativa para continuar.');
  return [miembro.puestoOperativoId, miembro.establecimientoId, usuarioId(req)];
}

// Las filas anteriores a 012 se muestran sólo en el puesto individual de su destinatario original.
const filtroDestinatario = `(n.puesto_operativo_id = $1 OR
  (n.puesto_operativo_id IS NULL AND n.user_id = $3 AND EXISTS (
    SELECT 1 FROM puestos_operativos p WHERE p.id = $1 AND p.establecimiento_id = $2
      AND (p.propietario_user_id = $3 OR p.legacy_user_id = $3))))`;

function dto(row: Record<string, unknown>) {
  const legacy = row.puesto_operativo_id == null;
  const mensajesHistoricos: Record<string, string> = {
    cambios_limites: 'Se modificaron los límites del establecimiento o de un lote.',
    permisos_modificados: 'Se modificaron los permisos de un miembro del equipo.',
    administrador_incorporado: 'Se incorporó un administrador al equipo.',
    administrador_eliminado: 'Un administrador dejó el equipo o cambió de rol.',
    propiedad_principal_transferida: 'Se transfirió la propiedad principal del establecimiento.',
    lote_eliminado: 'Se eliminó un lote del establecimiento.',
  };
  const titulosHistoricos: Record<string, string> = {
    cambios_limites: 'Límites modificados', permisos_modificados: 'Permisos modificados',
    administrador_incorporado: 'Administrador incorporado', administrador_eliminado: 'Cambio en el equipo',
    propiedad_principal_transferida: 'Propiedad principal transferida', lote_eliminado: 'Lote eliminado',
  };
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown> : {};
  const referencia = (valor: unknown) => {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
    const dato = valor as Record<string, unknown>;
    return typeof dato.numero === 'number' ? { numero: dato.numero,
      apodo: typeof dato.apodo === 'string' ? dato.apodo : null } : null;
  };
  const eventos = Array.isArray(metadata.eventos) ? metadata.eventos.map((evento: unknown) => {
    if (!evento || typeof evento !== 'object') return null;
    const detalles = (evento as Record<string, unknown>).detalles;
    return { detalles: { referenciaLote: referencia(
      detalles && typeof detalles === 'object' ? (detalles as Record<string, unknown>).referenciaLote : null) } };
  }).filter(Boolean) : [];
  return {
    id: row.id,
    establecimientoId: row.establecimiento_id,
    loteId: row.lote_id,
    tipo: row.tipo,
    titulo: legacy ? titulosHistoricos[String(row.tipo)] ?? 'Notificación histórica' : row.titulo,
    mensaje: legacy ? mensajesHistoricos[String(row.tipo)] ?? 'Notificación histórica del establecimiento.' : row.mensaje,
    leida: row.read_at !== null,
    readAt: row.read_at,
    metadata: { referenciaLote: referencia(metadata.referenciaLote), eventos },
    createdAt: row.created_at,
  };
}

export async function obtenerNotificaciones(req: Request, res: Response): Promise<void> {
  const parametros = destino(req);
  const paginacion = leerPaginacion(req.query, 20);
  const soloNoLeidas = leerBooleano(req.query, 'soloNoLeidas');
  const filtro = soloNoLeidas === true ? ' AND n.read_at IS NULL' : '';
  const [items, total, noLeidas] = await Promise.all([
    pool.query(`SELECT n.id, n.establecimiento_id, n.lote_id, n.tipo, n.titulo, n.mensaje, n.read_at, n.metadata, n.created_at, n.puesto_operativo_id
      FROM notificaciones n WHERE n.establecimiento_id = $2 AND ${filtroDestinatario}
        AND n.deleted_at IS NULL${filtro} ORDER BY n.created_at DESC, n.id DESC LIMIT $4 OFFSET $5`,
      [...parametros, paginacion.limit, paginacion.offset]),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM notificaciones n
      WHERE n.establecimiento_id = $2 AND ${filtroDestinatario} AND n.deleted_at IS NULL${filtro}`, parametros),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM notificaciones n
      WHERE n.establecimiento_id = $2 AND ${filtroDestinatario} AND n.read_at IS NULL AND n.deleted_at IS NULL`, parametros),
  ]);
  const totalNumber = Number(total.rows[0].total);
  res.json({
    notificaciones: items.rows.map(dto),
    noLeidas: Number(noLeidas.rows[0].total),
    paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + items.rows.length < totalNumber },
  });
}

export async function marcarTodasLeidas(req: Request, res: Response): Promise<void> {
  const result = await pool.query(`UPDATE notificaciones n SET read_at = NOW()
    WHERE n.establecimiento_id = $2 AND ${filtroDestinatario}
      AND n.read_at IS NULL AND n.deleted_at IS NULL`, destino(req));
  res.json({ actualizadas: result.rowCount ?? 0 });
}

export async function marcarNotificacionLeida(req: Request, res: Response): Promise<void> {
  const parametros = destino(req);
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(
    `UPDATE notificaciones n SET read_at = COALESCE(n.read_at, NOW())
     WHERE n.id = $4 AND n.establecimiento_id = $2 AND ${filtroDestinatario} AND n.deleted_at IS NULL
     RETURNING n.id, n.establecimiento_id, n.lote_id, n.tipo, n.titulo, n.mensaje, n.read_at, n.metadata, n.created_at, n.puesto_operativo_id`,
    [...parametros, req.params.id],
  );
  if (!result.rows[0]) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  res.json({ notificacion: dto(result.rows[0]) });
}

export async function eliminarNotificacionLeida(req: Request, res: Response): Promise<void> {
  const parametros = destino(req);
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'El ID de notificación no es válido.');
  const result = await pool.query(
    `UPDATE notificaciones n SET deleted_at = NOW()
     WHERE n.id = $4 AND n.establecimiento_id = $2 AND ${filtroDestinatario}
       AND n.read_at IS NOT NULL AND n.deleted_at IS NULL RETURNING n.id`,
    [...parametros, req.params.id],
  );
  if (result.rows[0]) { res.status(204).send(); return; }

  const existente = await pool.query<{ read_at: Date | null; deleted_at: Date | null }>(
    `SELECT n.read_at, n.deleted_at FROM notificaciones n
     WHERE n.id = $4 AND n.establecimiento_id = $2 AND ${filtroDestinatario}`,
    [...parametros, req.params.id],
  );
  if (!existente.rows[0] || existente.rows[0].deleted_at !== null) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notificación inexistente.');
  }
  throw new ApiError(409, 'NOTIFICATION_UNREAD', 'Sólo podés eliminar notificaciones que ya marcaste como leídas.');
}
