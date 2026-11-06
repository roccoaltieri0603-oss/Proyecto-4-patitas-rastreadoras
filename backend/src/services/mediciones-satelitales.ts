import type { PoolClient } from 'pg';
import { columnasInundacionDisponibles } from '../base-datos/columnas-inundacion.js';
import { pool } from '../base-datos/pool.js';
import type { EstadisticaIndice, ResultadoLote } from '../copernicus/types.js';

/**
 * `puntaje` y `categoria` ya no se escriben (04/11/2026): las filas nuevas los
 * dejan NULL y las viejas conservan lo que tenían, porque el upsert no los toca.
 */
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
  ndwi1Media?: number | null;
  fraccionInundada?: number | null;
  alertas?: string[] | null;
  rawMetadata?: unknown;
}

type Queryable = Pick<PoolClient, 'query'>;
type EstadisticaPersistible = Partial<Record<keyof EstadisticaIndice, number | null>>;

const INDICES = ['ndvi', 'ndmi', 'ndwi', 'evi', 'rvi'] as const;
const ESTADISTICAS = ['media', 'mediana', 'min', 'max', 'desvio'] as const;

function campos(stats?: EstadisticaPersistible): Array<number | null> {
  return ESTADISTICAS.map((estadistica) => stats?.[estadistica] ?? null);
}

function jsonb(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export async function guardarMedicionSatelital(queryable: Queryable, loteId: string, medicion: MedicionSatelitalPersistible): Promise<Record<string, unknown>> {
  const conInundacion = await columnasInundacionDisponibles();
  const columnasIndices = INDICES.flatMap((indice) => ESTADISTICAS.map((estadistica) => `${indice}_${estadistica}`));
  const columnas = [
    'lote_id', 'fuente', 'observed_at', 'consulted_at', 'cobertura_valida', ...columnasIndices,
    ...(conInundacion ? ['ndwi1_media', 'fraccion_inundada'] : []),
    'alertas', 'raw_metadata',
  ];
  const values = [
    loteId, medicion.fuente, medicion.observedAt, medicion.consultedAt, medicion.coberturaValida ?? null,
    ...INDICES.flatMap((indice) => campos(medicion[indice])),
    ...(conInundacion ? [medicion.ndwi1Media ?? null, medicion.fraccionInundada ?? null] : []),
    jsonb(medicion.alertas), jsonb(medicion.rawMetadata),
  ];
  const actualizables = columnas.filter((columna) => !['lote_id', 'fuente', 'observed_at'].includes(columna));
  const result = await queryable.query(
    `INSERT INTO mediciones_satelitales (${columnas.join(', ')})
     VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
     ON CONFLICT (lote_id, fuente, observed_at) DO UPDATE SET
      ${actualizables.map((columna) => `${columna} = EXCLUDED.${columna}`).join(', ')}
     RETURNING *`,
    values,
  );
  return result.rows[0] as Record<string, unknown>;
}

function medicionOptica(condicion: Extract<ResultadoLote, { estado: 'ok' }>['condicion'], consultedAt: Date): MedicionSatelitalPersistible {
  return {
    fuente: 'sentinel-2', observedAt: condicion.fecha, consultedAt, coberturaValida: condicion.coberturaValida,
    ndvi: condicion.ndvi, ndmi: condicion.ndmi, ndwi: condicion.ndwi, evi: condicion.evi,
    ndwi1Media: condicion.ndwi1Media, fraccionInundada: condicion.fraccionInundada, alertas: condicion.alertas,
  };
}

export function medicionesDesdeResultado(resultado: Extract<ResultadoLote, { estado: 'ok' } | { estado: 'radar' }>, consultedAt: Date): MedicionSatelitalPersistible[] {
  if (resultado.estado === 'ok') return [medicionOptica(resultado.condicion, consultedAt)];
  const mediciones: MedicionSatelitalPersistible[] = [{ fuente: 'sentinel-1', observedAt: resultado.condicion.fecha, consultedAt, rvi: resultado.condicion.rvi }];
  if (resultado.optico) mediciones.push(medicionOptica(resultado.optico, consultedAt));
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
