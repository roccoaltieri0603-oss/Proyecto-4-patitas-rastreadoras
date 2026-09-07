import { pool } from '../base-datos/pool.js';
import { diasEntreFechas, hoyCalendario } from '../fechas.js';
import type { CondicionLote, CondicionRadar, EstadisticaIndice, ResultadoLote } from '../copernicus/types.js';
import type { ResultadoClimaLote } from './open-meteo.js';

type Fila = Record<string, any>;
function stats(row: Fila, indice: string): EstadisticaIndice | null {
  const valores = Object.fromEntries(['media','mediana','min','max','desvio'].map(k => [k, row[`${indice}_${k}`]]));
  return Object.values(valores).every(v => typeof v === 'number' && Number.isFinite(v)) ? valores as unknown as EstadisticaIndice : null;
}
function optico(row: Fila | undefined, hoy: string): CondicionLote | undefined {
  if (!row) return;
  const ndvi = stats(row,'ndvi'), ndmi = stats(row,'ndmi'), ndwi = stats(row,'ndwi'), evi = stats(row,'evi');
  if (!ndvi || !ndmi || !ndwi || !evi || typeof row.puntaje !== 'number' || typeof row.cobertura_valida !== 'number' || !['excelente','buena','regular','baja'].includes(row.categoria)) return;
  return { fecha: row.observed_at, diasDesde: Math.max(0,diasEntreFechas(row.observed_at,hoy)), ndvi, ndmi, ndwi, evi, puntaje: row.puntaje, categoria: row.categoria, coberturaValida: row.cobertura_valida, alertas: Array.isArray(row.alertas) ? row.alertas : [], tendencia: [] };
}
export async function lecturasCompartidas(establecimientoId: string) {
  const lotes = await pool.query('SELECT id FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL ORDER BY numero', [establecimientoId]);
  const ids = lotes.rows.map(r => r.id);
  if (!ids.length) return { satelite: [], clima: {} };
  const [mediciones, consultas] = await Promise.all([
    pool.query('SELECT DISTINCT ON (lote_id, fuente) * FROM mediciones_satelitales WHERE lote_id = ANY($1::uuid[]) ORDER BY lote_id, fuente, observed_at DESC', [ids]),
    pool.query('SELECT DISTINCT ON (lote_id) * FROM consultas_clima WHERE lote_id = ANY($1::uuid[]) ORDER BY lote_id, consulted_at DESC', [ids]),
  ]);
  const dias = await pool.query('SELECT * FROM dias_clima WHERE consulta_clima_id = ANY($1::uuid[]) ORDER BY fecha', [consultas.rows.map(c => c.id)]);
  const hoy = hoyCalendario();
  const satelite: ResultadoLote[] = ids.map(loteId => {
    const filas = mediciones.rows.filter(m => m.lote_id === loteId);
    const opt = optico(filas.find(m => m.fuente === 'sentinel-2'), hoy);
    const radar = filas.find(m => m.fuente === 'sentinel-1');
    const rvi = radar ? stats(radar, 'rvi') : null;
    if (radar && rvi && (!opt || radar.observed_at > opt.fecha)) {
      const condicion: CondicionRadar = { fecha: radar.observed_at, diasDesde: Math.max(0,diasEntreFechas(radar.observed_at,hoy)), rvi };
      return { estado: 'radar', loteId, condicion, optico: opt, mensaje: 'Última observación persistida de radar; no es un puntaje óptico.' };
    }
    return opt ? { estado: 'ok', loteId, condicion: opt } : { estado: 'sin-datos', loteId, mensaje: 'Sin observación completa persistida. El historial permite consultar los campos disponibles.' };
  });
  const clima: Record<string, ResultadoClimaLote> = {};
  for (const c of consultas.rows) {
    const detalle = dias.rows.filter(d => d.consulta_clima_id === c.id).map(d => ({ fecha: d.fecha, lluviaMm: d.lluvia_mm, tempMin: d.temp_min, tempMax: d.temp_max, esPronostico: d.es_pronostico }));
    clima[c.lote_id] = { estado: 'ok', loteId: c.lote_id, categoria: c.categoria, clima: { consultadoEn: new Date(c.consulted_at).getTime(), dias: detalle, lluviaUltimos7Dias: c.lluvia_ultimos_7_dias, lluviaProximosDias: c.lluvia_proximos_dias, hoy: detalle.find(d => d.fecha === hoy) ?? null } };
  }
  return { satelite, clima };
}
