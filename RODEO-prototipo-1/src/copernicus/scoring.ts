import type { CategoriaCondicion, EstadisticaIndice } from "./types";

/**
 * Traduce los índices espectrales a una aptitud de pastoreo 0..100.
 *
 * Los rangos están pensados para pastizales / pasturas templadas: son un punto
 * de partida razonable, no una calibración agronómica. Si más adelante tenés
 * cortes de forraje reales, ajustá estas constantes contra esos datos.
 */

const RANGOS = {
  // NDVI: 0.20 ≈ rastrojo o suelo casi desnudo, 0.80 ≈ pastura densa y verde.
  ndvi: { piso: 0.2, techo: 0.8, peso: 0.5 },
  // NDMI: negativo ≈ vegetación seca, > 0.3 ≈ bien hidratada.
  ndmi: { piso: -0.1, techo: 0.35, peso: 0.3 },
  // EVI: menos sensible a la saturación cuando hay mucha biomasa.
  evi: { piso: 0.1, techo: 0.55, peso: 0.2 },
} as const;

/** NDWI por encima de esto ya sugiere agua libre o suelo anegado. */
const NDWI_UMBRAL_AGUA = -0.05;
const NDWI_SATURACION = 0.2;
const PENALIZACION_MAX_AGUA = 25;

/** A partir de acá el dato empieza a ser viejo para decidir un pastoreo. */
const DIAS_DATO_VIEJO = 12;
/** Desvío del NDVI dentro del lote que ya indica un tapiz muy desparejo. */
const DESVIO_NDVI_DESPAREJO = 0.15;

function normalizar(valor: number, piso: number, techo: number): number {
  if (techo === piso) return 0;
  return Math.min(1, Math.max(0, (valor - piso) / (techo - piso)));
}

export function calcularPuntaje(
  ndvi: EstadisticaIndice,
  ndmi: EstadisticaIndice,
  ndwi: EstadisticaIndice,
  evi: EstadisticaIndice,
): number {
  // Usamos la mediana del NDVI: un par de píxeles de aguada o alambrado no
  // deberían mover el número del lote entero.
  const nNdvi = normalizar(ndvi.mediana, RANGOS.ndvi.piso, RANGOS.ndvi.techo);
  const nNdmi = normalizar(ndmi.media, RANGOS.ndmi.piso, RANGOS.ndmi.techo);
  const nEvi = normalizar(evi.media, RANGOS.evi.piso, RANGOS.evi.techo);

  const base =
    100 *
    (nNdvi * RANGOS.ndvi.peso + nNdmi * RANGOS.ndmi.peso + nEvi * RANGOS.evi.peso);

  const excesoAgua = normalizar(ndwi.media, NDWI_UMBRAL_AGUA, NDWI_SATURACION);
  const puntaje = base - excesoAgua * PENALIZACION_MAX_AGUA;

  return Math.round(Math.min(100, Math.max(0, puntaje)));
}

export function categorizar(puntaje: number): CategoriaCondicion {
  if (puntaje >= 70) return "excelente";
  if (puntaje >= 50) return "buena";
  if (puntaje >= 30) return "regular";
  return "baja";
}

export const ETIQUETA_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "Excelente",
  buena: "Buena",
  regular: "Regular",
  baja: "Baja",
};

export const COLOR_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "#16a34a",
  buena: "#84cc16",
  regular: "#f59e0b",
  baja: "#dc2626",
};

export const COLOR_SIN_DATOS = "#94a3b8";

/** Lotes mostrados con el respaldo de radar (Sentinel-1), no con NDVI óptico. */
export const COLOR_RADAR = "#0ea5e9";

export function generarAlertas(params: {
  diasDesde: number;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
}): string[] {
  const { diasDesde, coberturaValida, ndvi, ndmi, ndwi } = params;
  const alertas: string[] = [];

  if (diasDesde > DIAS_DATO_VIEJO) {
    alertas.push(
      `La última imagen despejada es de hace ${diasDesde} días: puede haber cambiado la condición.`,
    );
  }
  if (coberturaValida < 0.6) {
    alertas.push(
      `Sólo se vio despejado el ${Math.round(coberturaValida * 100)}% del lote; el promedio es parcial.`,
    );
  }
  if (ndwi.media > NDWI_UMBRAL_AGUA) {
    alertas.push("Hay sectores con agua libre o suelo anegado.");
  }
  if (ndmi.media < 0) {
    alertas.push("Estrés hídrico: la vegetación está seca.");
  }
  if (ndvi.desvio > DESVIO_NDVI_DESPAREJO) {
    alertas.push("Tapiz desparejo: conviven manchones verdes y pelados.");
  }

  return alertas;
}
