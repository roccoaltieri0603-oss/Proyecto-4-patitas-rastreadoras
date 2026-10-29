import { contexto } from '../autorizacion/membresia.js';
import type { Request, Response } from 'express';
import { analizadorSatelital } from '../copernicus/analizar.js';
import type { LoteSatelital } from '../copernicus/types.js';
import { pool } from '../base-datos/pool.js';
import { esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { persistirResultadoSatelital } from '../services/mediciones-satelitales.js';
import { registrarError } from '../http/logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function establecimientoId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return contexto(req).establecimientoId;
}

function validarIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || value.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new ApiError(400, 'INVALID_LOT_IDS', 'loteIds debe ser un arreglo no vacío de IDs válidos.');
  }
  return [...new Set(value as string[])];
}

async function obtenerLotes(ids: string[], establecimientoId: string): Promise<LoteSatelital[]> {
  const result = await pool.query<{ id: string; polygon: unknown }>(
    `SELECT l.id, l.polygon FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = ANY($1::uuid[]) AND e.id = $2 AND l.deleted_at IS NULL`,
    [ids, establecimientoId],
  );
  if (result.rows.length !== ids.length) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  const porId = new Map(result.rows.map((row) => [row.id, row.polygon]));
  return ids.map((id) => {
    const polygon = porId.get(id);
    if (!esPolygonFeature(polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'El lote tiene una geometría almacenada inválida.');
    return { id, polygon };
  });
}

async function actualizar(lotes: LoteSatelital[], referencia: Date, req: Request) {
  const resultados = await analizadorSatelital.analizarLotes(lotes, referencia);
  const erroresPersistencia: { loteId: string; mensaje: string }[] = [];
  for (const resultado of resultados) {
    try { await persistirResultadoSatelital(resultado, referencia); }
    catch (error) {
      erroresPersistencia.push({ loteId: resultado.loteId, mensaje: 'No se pudo guardar el resultado satelital.' });
      registrarError(req, 500, error);
    }
  }
  return { resultados, erroresPersistencia };
}

export async function actualizarSateliteLotes(req: Request, res: Response): Promise<void> {
  const ids = validarIds((req.body as Record<string, unknown> | null)?.loteIds);
  const referencia = new Date();
  const lotes = await obtenerLotes(ids, establecimientoId(req));
  const { resultados, erroresPersistencia } = await actualizar(lotes, referencia, req);
  const idsRespondidos = new Set(resultados.map((resultado) => resultado.loteId));
  const pendientes = ids.filter((id) => !idsRespondidos.has(id));
  const corteCopernicus = resultados.some((resultado) => resultado.limiteCopernicus) || pendientes.length > 0;
  res.json({
    resultados,
    estado: corteCopernicus || erroresPersistencia.length ? 'parcial' : 'completo',
    ...(corteCopernicus ? { motivoCorte: 'Copernicus limitó las consultas; se detuvo el lote para respetar el límite del proveedor.' } : {}),
    pendientes,
    erroresPersistencia,
  });
}

export async function actualizarSateliteLote(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_LOT_ID', 'El ID de lote no es válido.');
  const referencia = new Date();
  const [lote] = await obtenerLotes([req.params.id], establecimientoId(req));
  const { resultados, erroresPersistencia } = await actualizar([lote], referencia, req);
  const resultado = resultados[0];
  res.json({ resultado, erroresPersistencia, corteCopernicus: resultado?.limiteCopernicus === true });
}
