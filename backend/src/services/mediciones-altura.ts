import type { PoolClient } from 'pg';
import { esFechaCalendario } from '../fechas.js';
import { ApiError } from '../http/errors.js';
import { INSTRUMENTOS, type Instrumento } from '../estimacion/parametros.js';
import type { MedicionAltura, MomentoMedicion } from '../estimacion/biomasa.js';

/**
 * Mediciones de altura del pasto que carga el usuario (migración 018). Son
 * observaciones reales y se guardan tal cual, en cm. Los kilos se calculan al
 * leer, con la conversión de la pastura, y no se persisten.
 */

export const MOMENTOS: readonly MomentoMedicion[] = ['salida', 'antes-de-entrar', 'recorrida'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALTURA_MAXIMA_CM = 150;
const LECTURAS_MAXIMAS = 1000;

export const COLUMNAS_MEDICION = 'id, lote_id, fecha, momento, instrumento, altura_promedio_cm, cantidad_lecturas, desvio_cm, uso_id, created_at, updated_at';

export interface FilaMedicion {
  id: string;
  lote_id: string;
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  altura_promedio_cm: number;
  cantidad_lecturas: number;
  desvio_cm: number | null;
  uso_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function medicionDto(fila: FilaMedicion) {
  return {
    id: fila.id,
    loteId: fila.lote_id,
    fecha: fila.fecha,
    momento: fila.momento,
    instrumento: fila.instrumento,
    alturaPromedioCm: fila.altura_promedio_cm,
    cantidadLecturas: fila.cantidad_lecturas,
    desvioCm: fila.desvio_cm,
    usoId: fila.uso_id,
    createdAt: new Date(fila.created_at).toISOString(),
    updatedAt: new Date(fila.updated_at).toISOString(),
  };
}

export function medicionParaEstimacion(fila: Pick<FilaMedicion, 'id' | 'fecha' | 'momento' | 'instrumento' | 'altura_promedio_cm' | 'cantidad_lecturas'>): MedicionAltura {
  return { id: fila.id, fecha: fila.fecha, momento: fila.momento, instrumento: fila.instrumento, alturaPromedioCm: fila.altura_promedio_cm, cantidadLecturas: fila.cantidad_lecturas };
}

export interface DatosMedicion {
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  alturaPromedioCm: number;
  cantidadLecturas: number;
  desvioCm: number | null;
  usoId: string | null;
}

function numeroEnRango(valor: unknown, codigo: string, mensaje: string, minimoExclusivo: number, maximo: number): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= minimoExclusivo || valor > maximo) throw new ApiError(400, codigo, mensaje);
  return valor;
}

/**
 * Valida un alta o, con `anterior`, una modificación: los campos que no vienen
 * quedan como estaban. La lectura del plato Filip's cuenta medios centímetros;
 * con `lecturaEnMediosCm` se divide por 2 antes de guardar, como en la fuente.
 */
export function leerDatosMedicion(cuerpo: unknown, hoy: string, anterior?: DatosMedicion): DatosMedicion {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser un objeto.');
  const datos = cuerpo as Record<string, unknown>;
  const valor = <T>(campo: string, previo: T | undefined): unknown => (campo in datos ? datos[campo] : previo);

  const fecha = valor('fecha', anterior?.fecha);
  if (!esFechaCalendario(fecha)) throw new ApiError(400, 'INVALID_DATE', 'fecha debe tener formato YYYY-MM-DD y ser válida.');
  if (fecha > hoy) throw new ApiError(400, 'FUTURE_MEASUREMENT_DATE', 'La medición no puede tener fecha futura.');

  const momento = valor('momento', anterior?.momento);
  if (!MOMENTOS.includes(momento as MomentoMedicion)) throw new ApiError(400, 'INVALID_MEASUREMENT_MOMENT', 'momento debe ser salida, antes-de-entrar o recorrida.');
  const instrumento = valor('instrumento', anterior?.instrumento);
  if (!INSTRUMENTOS.includes(instrumento as Instrumento)) throw new ApiError(400, 'INVALID_INSTRUMENT', 'instrumento debe ser plato o regla.');

  const enMedios = datos.lecturaEnMediosCm === true;
  if (enMedios && instrumento !== 'plato') throw new ApiError(400, 'INVALID_INSTRUMENT', 'Sólo el plato se lee en medios centímetros.');
  const divisor = enMedios ? 2 : 1;
  const crudaAltura = 'alturaPromedioCm' in datos ? datos.alturaPromedioCm : anterior?.alturaPromedioCm;
  const alturaPromedioCm = numeroEnRango(crudaAltura, 'INVALID_HEIGHT', `La altura promedio debe ser mayor que 0 y de hasta ${ALTURA_MAXIMA_CM} cm.`, 0, ALTURA_MAXIMA_CM * divisor) / ('alturaPromedioCm' in datos ? divisor : 1);

  const cantidadLecturas = valor('cantidadLecturas', anterior?.cantidadLecturas);
  if (typeof cantidadLecturas !== 'number' || !Number.isInteger(cantidadLecturas) || cantidadLecturas < 1 || cantidadLecturas > LECTURAS_MAXIMAS) {
    throw new ApiError(400, 'INVALID_READINGS_COUNT', `La cantidad de lecturas debe ser un entero entre 1 y ${LECTURAS_MAXIMAS}.`);
  }

  const crudoDesvio = 'desvioCm' in datos ? datos.desvioCm : anterior?.desvioCm ?? null;
  let desvioCm: number | null = null;
  if (crudoDesvio !== null && crudoDesvio !== undefined) {
    if (typeof crudoDesvio !== 'number' || !Number.isFinite(crudoDesvio) || crudoDesvio < 0 || crudoDesvio > ALTURA_MAXIMA_CM * divisor) {
      throw new ApiError(400, 'INVALID_DEVIATION', `El desvío debe estar entre 0 y ${ALTURA_MAXIMA_CM} cm.`);
    }
    desvioCm = crudoDesvio / ('desvioCm' in datos ? divisor : 1);
  }

  const usoId = valor('usoId', anterior?.usoId ?? null);
  if (usoId !== null && (typeof usoId !== 'string' || !UUID.test(usoId))) throw new ApiError(400, 'INVALID_USE_ID', 'usoId debe ser un UUID o null.');

  return {
    fecha, momento: momento as MomentoMedicion, instrumento: instrumento as Instrumento,
    alturaPromedioCm, cantidadLecturas, desvioCm, usoId: usoId as string | null,
  };
}

type Consultable = Pick<PoolClient, 'query'>;

/** Un uso de otro lote no se puede asociar: el aislamiento es el mismo que el de los usos. */
export async function verificarUsoDelLote(db: Consultable, usoId: string, loteId: string): Promise<void> {
  const uso = await db.query('SELECT 1 FROM usos_lote WHERE id = $1 AND lote_id = $2', [usoId, loteId]);
  if (!uso.rows[0]) throw new ApiError(404, 'USE_NOT_FOUND', 'Registro de uso inexistente para este lote.');
}

/**
 * La planilla de campo muestra el remanente desde la jornada. Una medición de
 * salida asociada a una jornada que ya salió se copia ahí, para que la planilla
 * y el Excel muestren lo mismo que la medición. Un uso viejo, sin salida con
 * hora, no admite remanente y queda como estaba.
 */
export async function copiarRemanenteAlUso(db: Consultable, datos: Pick<DatosMedicion, 'momento' | 'usoId' | 'alturaPromedioCm'>, loteId: string): Promise<void> {
  if (datos.momento !== 'salida' || !datos.usoId) return;
  await db.query(
    'UPDATE usos_lote SET altura_remanente_cm = $1 WHERE id = $2 AND lote_id = $3 AND salida_at IS NOT NULL',
    [datos.alturaPromedioCm, datos.usoId, loteId],
  );
}

/** Al borrar esa medición, el remanente de la jornada se borra sólo si era el que ella había copiado. */
export async function quitarRemanenteDelUso(db: Consultable, fila: Pick<FilaMedicion, 'momento' | 'uso_id' | 'altura_promedio_cm'>, loteId: string): Promise<void> {
  if (fila.momento !== 'salida' || !fila.uso_id) return;
  await db.query(
    'UPDATE usos_lote SET altura_remanente_cm = NULL WHERE id = $1 AND lote_id = $2 AND altura_remanente_cm = $3',
    [fila.uso_id, loteId, fila.altura_promedio_cm],
  );
}
