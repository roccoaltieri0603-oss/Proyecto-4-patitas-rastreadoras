import type { CategoriaCondicion, EstadisticaIndice } from './types.js';

const RANGOS = {
  ndvi: { piso: 0.2, techo: 0.8, peso: 0.5 },
  ndmi: { piso: -0.1, techo: 0.35, peso: 0.3 },
  evi: { piso: 0.1, techo: 0.55, peso: 0.2 },
} as const;

const NDWI_UMBRAL_AGUA = -0.05;
const NDWI_SATURACION = 0.2;
const PENALIZACION_MAX_AGUA = 25;
const DIAS_DATO_VIEJO = 12;
const DESVIO_NDVI_DESPAREJO = 0.15;

function normalizar(valor: number, piso: number, techo: number): number {
  if (techo === piso) return 0;
  return Math.min(1, Math.max(0, (valor - piso) / (techo - piso)));
}

export function calcularPuntaje(ndvi: EstadisticaIndice, ndmi: EstadisticaIndice, ndwi: EstadisticaIndice, evi: EstadisticaIndice): number {
  const nNdvi = normalizar(ndvi.mediana, RANGOS.ndvi.piso, RANGOS.ndvi.techo);
  const nNdmi = normalizar(ndmi.media, RANGOS.ndmi.piso, RANGOS.ndmi.techo);
  const nEvi = normalizar(evi.media, RANGOS.evi.piso, RANGOS.evi.techo);
  const base = 100 * (nNdvi * RANGOS.ndvi.peso + nNdmi * RANGOS.ndmi.peso + nEvi * RANGOS.evi.peso);
  const excesoAgua = normalizar(ndwi.media, NDWI_UMBRAL_AGUA, NDWI_SATURACION);
  return Math.round(Math.min(100, Math.max(0, base - excesoAgua * PENALIZACION_MAX_AGUA)));
}

export function categorizar(puntaje: number): CategoriaCondicion {
  if (puntaje >= 70) return 'excelente';
  if (puntaje >= 50) return 'buena';
  if (puntaje >= 30) return 'regular';
  return 'baja';
}

export function generarAlertas(params: { diasDesde: number; coberturaValida: number; ndvi: EstadisticaIndice; ndmi: EstadisticaIndice; ndwi: EstadisticaIndice }): string[] {
  const { diasDesde, coberturaValida, ndvi, ndmi, ndwi } = params;
  const alertas: string[] = [];
  if (diasDesde > DIAS_DATO_VIEJO) alertas.push(`La última imagen despejada es de hace ${diasDesde} días: puede haber cambiado la condición.`);
  if (coberturaValida < 0.6) alertas.push(`Sólo se vio despejado el ${Math.round(coberturaValida * 100)}% del lote; el promedio es parcial.`);
  if (ndwi.media > NDWI_UMBRAL_AGUA) alertas.push('Hay sectores con agua libre o suelo anegado.');
  if (ndmi.media < 0) alertas.push('Estrés hídrico: la vegetación está seca.');
  if (ndvi.desvio > DESVIO_NDVI_DESPAREJO) alertas.push('Tapiz desparejo: conviven manchones verdes y pelados.');
  return alertas;
}

