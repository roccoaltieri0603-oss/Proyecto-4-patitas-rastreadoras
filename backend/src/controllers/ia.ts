import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { esPolygonFeature, type PolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { iaLotes } from '../services/ia-lotes.js';
import { depurarSugerencias } from '../services/sugerencias-lotes.js';

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

export function obtenerEstadoIa(_req: Request, res: Response): void {
  res.json({ configurado: iaLotes.configurado() });
}

/**
 * Propone una subdivisión en lotes para el establecimiento del usuario.
 *
 * No escribe nada: devuelve una propuesta que el frontend muestra como
 * borrador. Los lotes recién existen cuando el usuario confirma y el frontend
 * los manda uno por uno a `POST /api/lotes`, con las validaciones de siempre.
 */
export async function sugerirLotes(req: Request, res: Response): Promise<void> {
  const id = userId(req);

  const establecimiento = await pool.query<{ id: string; polygon: unknown }>(
    'SELECT id, polygon FROM establecimientos WHERE user_id = $1',
    [id],
  );
  const fila = establecimiento.rows[0];
  if (!fila) throw new ApiError(409, 'ESTABLISHMENT_REQUIRED', 'Primero tenés que crear un establecimiento.');
  if (!esPolygonFeature(fila.polygon)) {
    throw new ApiError(500, 'INVALID_STORED_POLYGON', 'El establecimiento tiene una geometría almacenada inválida.');
  }

  const existentes = await pool.query<{ polygon: unknown }>(
    'SELECT polygon FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL',
    [fila.id],
  );
  const lotesExistentes = existentes.rows
    .map((lote) => lote.polygon)
    .filter((polygon): polygon is PolygonFeature => esPolygonFeature(polygon));

  const { poligonos, meta } = await iaLotes.segmentar(fila.polygon);
  const { sugerencias, descartadas } = depurarSugerencias(poligonos, {
    establecimiento: fila.polygon,
    lotesExistentes,
  });

  res.json({
    sugerencias,
    meta: { ...meta, descartadas, generadoEn: new Date().toISOString() },
  });
}
