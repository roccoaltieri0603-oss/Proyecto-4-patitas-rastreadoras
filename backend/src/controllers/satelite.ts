import type { Request, Response } from 'express';
import { analizadorSatelital } from '../copernicus/analizar.js';
import type { LoteSatelital } from '../copernicus/types.js';
import { pool } from '../base-datos/pool.js';
import { esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { persistirResultadoSatelital } from '../services/mediciones-satelitales.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usuarioId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

function validarIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || value.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new ApiError(400, 'INVALID_LOT_IDS', 'loteIds debe ser un arreglo no vacío de IDs válidos.');
  }
  return [...new Set(value as string[])];
}

async function obtenerLotes(ids: string[], userId: string): Promise<LoteSatelital[]> {
  const result = await pool.query<{ id: string; polygon: unknown }>(
    `SELECT l.id, l.polygon FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = ANY($1::uuid[]) AND e.user_id = $2 AND l.deleted_at IS NULL`,
    [ids, userId],
  );
  if (result.rows.length !== ids.length) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  const porId = new Map(result.rows.map((row) => [row.id, row.polygon]));
  return ids.map((id) => {
    const polygon = porId.get(id);
    if (!esPolygonFeature(polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'El lote tiene una geometría almacenada inválida.');
    return { id, polygon };
  });
}

async function actualizar(lotes: LoteSatelital[], referencia: Date) {
  const resultados = await analizadorSatelital.analizarLotes(lotes, referencia);
  for (const resultado of resultados) await persistirResultadoSatelital(resultado, referencia);
  return resultados;
}

export async function actualizarSateliteLotes(req: Request, res: Response): Promise<void> {
  const ids = validarIds((req.body as Record<string, unknown> | null)?.loteIds);
  const referencia = new Date();
  const lotes = await obtenerLotes(ids, usuarioId(req));
  res.json({ resultados: await actualizar(lotes, referencia) });
}

export async function actualizarSateliteLote(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_LOT_ID', 'El ID de lote no es válido.');
  const referencia = new Date();
  const [lote] = await obtenerLotes([req.params.id], usuarioId(req));
  const [resultado] = await actualizar([lote], referencia);
  res.json({ resultado });
}
