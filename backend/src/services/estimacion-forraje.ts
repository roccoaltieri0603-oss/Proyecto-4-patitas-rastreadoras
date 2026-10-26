import { climaHistoricoDisponible } from '../base-datos/clima-historico-disponible.js';
import { columnasPasturaDisponibles } from '../base-datos/columnas-pastura.js';
import { medicionesAlturaDisponibles } from '../base-datos/mediciones-altura-disponibles.js';
import { pool } from '../base-datos/pool.js';
import type { RegistroClimaDia } from '../estimacion/clima.js';
import { estimarForraje, type EstimacionForraje } from '../estimacion/motor.js';
import { esTipoPastura, type TipoPastura } from '../estimacion/parametros.js';
import { medicionParaEstimacion } from './mediciones-altura.js';
import { fechaSalidaParaEstimacion } from './usos-lote.js';

/** El alta del lote en el calendario de Buenos Aires, igual que las fechas de uso. */
const FECHA_ALTA = "(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha_alta";

/**
 * Desde cuándo hace falta clima: `desde` o el inicio del ciclo de descanso que
 * lo contiene, si es anterior. Ese ciclo arranca después del último pastoreo
 * anterior a `desde` o, si no hubo ninguno, en el alta del lote. El ciclo del
 * último pastoreo empieza después, así que también queda cubierto.
 */
function climaDesde(desde: string, usos: Array<{ fecha: string }>, fechaAlta: string | null): string {
  const inicioCiclo = usos.filter((uso) => uso.fecha < desde).at(-1)?.fecha ?? fechaAlta;
  return inicioCiclo && inicioCiclo < desde ? inicioCiclo : desde;
}

/**
 * Los usos de la ventana, más el último de todos y el último antes de `desde`,
 * aunque sean más viejos: de ellos cuentan el reingreso y el ciclo de los
 * primeros días.
 */
const FILTRO_USOS = `(fecha >= $2::date
  OR fecha = (SELECT MAX(m.fecha) FROM usos_lote m WHERE m.lote_id = u.lote_id)
  OR fecha = (SELECT MAX(m.fecha) FROM usos_lote m WHERE m.lote_id = u.lote_id AND m.fecha < $3::date))`;

/**
 * Arma la estimación de forraje de un lote con lo que ya está persistido. No
 * llama a Copernicus ni a Open-Meteo y no escribe nada: el resultado es
 * derivado y vive sólo en la respuesta.
 */
export async function obtenerEstimacionForraje(loteId: string, desde: string, hoy: string): Promise<EstimacionForraje> {
  const conPastura = await columnasPasturaDisponibles();
  if (!conPastura) {
    return {
      ...estimarForraje({ tipoPastura: null, desde, hoy, clima: [], usos: [] }),
      mensaje: 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.',
    };
  }

  const lote = await pool.query<{ tipo_pastura: string | null; fecha_alta: string | null }>(`SELECT tipo_pastura, ${FECHA_ALTA} FROM lotes WHERE id = $1`, [loteId]);
  const tipoPastura = esTipoPastura(lote.rows[0]?.tipo_pastura) ? lote.rows[0].tipo_pastura : null;
  if (!tipoPastura) return estimarForraje({ tipoPastura: null, desde, hoy, clima: [], usos: [] });
  const fechaAlta = lote.rows[0]?.fecha_alta ?? null;

  const usos = await pool.query<FilaUsoEstimacion>(
    `SELECT fecha, ingreso_at, salida_at FROM usos_lote u
      WHERE lote_id = $1 AND ${FILTRO_USOS}
      ORDER BY fecha`,
    [loteId, desde, desde],
  );

  const inicioClima = climaDesde(desde, usos.rows, fechaAlta);
  // De cada fecha alcanza con la fila más reciente por tipo (observado o pronóstico) y por qué variables trae:
  // clima.ts elige variable por variable y nunca necesita una fila más vieja que esas.
  const [clima, historico, mediciones] = await Promise.all([
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
    (await medicionesAlturaDisponibles())
      ? pool.query<FilaMedicionEstimacion>(
        `SELECT id, fecha, momento, instrumento, altura_promedio_cm, cantidad_lecturas FROM mediciones_altura
          WHERE lote_id = $1 AND fecha >= $2::date AND fecha <= $3::date ORDER BY fecha`,
        [loteId, desde, hoy],
      )
      : { rows: [] as FilaMedicionEstimacion[] },
  ]);

  return estimarForraje(entradaDesdeFilas(tipoPastura, desde, hoy, fechaAlta, usos.rows, clima.rows, historico.rows, mediciones.rows));
}

interface FilaUsoEstimacion { fecha: string; ingreso_at?: Date | null; salida_at?: Date | null }
interface FilaClima { consulted_at: Date; fecha: string; es_pronostico: boolean; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }
interface FilaHistorico { consulted_at: Date; fecha: string; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }
type FilaMedicionEstimacion = Parameters<typeof medicionParaEstimacion>[0];

function entradaDesdeFilas(
  tipoPastura: TipoPastura, desde: string, hoy: string, fechaAlta: string | null,
  usos: FilaUsoEstimacion[], clima: FilaClima[], historico: FilaHistorico[],
  mediciones: FilaMedicionEstimacion[] = [],
) {
  return {
    tipoPastura,
    desde,
    hoy,
    fechaAlta,
    mediciones: mediciones.map(medicionParaEstimacion),
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
  const vacia = estimarForraje({ tipoPastura: null, desde, hoy, clima: [], usos: [] });
  if (!conPastura) {
    const mensaje = 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.';
    return lotes.rows.map((lote) => ({ loteId: lote.id, numero: lote.numero, estimacion: { ...vacia, mensaje } }));
  }

  const conTipo = lotes.rows.filter((lote): lote is typeof lote & { tipo_pastura: TipoPastura } => esTipoPastura(lote.tipo_pastura));
  const ids = conTipo.map((lote) => lote.id);
  const usos = ids.length === 0 ? { rows: [] } : await pool.query<FilaUsoEstimacion & { lote_id: string }>(
    `SELECT u.lote_id, u.fecha, u.ingreso_at, u.salida_at FROM usos_lote u
      WHERE u.lote_id = ANY($1::uuid[]) AND ${FILTRO_USOS}
      ORDER BY u.lote_id, u.fecha`,
    [ids, desde, desde],
  );
  const usosPorLote = agruparPorLote(usos.rows);

  // Cada lote trae clima desde su propio punto de partida: `desde` o el inicio del ciclo que lo contiene.
  const inicios = conTipo.map((lote) => climaDesde(desde, usosPorLote.get(lote.id) ?? [], lote.fecha_alta));
  const [clima, historico, mediciones] = ids.length === 0 ? [{ rows: [] }, { rows: [] }, { rows: [] }] : await Promise.all([
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
    (await medicionesAlturaDisponibles())
      ? pool.query<FilaMedicionEstimacion & { lote_id: string }>(
        `SELECT lote_id, id, fecha, momento, instrumento, altura_promedio_cm, cantidad_lecturas FROM mediciones_altura
          WHERE lote_id = ANY($1::uuid[]) AND fecha >= $2::date AND fecha <= $3::date ORDER BY lote_id, fecha`,
        [ids, desde, hoy],
      )
      : { rows: [] as Array<FilaMedicionEstimacion & { lote_id: string }> },
  ]);
  const climaPorLote = agruparPorLote(clima.rows);
  const historicoPorLote = agruparPorLote(historico.rows);
  const medicionesPorLote = agruparPorLote(mediciones.rows);

  return lotes.rows.map((lote) => {
    if (!esTipoPastura(lote.tipo_pastura)) return { loteId: lote.id, numero: lote.numero, estimacion: vacia };
    return {
      loteId: lote.id,
      numero: lote.numero,
      estimacion: estimarForraje(entradaDesdeFilas(
        lote.tipo_pastura, desde, hoy, lote.fecha_alta ?? null, usosPorLote.get(lote.id) ?? [],
        climaPorLote.get(lote.id) ?? [], historicoPorLote.get(lote.id) ?? [], medicionesPorLote.get(lote.id) ?? [],
      )),
    };
  });
}
