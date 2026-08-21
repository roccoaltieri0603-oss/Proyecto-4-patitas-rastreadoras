import { pool } from '../base-datos/pool.js';
import { diasEntreFechas, horasDesdeTimestamp, hoyCalendario } from '../fechas.js';

export interface EstadoLote {
  lote: { id: string; numero: number; apodo: string | null; activo: boolean };
  satelite: { optico: Record<string, unknown> | null; radar: Record<string, unknown> | null };
  clima: Record<string, unknown> | null;
  uso: { ultimoUso: { fecha: string; origen: string } | null; diasDescanso: number | null };
}

function estadisticas(row: Record<string, unknown>, prefijo: string) {
  return { media: row[`${prefijo}_media`], mediana: row[`${prefijo}_mediana`], min: row[`${prefijo}_min`], max: row[`${prefijo}_max`], desvio: row[`${prefijo}_desvio`] };
}

function estadoOptico(row: Record<string, unknown>, referencia: Date): Record<string, unknown> {
  const observedAt = row.observed_at as string;
  return {
    id: row.id,
    observedAt,
    consultedAt: row.consulted_at,
    diasDesdeObservacion: Math.max(0, diasEntreFechas(observedAt, hoyCalendario(referencia))),
    coberturaValida: row.cobertura_valida,
    ndvi: estadisticas(row, 'ndvi'),
    ndmi: estadisticas(row, 'ndmi'),
    ndwi: estadisticas(row, 'ndwi'),
    evi: estadisticas(row, 'evi'),
    puntaje: row.puntaje,
    categoria: row.categoria,
  };
}

function estadoRadar(row: Record<string, unknown>, referencia: Date): Record<string, unknown> {
  const observedAt = row.observed_at as string;
  return { id: row.id, observedAt, consultedAt: row.consulted_at, diasDesdeObservacion: Math.max(0, diasEntreFechas(observedAt, hoyCalendario(referencia))), rvi: estadisticas(row, 'rvi') };
}

export async function obtenerEstadosDeLotes(loteIds: string[], referencia = new Date()): Promise<EstadoLote[]> {
  if (loteIds.length === 0) return [];
  const ids = await pool.query('SELECT id, numero, apodo, activo FROM lotes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY numero ASC', [loteIds]);
  const idsPresentes = ids.rows.map((lote) => lote.id as string);
  if (idsPresentes.length === 0) return [];
  const [opticos, radares, climas, usos] = await Promise.all([
    pool.query('SELECT DISTINCT ON (lote_id) * FROM mediciones_satelitales WHERE lote_id = ANY($1::uuid[]) AND fuente = $2 ORDER BY lote_id, observed_at DESC, consulted_at DESC, id ASC', [idsPresentes, 'sentinel-2']),
    pool.query('SELECT DISTINCT ON (lote_id) * FROM mediciones_satelitales WHERE lote_id = ANY($1::uuid[]) AND fuente = $2 ORDER BY lote_id, observed_at DESC, consulted_at DESC, id ASC', [idsPresentes, 'sentinel-1']),
    pool.query('SELECT DISTINCT ON (lote_id) * FROM consultas_clima WHERE lote_id = ANY($1::uuid[]) ORDER BY lote_id, consulted_at DESC, id ASC', [idsPresentes]),
    pool.query('SELECT DISTINCT ON (lote_id) id, lote_id, fecha, origen, created_at FROM usos_lote WHERE lote_id = ANY($1::uuid[]) ORDER BY lote_id, fecha DESC, created_at DESC, id ASC', [idsPresentes]),
  ]);
  const climaIds = climas.rows.map((clima) => clima.id as string);
  const dias = climaIds.length === 0 ? { rows: [] } : await pool.query('SELECT consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max, es_pronostico FROM dias_clima WHERE consulta_clima_id = ANY($1::uuid[]) AND fecha = $2::date', [climaIds, hoyCalendario(referencia)]);
  const opticoPorLote = new Map(opticos.rows.map((row) => [row.lote_id as string, row]));
  const radarPorLote = new Map(radares.rows.map((row) => [row.lote_id as string, row]));
  const climaPorLote = new Map(climas.rows.map((row) => [row.lote_id as string, row]));
  const usoPorLote = new Map(usos.rows.map((row) => [row.lote_id as string, row]));
  const diaPorConsulta = new Map(dias.rows.map((row) => [row.consulta_clima_id as string, row]));
  const hoy = hoyCalendario(referencia);

  return ids.rows.map((lote) => {
    const loteId = lote.id as string;
    const consulta = climaPorLote.get(loteId);
    const dia = consulta ? diaPorConsulta.get(consulta.id as string) : undefined;
    const uso = usoPorLote.get(loteId);
    return {
      lote: { id: lote.id, numero: lote.numero, apodo: lote.apodo, activo: lote.activo },
      satelite: { optico: opticoPorLote.has(loteId) ? estadoOptico(opticoPorLote.get(loteId), referencia) : null, radar: radarPorLote.has(loteId) ? estadoRadar(radarPorLote.get(loteId), referencia) : null },
      clima: consulta ? { consultedAt: consulta.consulted_at, origen: consulta.origen, horasDesdeConsulta: horasDesdeTimestamp(consulta.consulted_at, referencia.getTime()), lluviaUltimos7Dias: consulta.lluvia_ultimos_7_dias, lluviaProximosDias: consulta.lluvia_proximos_dias, categoria: consulta.categoria, hoy: dia ? { fecha: dia.fecha, lluviaMm: dia.lluvia_mm, tempMin: dia.temp_min, tempMax: dia.temp_max, esPronostico: dia.es_pronostico } : null } : null,
      uso: { ultimoUso: uso ? { fecha: uso.fecha, origen: uso.origen } : null, diasDescanso: uso ? Math.max(0, diasEntreFechas(uso.fecha, hoy)) : null },
    };
  });
}
