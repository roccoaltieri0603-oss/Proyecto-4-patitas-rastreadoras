import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import type { DiaClima, ResultadoClimaLote } from './open-meteo.js';

export const COLUMNAS_DIA_CLIMA = 'consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max, radiacion_mj_m2, evapotranspiracion_mm, es_pronostico';

export function diaClimaDesdeFila(fila: Record<string, any>): DiaClima {
  return {
    fecha: fila.fecha,
    lluviaMm: fila.lluvia_mm,
    tempMin: fila.temp_min,
    tempMax: fila.temp_max,
    radiacionMjM2: fila.radiacion_mj_m2,
    evapotranspiracionMm: fila.evapotranspiracion_mm,
    esPronostico: fila.es_pronostico,
  };
}

export type OrigenConsultaClima = 'automatico' | 'manual';

export interface PersistenciaConsultaClima {
  consultaId: string;
  guardado: boolean;
  omitido?: 'sin-cambios';
}

/** Lo que define si dos consultas dicen lo mismo. */
export interface ResumenComparableClima {
  lluviaUltimos7Dias: number | null;
  lluviaProximosDias: number | null;
  categoria: string | null;
  dias: DiaClima[];
}

/**
 * Dos consultas son iguales si coinciden el resumen **y** todos los días.
 *
 * La comparación incluye los días a propósito, no sólo el resumen. El modelo de
 * forraje acumula grados-día leyendo la temperatura de cada fila de
 * `dias_clima`: si se compararan únicamente la lluvia y la categoría, dos
 * consultas con la misma lluvia pero distinta temperatura se darían por iguales
 * y se perdería el dato que el modelo necesita.
 *
 * Igual elimina el duplicado real: dentro de la misma mañana Open-Meteo devuelve
 * lo mismo. Cuando pasa un día y la ventana del pronóstico se corre, los días
 * cambian y se guarda, que es lo correcto porque es información nueva.
 */
export function climaEsIgual(anterior: ResumenComparableClima, nuevo: ResumenComparableClima): boolean {
  if (anterior.lluviaUltimos7Dias !== nuevo.lluviaUltimos7Dias) return false;
  if (anterior.lluviaProximosDias !== nuevo.lluviaProximosDias) return false;
  if (anterior.categoria !== nuevo.categoria) return false;
  if (anterior.dias.length !== nuevo.dias.length) return false;
  // Ambos lados llegan ordenados por fecha: la consulta los pide con ORDER BY y
  // Open-Meteo los devuelve en orden de calendario.
  return anterior.dias.every((dia, i) => {
    const otro = nuevo.dias[i];
    return dia.fecha === otro.fecha
      && dia.lluviaMm === otro.lluviaMm
      && dia.tempMin === otro.tempMin
      && dia.tempMax === otro.tempMax
      && dia.radiacionMjM2 === otro.radiacionMjM2
      && dia.evapotranspiracionMm === otro.evapotranspiracionMm
      && dia.esPronostico === otro.esPronostico;
  });
}

async function insertarDias(
  client: PoolClient,
  consultaId: string,
  dias: Extract<ResultadoClimaLote, { estado: 'ok' }>['clima']['dias'],
): Promise<void> {
  if (dias.length === 0) return;
  await client.query(
    `INSERT INTO dias_clima
       (consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max,
        radiacion_mj_m2, evapotranspiracion_mm, es_pronostico)
     SELECT $1, datos.fecha, datos.lluvia_mm, datos.temp_min, datos.temp_max,
       datos.radiacion_mj_m2, datos.evapotranspiracion_mm, datos.es_pronostico
     FROM UNNEST(
       $2::date[], $3::double precision[], $4::double precision[],
       $5::double precision[], $6::double precision[], $7::double precision[], $8::boolean[]
     ) AS datos(fecha, lluvia_mm, temp_min, temp_max, radiacion_mj_m2, evapotranspiracion_mm, es_pronostico)`,
    [
      consultaId,
      dias.map((dia) => dia.fecha),
      dias.map((dia) => dia.lluviaMm),
      dias.map((dia) => dia.tempMin),
      dias.map((dia) => dia.tempMax),
      dias.map((dia) => dia.radiacionMjM2),
      dias.map((dia) => dia.evapotranspiracionMm),
      dias.map((dia) => dia.esPronostico),
    ],
  );
}

export async function persistirConsultaClima(
  resultado: Extract<ResultadoClimaLote, { estado: 'ok' }>,
  origen: OrigenConsultaClima,
  referencia: Date,
): Promise<PersistenciaConsultaClima> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Este lock serializa las actualizaciones automáticas concurrentes del mismo lote.
    const lote = await client.query<{ id: string }>(
      'SELECT id FROM lotes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [resultado.loteId],
    );
    if (!lote.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');

    // Si Open-Meteo devuelve exactamente lo mismo que la última vez, no se
    // agrega una medición repetida: se deja asentado que se volvió a chequear
    // moviendo `consulted_at`, que es lo que permite mostrar "recién consultado"
    // sin inventar una observación. Los valores medidos no se tocan.
    const ultima = await client.query<{ id: string; lluvia_ultimos_7_dias: number | null; lluvia_proximos_dias: number | null; categoria: string | null }>(
      `SELECT id, lluvia_ultimos_7_dias, lluvia_proximos_dias, categoria
       FROM consultas_clima
       WHERE lote_id = $1
       ORDER BY consulted_at DESC, id ASC
       LIMIT 1`,
      [resultado.loteId],
    );
    const anterior = ultima.rows[0];
    if (anterior) {
      const dias = await client.query(
        'SELECT fecha, lluvia_mm, temp_min, temp_max, radiacion_mj_m2, evapotranspiracion_mm, es_pronostico FROM dias_clima WHERE consulta_clima_id = $1 ORDER BY fecha',
        [anterior.id],
      );
      const igual = climaEsIgual(
        {
          lluviaUltimos7Dias: anterior.lluvia_ultimos_7_dias,
          lluviaProximosDias: anterior.lluvia_proximos_dias,
          categoria: anterior.categoria,
          dias: dias.rows.map(diaClimaDesdeFila),
        },
        {
          lluviaUltimos7Dias: resultado.clima.lluviaUltimos7Dias,
          lluviaProximosDias: resultado.clima.lluviaProximosDias,
          categoria: resultado.categoria,
          dias: resultado.clima.dias,
        },
      );
      if (igual) {
        await client.query('UPDATE consultas_clima SET consulted_at = $1 WHERE id = $2', [referencia, anterior.id]);
        await client.query('COMMIT');
        return { consultaId: anterior.id, guardado: false, omitido: 'sin-cambios' };
      }
    }

    const consulta = await client.query<{ id: string }>(
      `INSERT INTO consultas_clima
         (lote_id, consulted_at, lluvia_ultimos_7_dias, lluvia_proximos_dias,
          categoria, raw_metadata, origen)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        resultado.loteId,
        referencia,
        resultado.clima.lluviaUltimos7Dias,
        resultado.clima.lluviaProximosDias,
        resultado.categoria,
        JSON.stringify({ proveedor: 'open-meteo' }),
        origen,
      ],
    );
    await insertarDias(client, consulta.rows[0].id, resultado.clima.dias);
    await client.query('COMMIT');
    return { consultaId: consulta.rows[0].id, guardado: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
