import { columnasPasturaDisponibles } from '../base-datos/columnas-pastura.js';
import { pool } from '../base-datos/pool.js';
import type { RegistroClimaDia } from '../estimacion/clima.js';
import { MAXIMO_DIAS_SIN_IMAGEN, estimarForraje, type EstimacionForraje } from '../estimacion/motor.js';
import { esTipoPastura } from '../estimacion/parametros.js';
import { sumarDias } from '../fechas.js';

/**
 * Arma la estimación de forraje de un lote con lo que ya está persistido. No
 * llama a Copernicus ni a Open-Meteo y no escribe nada: el resultado es
 * derivado y vive sólo en la respuesta.
 */
export async function obtenerEstimacionForraje(loteId: string, desde: string, hoy: string): Promise<EstimacionForraje> {
  const conPastura = await columnasPasturaDisponibles();
  if (!conPastura) {
    return {
      ...estimarForraje({ tipoPastura: null, desde, hoy, observaciones: [], clima: [], usos: [] }),
      mensaje: 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.',
    };
  }

  const lote = await pool.query<{ tipo_pastura: string | null }>('SELECT tipo_pastura FROM lotes WHERE id = $1', [loteId]);
  const tipoPastura = esTipoPastura(lote.rows[0]?.tipo_pastura) ? lote.rows[0].tipo_pastura : null;
  if (!tipoPastura) return estimarForraje({ tipoPastura: null, desde, hoy, observaciones: [], clima: [], usos: [] });

  // La imagen y los pastoreos de hasta MAXIMO_DIAS_SIN_IMAGEN días antes de `desde` deciden el NDVI de los primeros días.
  const contexto = sumarDias(desde, -MAXIMO_DIAS_SIN_IMAGEN);
  const [observaciones, usos] = await Promise.all([
    pool.query<{ observed_at: string; ndvi_mediana: number | null; cobertura_valida: number | null }>(
      `SELECT observed_at, ndvi_mediana, cobertura_valida FROM mediciones_satelitales
        WHERE lote_id = $1 AND fuente = 'sentinel-2' AND observed_at >= $2::date AND observed_at <= $3::date
        ORDER BY observed_at`,
      [loteId, contexto, hoy],
    ),
    // El último pastoreo se trae aunque sea viejo: de él cuenta el reingreso.
    pool.query<{ fecha: string }>(
      `SELECT fecha FROM usos_lote
        WHERE lote_id = $1 AND (fecha >= $2::date OR fecha = (SELECT MAX(fecha) FROM usos_lote WHERE lote_id = $1))
        ORDER BY fecha`,
      [loteId, contexto],
    ),
  ]);

  const ultimoUso = usos.rows.at(-1)?.fecha;
  const climaDesde = ultimoUso && ultimoUso < contexto ? ultimoUso : contexto;
  // De cada fecha alcanza con la fila más reciente por tipo (observado o pronóstico) y por qué variables trae:
  // clima.ts elige variable por variable y nunca necesita una fila más vieja que esas.
  const clima = await pool.query<{ consulted_at: Date; fecha: string; es_pronostico: boolean; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }>(
    `SELECT DISTINCT ON (d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL))
            c.consulted_at, d.fecha, d.es_pronostico, d.temp_min, d.temp_max, d.radiacion_mj_m2
       FROM dias_clima d JOIN consultas_clima c ON c.id = d.consulta_clima_id
      WHERE c.lote_id = $1 AND d.fecha >= $2::date
      ORDER BY d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL), c.consulted_at DESC, c.id`,
    [loteId, climaDesde],
  );

  return estimarForraje({
    tipoPastura,
    desde,
    hoy,
    observaciones: observaciones.rows.map((fila) => ({ fecha: fila.observed_at, ndviMediana: fila.ndvi_mediana, coberturaValida: fila.cobertura_valida })),
    usos: usos.rows.map((fila) => ({ fecha: fila.fecha, fechaSalida: null })),
    clima: clima.rows.map((fila): RegistroClimaDia => ({
      fecha: fila.fecha,
      consultadoEn: new Date(fila.consulted_at).toISOString(),
      esPronostico: fila.es_pronostico,
      tempMin: fila.temp_min,
      tempMax: fila.temp_max,
      radiacionMjM2: fila.radiacion_mj_m2,
    })),
  });
}
