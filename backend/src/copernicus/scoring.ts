import type { EstadisticaIndice } from './types.js';

/**
 * Alertas de una observación óptica de Sentinel-2.
 *
 * El índice de condición 0-100 (puntaje y categoría) se sacó el 04/11/2026:
 * M. Oyarzabal (LART, FAUBA) lo consideró redundante, porque NDVI, EVI, NDWI y
 * la radiación absorbida ya se usan para medir crecimiento o detectar
 * inundación. Las filas viejas conservan su puntaje; las nuevas lo guardan NULL.
 */

const DIAS_DATO_VIEJO = 12;
const DESVIO_NDVI_DESPAREJO = 0.15;

/**
 * Porcentaje mínimo del lote con NDWI1 por encima de −0,2 para avisar agua
 * libre o suelo anegado. **Decisión de diseño sin fuente, a revisar** con lotes
 * que se sepa que se inundaron: Durante y Di Bella (2020) clasifican píxeles,
 * no lotes.
 */
export const FRACCION_MINIMA_INUNDADA = 0.1;

/** Compatible con `ALERTA_AGUA` de services/orden-pastoreo.ts. */
export const ALERTA_AGUA_LIBRE = 'Hay sectores con agua libre o suelo anegado.';

export function generarAlertas(params: {
  diasDesde: number;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  /** null cuando no se midió: entonces no hay alerta de agua. */
  fraccionInundada: number | null;
  fraccionMinimaInundada?: number;
}): string[] {
  const { diasDesde, coberturaValida, ndvi, ndmi, fraccionInundada, fraccionMinimaInundada = FRACCION_MINIMA_INUNDADA } = params;
  const alertas: string[] = [];
  if (diasDesde > DIAS_DATO_VIEJO) alertas.push(`La última imagen despejada es de hace ${diasDesde} días: puede haber cambiado la condición.`);
  if (coberturaValida < 0.6) alertas.push(`Sólo se vio despejado el ${Math.round(coberturaValida * 100)}% del lote; el promedio es parcial.`);
  if (fraccionInundada !== null && fraccionInundada >= fraccionMinimaInundada) alertas.push(ALERTA_AGUA_LIBRE);
  // Sin fuente: ver docs/OPEN_QUESTIONS.md.
  if (ndmi.media < 0) alertas.push('Estrés hídrico: la vegetación está seca.');
  if (ndvi.desvio > DESVIO_NDVI_DESPAREJO) alertas.push('Tapiz desparejo: conviven manchones verdes y pelados.');
  return alertas;
}
