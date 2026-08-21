import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { esFechaCalendario, hoyCalendario } from '../fechas.js';
import { ApiError } from '../http/errors.js';
import { leerPaginacion, leerRangoCalendario, type Paginacion, type RangoCalendario } from '../http/query.js';
import { obtenerEstadosDeLotes } from '../services/estado-lotes.js';

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

async function loteDelUsuario(req: Request): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT l.id FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = $1 AND e.user_id = $2 AND l.deleted_at IS NULL`,
    [req.params.id, userId(req)],
  );
  if (!result.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  return result.rows[0].id;
}

function fechaCalendario(value: unknown, campo: string): string {
  if (!esFechaCalendario(value)) throw new ApiError(400, 'INVALID_DATE', `${campo} debe tener formato YYYY-MM-DD y ser válida.`);
  return value;
}

function measurementDto(row: Record<string, unknown>) {
  return {
    id: row.id, fuente: row.fuente, observedAt: row.observed_at, consultedAt: row.consulted_at,
    coberturaValida: row.cobertura_valida,
    ndvi: { media: row.ndvi_media, mediana: row.ndvi_mediana, min: row.ndvi_min, max: row.ndvi_max, desvio: row.ndvi_desvio },
    ndmi: { media: row.ndmi_media, mediana: row.ndmi_mediana, min: row.ndmi_min, max: row.ndmi_max, desvio: row.ndmi_desvio },
    ndwi: { media: row.ndwi_media, mediana: row.ndwi_mediana, min: row.ndwi_min, max: row.ndwi_max, desvio: row.ndwi_desvio },
    evi: { media: row.evi_media, mediana: row.evi_mediana, min: row.evi_min, max: row.evi_max, desvio: row.evi_desvio },
    rvi: { media: row.rvi_media, mediana: row.rvi_mediana, min: row.rvi_min, max: row.rvi_max, desvio: row.rvi_desvio },
    puntaje: row.puntaje, categoria: row.categoria, alertas: row.alertas, rawMetadata: row.raw_metadata,
  };
}

export async function obtenerMedicionesSatelitales(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelUsuario(req);
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const fuente = req.query.fuente;
  if (fuente !== undefined && (typeof fuente !== 'string' || (fuente !== 'sentinel-1' && fuente !== 'sentinel-2'))) {
    throw new ApiError(400, 'INVALID_SOURCE', 'La fuente satelital no es válida.');
  }
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (fuente) { valores.push(fuente); condiciones.push(`fuente = $${valores.length}`); }
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`observed_at >= $${valores.length}::date`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`observed_at <= $${valores.length}::date`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM mediciones_satelitales WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const result = await pool.query(`SELECT * FROM mediciones_satelitales WHERE ${where} ORDER BY observed_at DESC, fuente ASC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const totalNumber = Number(total.rows[0].total);
  res.json({ mediciones: result.rows.map(measurementDto), paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + result.rows.length < totalNumber } });
}

async function consultasClima(loteId: string, paginacion: Paginacion, rango: RangoCalendario) {
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`consulted_at >= ($${valores.length}::date AT TIME ZONE 'UTC')`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`consulted_at < (($${valores.length}::date + INTERVAL '1 day') AT TIME ZONE 'UTC')`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM consultas_clima WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const consultas = await pool.query(`SELECT * FROM consultas_clima WHERE ${where} ORDER BY consulted_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const ids = consultas.rows.map((consulta) => consulta.id as string);
  const dias = ids.length === 0 ? { rows: [] } : await pool.query('SELECT consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max, es_pronostico FROM dias_clima WHERE consulta_clima_id = ANY($1::uuid[]) ORDER BY fecha', [ids]);
  const diasPorConsulta = new Map<string, Array<Record<string, unknown>>>();
  for (const dia of dias.rows) {
    const lista = diasPorConsulta.get(dia.consulta_clima_id) ?? [];
    lista.push({ fecha: dia.fecha, lluviaMm: dia.lluvia_mm, tempMin: dia.temp_min, tempMax: dia.temp_max, esPronostico: dia.es_pronostico });
    diasPorConsulta.set(dia.consulta_clima_id, lista);
  }
  const items = consultas.rows.map((consulta) => ({ id: consulta.id, consultedAt: consulta.consulted_at, origen: consulta.origen, lluviaUltimos7Dias: consulta.lluvia_ultimos_7_dias, lluviaProximosDias: consulta.lluvia_proximos_dias, categoria: consulta.categoria, dias: diasPorConsulta.get(consulta.id) ?? [] }));
  const totalNumber = Number(total.rows[0].total);
  return { items, paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + items.length < totalNumber } };
}

export async function obtenerConsultasClima(req: Request, res: Response): Promise<void> {
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const resultado = await consultasClima(await loteDelUsuario(req), paginacion, rango);
  res.json({ consultas: resultado.items, paginacion: resultado.paginacion });
}

export async function crearUsoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelUsuario(req); const body = req.body as Record<string, unknown>;
  const fecha = fechaCalendario(body.fecha, 'fecha');
  if (fecha > hoyCalendario()) throw new ApiError(400, 'FUTURE_USE_DATE', 'La fecha de uso no puede ser futura.');
  const result = await pool.query('INSERT INTO usos_lote (lote_id, fecha, origen) VALUES ($1, $2, $3) RETURNING id, lote_id, fecha, origen, created_at', [loteId, fecha, typeof body.origen === 'string' ? body.origen : 'manual']);
  const uso = result.rows[0]; res.status(201).json({ uso: { id: uso.id, loteId: uso.lote_id, fecha: uso.fecha, origen: uso.origen, createdAt: uso.created_at } });
}

export async function obtenerUsosLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelUsuario(req);
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`fecha >= $${valores.length}::date`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`fecha <= $${valores.length}::date`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM usos_lote WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const result = await pool.query(`SELECT id, lote_id, fecha, origen, created_at FROM usos_lote WHERE ${where} ORDER BY fecha DESC, created_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const totalNumber = Number(total.rows[0].total);
  res.json({ usos: result.rows.map((uso) => ({ id: uso.id, loteId: uso.lote_id, fecha: uso.fecha, origen: uso.origen, createdAt: uso.created_at })), paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + result.rows.length < totalNumber } });
}

export async function obtenerEstadoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelUsuario(req);
  const [estado] = await obtenerEstadosDeLotes([loteId]);
  res.json(estado);
}

export async function obtenerHistorialLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelUsuario(req);
  const mediciones = await pool.query('SELECT * FROM mediciones_satelitales WHERE lote_id = $1 ORDER BY observed_at DESC, fuente ASC, id ASC LIMIT 51', [loteId]);
  const usos = await pool.query('SELECT id, lote_id, fecha, origen, created_at FROM usos_lote WHERE lote_id = $1 ORDER BY fecha DESC, created_at DESC, id ASC LIMIT 51', [loteId]);
  const clima = await consultasClima(loteId, { limit: 50, offset: 0 }, {});
  res.json({ satelite: mediciones.rows.slice(0, 50).map(measurementDto), clima: clima.items, usos: usos.rows.slice(0, 50).map((uso) => ({ id: uso.id, loteId: uso.lote_id, fecha: uso.fecha, origen: uso.origen, createdAt: uso.created_at })), paginacion: { satelite: { limit: 50, offset: 0, hayMas: mediciones.rows.length > 50 }, clima: clima.paginacion, usos: { limit: 50, offset: 0, hayMas: usos.rows.length > 50 } } });
}
