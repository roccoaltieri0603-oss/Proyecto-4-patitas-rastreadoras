import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { registrarError } from '../http/logger.js';
import { persistirConsultaClima, type OrigenConsultaClima } from '../services/consultas-clima.js';
import { openMeteo, type LoteClima, type ResultadoClimaLote } from '../services/open-meteo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usuarioId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

function origen(value: unknown): OrigenConsultaClima {
  if (value !== 'automatico' && value !== 'manual') {
    throw new ApiError(400, 'INVALID_CLIMATE_ORIGIN', 'origen debe ser automatico o manual.');
  }
  return value;
}

function idsLotes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || value.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new ApiError(400, 'INVALID_LOT_IDS', 'loteIds debe ser un arreglo no vacío de IDs válidos.');
  }
  return [...new Set(value as string[])];
}

async function obtenerLotes(ids: string[], userId: string): Promise<LoteClima[]> {
  const result = await pool.query<{ id: string; polygon: unknown }>(
    `SELECT l.id, l.polygon
     FROM lotes l
     JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = ANY($1::uuid[])
       AND e.user_id = $2
       AND l.deleted_at IS NULL`,
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

type ResultadoActualizacion = ResultadoClimaLote & {
  persistencia?: Awaited<ReturnType<typeof persistirConsultaClima>>;
};

async function consultarYPersistir(
  lotes: LoteClima[],
  origenConsulta: OrigenConsultaClima,
  referencia: Date,
  req: Request,
): Promise<Record<string, ResultadoActualizacion>> {
  const consultados = await openMeteo.consultar(lotes, referencia);
  const resultados: Record<string, ResultadoActualizacion> = {};

  for (const lote of lotes) {
    const resultado = consultados[lote.id] ?? { estado: 'error' as const, loteId: lote.id, mensaje: 'Open-Meteo no devolvió un resultado para este lote.' };
    if (resultado.estado === 'error') {
      resultados[lote.id] = resultado;
      continue;
    }
    try {
      resultados[lote.id] = {
        ...resultado,
        persistencia: await persistirConsultaClima(resultado, origenConsulta, referencia),
      };
    } catch (error) {
      if (!(error instanceof ApiError)) registrarError(req, 500, error);
      resultados[lote.id] = {
        estado: 'error',
        loteId: lote.id,
        mensaje: error instanceof ApiError ? error.message : 'El clima se obtuvo, pero no pudo guardarse.',
      };
    }
  }
  return resultados;
}

export async function actualizarClimaLotes(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown> | null;
  const ids = idsLotes(body?.loteIds);
  const origenConsulta = origen(body?.origen);
  const referencia = new Date();
  const lotes = await obtenerLotes(ids, usuarioId(req));
  res.json({ resultados: await consultarYPersistir(lotes, origenConsulta, referencia, req) });
}

export async function actualizarClimaLote(req: Request, res: Response): Promise<void> {
  if (!UUID.test(req.params.id)) throw new ApiError(400, 'INVALID_LOT_ID', 'El ID de lote no es válido.');
  const origenConsulta = origen((req.body as Record<string, unknown> | null)?.origen);
  const referencia = new Date();
  const [lote] = await obtenerLotes([req.params.id], usuarioId(req));
  const resultados = await consultarYPersistir([lote], origenConsulta, referencia, req);
  res.json({ resultado: resultados[lote.id] });
}
