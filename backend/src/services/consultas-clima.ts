import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import type { ResultadoClimaLote } from './open-meteo.js';

export type OrigenConsultaClima = 'automatico' | 'manual';

export interface PersistenciaConsultaClima {
  consultaId: string;
  guardado: boolean;
  omitido?: 'reciente';
}

async function insertarDias(
  client: PoolClient,
  consultaId: string,
  dias: Extract<ResultadoClimaLote, { estado: 'ok' }>['clima']['dias'],
): Promise<void> {
  if (dias.length === 0) return;
  await client.query(
    `INSERT INTO dias_clima
       (consulta_clima_id, fecha, lluvia_mm, temp_min, temp_max, es_pronostico)
     SELECT $1, datos.fecha, datos.lluvia_mm, datos.temp_min, datos.temp_max, datos.es_pronostico
     FROM UNNEST(
       $2::date[], $3::double precision[], $4::double precision[],
       $5::double precision[], $6::boolean[]
     ) AS datos(fecha, lluvia_mm, temp_min, temp_max, es_pronostico)`,
    [
      consultaId,
      dias.map((dia) => dia.fecha),
      dias.map((dia) => dia.lluviaMm),
      dias.map((dia) => dia.tempMin),
      dias.map((dia) => dia.tempMax),
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

    if (origen === 'automatico') {
      const reciente = await client.query<{ id: string }>(
        `SELECT id
         FROM consultas_clima
         WHERE lote_id = $1
           AND origen = 'automatico'
           AND created_at >= NOW() - INTERVAL '1 hour'
         ORDER BY created_at DESC
         LIMIT 1`,
        [resultado.loteId],
      );
      if (reciente.rows[0]) {
        await client.query('COMMIT');
        return { consultaId: reciente.rows[0].id, guardado: false, omitido: 'reciente' };
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
