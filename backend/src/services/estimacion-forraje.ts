import { climaHistoricoDisponible } from '../base-datos/clima-historico-disponible.js';
import { columnasPasturaDisponibles } from '../base-datos/columnas-pastura.js';
import { pool } from '../base-datos/pool.js';
import type { RegistroClimaDia } from '../estimacion/clima.js';
import { MAXIMO_DIAS_SIN_IMAGEN, estimarForraje, type EstimacionForraje } from '../estimacion/motor.js';
import { esTipoPastura, type TipoPastura } from '../estimacion/parametros.js';
import { sumarDias } from '../fechas.js';
import { fechaSalidaParaEstimacion } from './usos-lote.js';

/** El alta del lote en el calendario de Buenos Aires, igual que las fechas de uso. */
const FECHA_ALTA = "(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha_alta";

/**
 * Desde cuándo hace falta clima: el contexto de la ventana o el inicio del
 * conteo de grados-día, si es anterior. El conteo arranca después del último
 * pastoreo o, sin pastoreos registrados, en el alta del lote.
 */
function climaDesde(contexto: string, ultimoUso: string | undefined, fechaAlta: string | null): string {
  const inicioConteo = ultimoUso ?? fechaAlta;
  return inicioConteo && inicioConteo < contexto ? inicioConteo : contexto;
}

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

  const lote = await pool.query<{ tipo_pastura: string | null; fecha_alta: string | null }>(`SELECT tipo_pastura, ${FECHA_ALTA} FROM lotes WHERE id = $1`, [loteId]);
  const tipoPastura = esTipoPastura(lote.rows[0]?.tipo_pastura) ? lote.rows[0].tipo_pastura : null;
  if (!tipoPastura) return estimarForraje({ tipoPastura: null, desde, hoy, observaciones: [], clima: [], usos: [] });
  const fechaAlta = lote.rows[0]?.fecha_alta ?? null;

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
    pool.query<FilaUsoEstimacion>(
      `SELECT fecha, ingreso_at, salida_at FROM usos_lote
        WHERE lote_id = $1 AND (fecha >= $2::date OR fecha = (SELECT MAX(fecha) FROM usos_lote WHERE lote_id = $1))
        ORDER BY fecha`,
      [loteId, contexto],
    ),
  ]);

  const inicioClima = climaDesde(contexto, usos.rows.at(-1)?.fecha, fechaAlta);
  // De cada fecha alcanza con la fila más reciente por tipo (observado o pronóstico) y por qué variables trae:
  // clima.ts elige variable por variable y nunca necesita una fila más vieja que esas.
  const [clima, historico] = await Promise.all([
    pool.query<FilaClima>(
      `SELECT DISTINCT ON (d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL))
              c.consulted_at, d.fecha, d.es_pronostico, d.temp_min, d.temp_max, d.radiacion_mj_m2
         FROM dias_clima d JOIN consultas_clima c ON c.id = d.consulta_clima_id
        WHERE c.lote_id = $1 AND d.fecha >= $2::date
        ORDER BY d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL), c.consulted_at DESC, c.id`,
      [loteId, inicioClima],
    ),
    (await climaHistoricoDisponible())
      ? pool.query<FilaHistorico>(
        `SELECT fecha, temp_min, temp_max, radiacion_mj_m2, consulted_at FROM clima_historico_lote
          WHERE lote_id = $1 AND fecha >= $2::date ORDER BY fecha`,
        [loteId, inicioClima],
      )
      : { rows: [] as FilaHistorico[] },
  ]);

  return estimarForraje(entradaDesdeFilas(tipoPastura, desde, hoy, fechaAlta, observaciones.rows, usos.rows, clima.rows, historico.rows));
}

interface FilaObservacion { observed_at: string; ndvi_mediana: number | null; cobertura_valida: number | null }
interface FilaUsoEstimacion { fecha: string; ingreso_at?: Date | null; salida_at?: Date | null }
interface FilaClima { consulted_at: Date; fecha: string; es_pronostico: boolean; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }
interface FilaHistorico { consulted_at: Date; fecha: string; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }

function entradaDesdeFilas(
  tipoPastura: TipoPastura, desde: string, hoy: string, fechaAlta: string | null,
  observaciones: FilaObservacion[], usos: FilaUsoEstimacion[], clima: FilaClima[], historico: FilaHistorico[],
) {
  return {
    tipoPastura,
    desde,
    hoy,
    fechaAlta,
    observaciones: observaciones.map((fila) => ({ fecha: fila.observed_at, ndviMediana: fila.ndvi_mediana, coberturaValida: fila.cobertura_valida })),
    // Con jornadas, el pastoreo dura de la entrada a la salida; con animales adentro, hasta hoy.
    usos: usos.map((fila) => ({ fecha: fila.fecha, fechaSalida: fechaSalidaParaEstimacion(fila, hoy) })),
    clima: [
      ...clima.map((fila): RegistroClimaDia => ({
        fecha: fila.fecha,
        consultadoEn: new Date(fila.consulted_at).toISOString(),
        esPronostico: fila.es_pronostico,
        tempMin: fila.temp_min,
        tempMax: fila.temp_max,
        radiacionMjM2: fila.radiacion_mj_m2,
      })),
      ...historico.map((fila): RegistroClimaDia => ({
        fecha: fila.fecha,
        consultadoEn: new Date(fila.consulted_at).toISOString(),
        esPronostico: false,
        esHistorico: true,
        tempMin: fila.temp_min,
        tempMax: fila.temp_max,
        radiacionMjM2: fila.radiacion_mj_m2,
      })),
    ],
  };
}

function agruparPorLote<T extends { lote_id: string }>(filas: T[]): Map<string, T[]> {
  const porLote = new Map<string, T[]>();
  for (const fila of filas) porLote.set(fila.lote_id, [...(porLote.get(fila.lote_id) ?? []), fila]);
  return porLote;
}

export interface EstimacionDeLote {
  loteId: string;
  numero: number;
  estimacion: EstimacionForraje;
}

/**
 * La misma estimación que obtenerEstimacionForraje, para todos los lotes
 * activos y no eliminados del establecimiento, ordenados por número. Hace una
 * consulta por tabla, no una por lote, igual que GET /lotes/estado. Tampoco
 * llama a servicios externos ni escribe nada.
 */
export async function obtenerEstimacionesForraje(establecimientoId: string, desde: string, hoy: string): Promise<EstimacionDeLote[]> {
  const conPastura = await columnasPasturaDisponibles();
  const lotes = await pool.query<{ id: string; numero: number; tipo_pastura: string | null; fecha_alta: string | null }>(
    `SELECT id, numero, ${conPastura ? 'tipo_pastura' : 'NULL::text AS tipo_pastura'}, ${FECHA_ALTA} FROM lotes
      WHERE establecimiento_id = $1 AND deleted_at IS NULL AND activo = TRUE
      ORDER BY numero`,
    [establecimientoId],
  );
  const vacia = estimarForraje({ tipoPastura: null, desde, hoy, observaciones: [], clima: [], usos: [] });
  if (!conPastura) {
    const mensaje = 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.';
    return lotes.rows.map((lote) => ({ loteId: lote.id, numero: lote.numero, estimacion: { ...vacia, mensaje } }));
  }

  const conTipo = lotes.rows.filter((lote): lote is typeof lote & { tipo_pastura: TipoPastura } => esTipoPastura(lote.tipo_pastura));
  const ids = conTipo.map((lote) => lote.id);
  const contexto = sumarDias(desde, -MAXIMO_DIAS_SIN_IMAGEN);
  const [observaciones, usos] = ids.length === 0 ? [{ rows: [] }, { rows: [] }] : await Promise.all([
    pool.query<FilaObservacion & { lote_id: string }>(
      `SELECT lote_id, observed_at, ndvi_mediana, cobertura_valida FROM mediciones_satelitales
        WHERE lote_id = ANY($1::uuid[]) AND fuente = 'sentinel-2' AND observed_at >= $2::date AND observed_at <= $3::date
        ORDER BY lote_id, observed_at`,
      [ids, contexto, hoy],
    ),
    pool.query<FilaUsoEstimacion & { lote_id: string }>(
      `SELECT u.lote_id, u.fecha, u.ingreso_at, u.salida_at FROM usos_lote u
        WHERE u.lote_id = ANY($1::uuid[])
          AND (u.fecha >= $2::date OR u.fecha = (SELECT MAX(m.fecha) FROM usos_lote m WHERE m.lote_id = u.lote_id))
        ORDER BY u.lote_id, u.fecha`,
      [ids, contexto],
    ),
  ]);
  const usosPorLote = agruparPorLote(usos.rows);

  // Cada lote trae clima desde su propio punto de partida: el contexto, su último pastoreo o su alta.
  const inicios = conTipo.map((lote) => climaDesde(contexto, usosPorLote.get(lote.id)?.at(-1)?.fecha, lote.fecha_alta));
  const [clima, historico] = ids.length === 0 ? [{ rows: [] }, { rows: [] }] : await Promise.all([
    pool.query<FilaClima & { lote_id: string }>(
      `SELECT DISTINCT ON (c.lote_id, d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL))
              c.lote_id, c.consulted_at, d.fecha, d.es_pronostico, d.temp_min, d.temp_max, d.radiacion_mj_m2
         FROM dias_clima d
         JOIN consultas_clima c ON c.id = d.consulta_clima_id
         JOIN unnest($1::uuid[], $2::date[]) AS v(lote_id, desde) ON v.lote_id = c.lote_id
        WHERE d.fecha >= v.desde
        ORDER BY c.lote_id, d.fecha, d.es_pronostico, d.radiacion_mj_m2 IS NULL, (d.temp_min IS NULL OR d.temp_max IS NULL), c.consulted_at DESC, c.id`,
      [ids, inicios],
    ),
    (await climaHistoricoDisponible())
      ? pool.query<FilaHistorico & { lote_id: string }>(
        `SELECT h.lote_id, h.fecha, h.temp_min, h.temp_max, h.radiacion_mj_m2, h.consulted_at
           FROM clima_historico_lote h
           JOIN unnest($1::uuid[], $2::date[]) AS v(lote_id, desde) ON v.lote_id = h.lote_id
          WHERE h.fecha >= v.desde
          ORDER BY h.lote_id, h.fecha`,
        [ids, inicios],
      )
      : { rows: [] as Array<FilaHistorico & { lote_id: string }> },
  ]);
  const observacionesPorLote = agruparPorLote(observaciones.rows);
  const climaPorLote = agruparPorLote(clima.rows);
  const historicoPorLote = agruparPorLote(historico.rows);

  return lotes.rows.map((lote) => {
    if (!esTipoPastura(lote.tipo_pastura)) return { loteId: lote.id, numero: lote.numero, estimacion: vacia };
    return {
      loteId: lote.id,
      numero: lote.numero,
      estimacion: estimarForraje(entradaDesdeFilas(
        lote.tipo_pastura, desde, hoy, lote.fecha_alta ?? null,
        observacionesPorLote.get(lote.id) ?? [], usosPorLote.get(lote.id) ?? [],
        climaPorLote.get(lote.id) ?? [], historicoPorLote.get(lote.id) ?? [],
      )),
    };
  });
}
