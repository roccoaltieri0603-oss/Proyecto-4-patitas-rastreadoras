import { hoyCalendario } from '../fechas.js';

/**
 * Usos de lote y jornadas de pastoreo (migración 017).
 *
 * Un uso viejo es sólo una fecha. Una jornada es un uso con la entrada y la
 * salida del ganado con hora, la cantidad de animales por categoría de la
 * planilla de campo y la altura del remanente al salir. Todo lo carga el
 * usuario a mano: no hay GPS ni dispositivos detrás.
 */

export const COLUMNAS_USO = 'id, lote_id, fecha, origen, created_at, ingreso_at, salida_at, animales_adultos, animales_toretes_vaconas, animales_terneros, altura_remanente_cm';

/** La salida en el calendario de Buenos Aires, como el resto de las fechas de uso. */
export const FECHA_SALIDA_SQL = "(salida_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date";

export interface FilaUso {
  id: string;
  lote_id: string;
  fecha: string;
  origen: string;
  created_at: Date | string;
  ingreso_at?: Date | string | null;
  salida_at?: Date | string | null;
  animales_adultos?: number | null;
  animales_toretes_vaconas?: number | null;
  animales_terneros?: number | null;
  altura_remanente_cm?: number | null;
}

export interface AnimalesDelUso {
  adultos: number | null;
  toretesVaconas: number | null;
  terneros: number | null;
  /** Suma de las categorías cargadas; `null` si no se cargó ninguna. */
  total: number | null;
}

function iso(valor: Date | string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  return new Date(valor).toISOString();
}

export function animalesDelUso(fila: FilaUso): AnimalesDelUso {
  const adultos = fila.animales_adultos ?? null;
  const toretesVaconas = fila.animales_toretes_vaconas ?? null;
  const terneros = fila.animales_terneros ?? null;
  const cargados = [adultos, toretesVaconas, terneros].filter((valor): valor is number => valor !== null);
  return { adultos, toretesVaconas, terneros, total: cargados.length === 0 ? null : cargados.reduce((a, b) => a + b, 0) };
}

/** Hay animales adentro: entraron con hora y todavía no salieron. */
export function jornadaAbierta(fila: FilaUso): boolean {
  return Boolean(fila.ingreso_at) && !fila.salida_at;
}

/**
 * Último día con animales en el lote. Con la jornada abierta es hoy; con
 * salida registrada, el día de la salida; en un uso viejo, su única fecha.
 */
export function finDelUso(fila: FilaUso, hoy: string): string {
  if (jornadaAbierta(fila)) return hoy;
  if (fila.salida_at) return hoyCalendario(new Date(fila.salida_at));
  return fila.fecha;
}

/** Fecha de salida para la estimación: `null` sólo en un uso viejo, sin hora. */
export function fechaSalidaParaEstimacion(fila: Pick<FilaUso, 'fecha' | 'ingreso_at' | 'salida_at'>, hoy: string): string | null {
  if (!fila.ingreso_at && !fila.salida_at) return null;
  return finDelUso(fila as FilaUso, hoy);
}

/** Días con animales, con un decimal, a partir de la entrada y la salida con hora. */
export function diasDeOcupacion(fila: FilaUso): number | null {
  if (!fila.ingreso_at || !fila.salida_at) return null;
  const horas = (new Date(fila.salida_at).getTime() - new Date(fila.ingreso_at).getTime()) / 3_600_000;
  return Math.round((horas / 24) * 10) / 10;
}

export function usoDto(fila: FilaUso) {
  return {
    id: fila.id,
    loteId: fila.lote_id,
    fecha: fila.fecha,
    origen: fila.origen,
    createdAt: fila.created_at,
    ingresoAt: iso(fila.ingreso_at),
    salidaAt: iso(fila.salida_at),
    enCurso: jornadaAbierta(fila),
    animales: animalesDelUso(fila),
    alturaRemanenteCm: fila.altura_remanente_cm ?? null,
    diasOcupacion: diasDeOcupacion(fila),
  };
}
