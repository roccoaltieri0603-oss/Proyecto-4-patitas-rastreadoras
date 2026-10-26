import { sumarDias } from '../fechas.js';
import type { ClimaDelDia, OrigenClima } from './clima.js';
import type { CriterioReingreso } from './parametros.js';

/**
 * Grados-día acumulados y estado foliar de un ciclo de descanso: desde el día
 * siguiente a la salida de los animales (o desde el alta del lote) hasta el
 * próximo pastoreo. Lo usan la fecha de reingreso, la etapa de cada día y el
 * rebrote modelado, para que los tres cuenten igual.
 */

/**
 * Condición estimada para pastorear según el estado foliar, de peor a mejor:
 * - `no-apto`: le falta más de una hoja (un filocrono) para la vida media foliar mínima;
 * - `cuidado`: le falta menos de una hoja;
 * - `perfecto`: entre la fecha temprana y la tardía;
 * - `regular`: pasó la tardía y las hojas más viejas empiezan a morir.
 */
export type CondicionPastoreo = 'no-apto' | 'cuidado' | 'perfecto' | 'regular';

export interface DiaGradosDia {
  fecha: string;
  /** Uno por temperatura base, en el orden pedido. */
  acumulado: number[];
  climaUsado: OrigenClima;
}

export interface SerieGradosDia {
  dias: DiaGradosDia[];
  /** El primer día sin temperatura, si la serie se cortó antes de `hasta`. */
  corte: string | null;
}

/** Grados-día de cada día = max(0, media − base). La serie se corta en el primer día sin temperatura: no se saltea. */
export function serieGradosDia(inicio: string, hasta: string, climaPorDia: Map<string, ClimaDelDia>, bases: number[]): SerieGradosDia {
  const dias: DiaGradosDia[] = [];
  const acumulado = bases.map(() => 0);
  for (let dia = inicio; dia <= hasta; dia = sumarDias(dia, 1)) {
    const temperatura = climaPorDia.get(dia)?.temperaturaMedia ?? null;
    if (!temperatura) return { dias, corte: dia };
    bases.forEach((base, indice) => { acumulado[indice] += Math.max(0, temperatura.valor - base); });
    dias.push({ fecha: dia, acumulado: [...acumulado], climaUsado: temperatura.origen });
  }
  return { dias, corte: null };
}

/**
 * Una hoja menos que el estado foliar óptimo es "cuidado". La hoja se mide con
 * el filocrono más largo de la fuente, para no adelantar el aviso.
 */
export function condicionDelDia(rapido: number, tardiaAlcanzada: string | null, dia: string, criterio: CriterioReingreso): CondicionPastoreo {
  const [vidaMinima] = criterio.vidaMediaFoliarGradosDia;
  if (tardiaAlcanzada !== null && dia > tardiaAlcanzada) return 'regular';
  if (rapido >= vidaMinima) return 'perfecto';
  if (rapido >= vidaMinima - criterio.filocronoGradosDia[1]) return 'cuidado';
  return 'no-apto';
}

export interface DiaCiclo {
  fecha: string;
  condicion: CondicionPastoreo;
  /** Grados-día con la base baja. */
  rapido: number;
  /** Grados-día con la base alta. */
  lento: number;
  climaUsado: OrigenClima;
}

export interface CicloEstadoFoliar {
  dias: DiaCiclo[];
  temprana: string | null;
  tardia: string | null;
  /** Hasta dónde se contó para las fechas: se congela en la tardía. */
  contadoHasta: string | null;
  resumen: { conBaseMaxima: number; conBaseMinima: number } | null;
  usaPronostico: boolean;
  /** Primer día sin temperatura antes de llegar a la tardía. */
  corte: string | null;
}

function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/**
 * La fecha temprana suma rápido (base baja) hasta la vida media foliar mínima;
 * la tardía, lento (base alta) hasta la máxima. Las condiciones siguen después
 * de la tardía; el resumen se congela en ella.
 */
export function cicloEstadoFoliar(criterio: CriterioReingreso, inicio: string, hasta: string, climaPorDia: Map<string, ClimaDelDia>): CicloEstadoFoliar {
  const [baseMinima, baseMaxima] = criterio.temperaturaBaseC;
  const [vidaMinima, vidaMaxima] = criterio.vidaMediaFoliarGradosDia;
  const serie = serieGradosDia(inicio, hasta, climaPorDia, [baseMinima, baseMaxima]);
  const ciclo: CicloEstadoFoliar = { dias: [], temprana: null, tardia: null, contadoHasta: null, resumen: null, usaPronostico: false, corte: null };
  for (const { fecha, acumulado: [rapido, lento], climaUsado } of serie.dias) {
    if (ciclo.tardia === null) {
      if (climaUsado === 'pronostico') ciclo.usaPronostico = true;
      ciclo.contadoHasta = fecha;
      ciclo.resumen = { conBaseMaxima: redondear(lento), conBaseMinima: redondear(rapido) };
      if (ciclo.temprana === null && rapido >= vidaMinima) ciclo.temprana = fecha;
      if (lento >= vidaMaxima) ciclo.tardia = fecha;
    }
    ciclo.dias.push({ fecha, condicion: condicionDelDia(rapido, ciclo.tardia, fecha, criterio), rapido, lento, climaUsado });
  }
  if (ciclo.tardia === null) ciclo.corte = serie.corte;
  return ciclo;
}
