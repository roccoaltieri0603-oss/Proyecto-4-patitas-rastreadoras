import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import type { EstadisticaIndice, ResultadoLote } from '../copernicus/types.js';

export interface MedicionSatelitalPersistible {
  fuente: 'sentinel-1' | 'sentinel-2';
  observedAt: string;
  consultedAt: Date;
  coberturaValida?: number | null;
  ndvi?: EstadisticaPersistible;
  ndmi?: EstadisticaPersistible;
  ndwi?: EstadisticaPersistible;
  evi?: EstadisticaPersistible;
  rvi?: EstadisticaPersistible;
  puntaje?: number | null;
  categoria?: string | null;
  alertas?: string[] | null;
  rawMetadata?: unknown;
}

type Queryable = Pick<PoolClient, 'query'>;
type EstadisticaPersistible = Partial<Record<keyof EstadisticaIndice, number | null>>;

function campos(stats?: EstadisticaPersistible): Array<number | null> {
  return [stats?.media ?? null, stats?.mediana ?? null, stats?.min ?? null, stats?.max ?? null, stats?.desvio ?? null];
}

function jsonb(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export async function guardarMedicionSatelital(queryable: Queryable, loteId: string, medicion: MedicionSatelitalPersistible): Promise<Record<string, unknown>> {
  const values = [
    loteId, medicion.fuente, medicion.observedAt, medicion.consultedAt, medicion.coberturaValida ?? null,
    ...campos(medicion.ndvi), ...campos(medicion.ndmi), ...campos(medicion.ndwi), ...campos(medicion.evi), ...campos(medicion.rvi),
    medicion.puntaje ?? null, medicion.categoria ?? null, jsonb(medicion.alertas), jsonb(medicion.rawMetadata),
  ];
  const result = await queryable.query(
    `INSERT INTO mediciones_satelitales (lote_id, fuente, observed_at, consulted_at, cobertura_valida,
      ndvi_media, ndvi_mediana, ndvi_min, ndvi_max, ndvi_desvio, ndmi_media, ndmi_mediana, ndmi_min, ndmi_max, ndmi_desvio,
      ndwi_media, ndwi_mediana, ndwi_min, ndwi_max, ndwi_desvio, evi_media, evi_mediana, evi_min, evi_max, evi_desvio,
      rvi_media, rvi_mediana, rvi_min, rvi_max, rvi_desvio, puntaje, categoria, alertas, raw_metadata)
     VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
     ON CONFLICT (lote_id, fuente, observed_at) DO UPDATE SET
      consulted_at = EXCLUDED.consulted_at, cobertura_valida = EXCLUDED.cobertura_valida,
      ndvi_media = EXCLUDED.ndvi_media, ndvi_mediana = EXCLUDED.ndvi_mediana, ndvi_min = EXCLUDED.ndvi_min, ndvi_max = EXCLUDED.ndvi_max, ndvi_desvio = EXCLUDED.ndvi_desvio,
      ndmi_media = EXCLUDED.ndmi_media, ndmi_mediana = EXCLUDED.ndmi_mediana, ndmi_min = EXCLUDED.ndmi_min, ndmi_max = EXCLUDED.ndmi_max, ndmi_desvio = EXCLUDED.ndmi_desvio,
      ndwi_media = EXCLUDED.ndwi_media, ndwi_mediana = EXCLUDED.ndwi_mediana, ndwi_min = EXCLUDED.ndwi_min, ndwi_max = EXCLUDED.ndwi_max, ndwi_desvio = EXCLUDED.ndwi_desvio,
      evi_media = EXCLUDED.evi_media, evi_mediana = EXCLUDED.evi_mediana, evi_min = EXCLUDED.evi_min, evi_max = EXCLUDED.evi_max, evi_desvio = EXCLUDED.evi_desvio,
      rvi_media = EXCLUDED.rvi_media, rvi_mediana = EXCLUDED.rvi_mediana, rvi_min = EXCLUDED.rvi_min, rvi_max = EXCLUDED.rvi_max, rvi_desvio = EXCLUDED.rvi_desvio,
      puntaje = EXCLUDED.puntaje, categoria = EXCLUDED.categoria, alertas = EXCLUDED.alertas, raw_metadata = EXCLUDED.raw_metadata
     RETURNING *`,
    values,
  );
  return result.rows[0] as Record<string, unknown>;
}

export function medicionesDesdeResultado(resultado: Extract<ResultadoLote, { estado: 'ok' } | { estado: 'radar' }>, consultedAt: Date): MedicionSatelitalPersistible[] {
  if (resultado.estado === 'ok') {
    const condicion = resultado.condicion;
    return [{ fuente: 'sentinel-2', observedAt: condicion.fecha, consultedAt, coberturaValida: condicion.coberturaValida, ndvi: condicion.ndvi, ndmi: condicion.ndmi, ndwi: condicion.ndwi, evi: condicion.evi, puntaje: condicion.puntaje, categoria: condicion.categoria, alertas: condicion.alertas }];
  }
  const mediciones: MedicionSatelitalPersistible[] = [{ fuente: 'sentinel-1', observedAt: resultado.condicion.fecha, consultedAt, rvi: resultado.condicion.rvi }];
  if (resultado.optico) {
    const optico = resultado.optico;
    mediciones.push({ fuente: 'sentinel-2', observedAt: optico.fecha, consultedAt, coberturaValida: optico.coberturaValida, ndvi: optico.ndvi, ndmi: optico.ndmi, ndwi: optico.ndwi, evi: optico.evi, puntaje: optico.puntaje, categoria: optico.categoria, alertas: optico.alertas });
  }
  return mediciones;
}

export async function persistirResultadoSatelital(resultado: ResultadoLote, consultedAt: Date): Promise<void> {
  if (resultado.estado !== 'ok' && resultado.estado !== 'radar') return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const medicion of medicionesDesdeResultado(resultado, consultedAt)) await guardarMedicionSatelital(client, resultado.loteId, medicion);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
