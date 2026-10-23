import type { Request, Response } from 'express';
import { contexto } from '../autorizacion/membresia.js';
import { pool } from '../base-datos/pool.js';
import { diasEntreFechas, esFechaCalendario, hoyCalendario, sumarDias } from '../fechas.js';
import { ApiError } from '../http/errors.js';
import { obtenerEstimacionForraje, obtenerEstimacionesForraje } from '../services/estimacion-forraje.js';

export const DIAS_POR_DEFECTO = 60;
/** Acota la ventana para que una consulta no recorra años de clima. */
export const MAXIMO_DIAS_HACIA_ATRAS = 365;

function leerDesde(valor: unknown, hoy: string): string {
  if (valor === undefined) return sumarDias(hoy, -DIAS_POR_DEFECTO);
  if (typeof valor !== 'string' || !esFechaCalendario(valor)) throw new ApiError(400, 'INVALID_DATE', 'desde debe tener formato YYYY-MM-DD y ser válida.');
  if (valor > hoy) throw new ApiError(400, 'INVALID_DATE', 'desde no puede ser futura.');
  if (diasEntreFechas(valor, hoy) > MAXIMO_DIAS_HACIA_ATRAS) throw new ApiError(400, 'INVALID_DATE', `desde no puede ser anterior a ${MAXIMO_DIAS_HACIA_ATRAS} días.`);
  return valor;
}

export async function obtenerEstimacion(req: Request, res: Response): Promise<void> {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  const hoy = hoyCalendario();
  const desde = leerDesde(req.query.desde, hoy);
  const lote = await pool.query<{ id: string }>(
    `SELECT l.id FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
      WHERE l.id = $1 AND e.id = $2 AND l.deleted_at IS NULL`,
    [req.params.id, contexto(req).establecimientoId],
  );
  if (!lote.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  res.json({ estimacion: await obtenerEstimacionForraje(lote.rows[0].id, desde, hoy) });
}

/** Todos los lotes activos del establecimiento de la URL, en una sola respuesta. */
export async function obtenerEstimaciones(req: Request, res: Response): Promise<void> {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  const hoy = hoyCalendario();
  const desde = leerDesde(req.query.desde, hoy);
  res.json({ estimaciones: await obtenerEstimacionesForraje(contexto(req).establecimientoId, desde, hoy) });
}
