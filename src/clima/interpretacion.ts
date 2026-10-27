import type { CategoriaLluvia } from "./types";

/**
 * Categoriza la lluvia de un lote en una sola palabra. Umbrales de punto de
 * partida para pastizales de la Pampa (igual criterio que `RANGOS` en
 * el scoring satelital provisional del backend), no una calibración agronómica.
 */

export const ETIQUETA_LLUVIA: Record<CategoriaLluvia, string> = {
  seco: "Seco",
  normal: "Normal",
  lluvia: "Lluvia en camino",
  "piso-pesado": "Piso pesado",
};

/**
 * Qué hay detrás de cada palabra. Los números son los de `categorizarLluvia` en
 * `backend/src/services/open-meteo.ts`: si cambian allá, cambian acá.
 */
export const EXPLICACION_LLUVIA: Record<CategoriaLluvia, string> = {
  seco: "Menos de 5 mm en los últimos 7 días y menos de 5 mm en los próximos.",
  normal: "Ni muy seco ni con mucha agua encima.",
  lluvia: "Se esperan 15 mm o más en los próximos días.",
  "piso-pesado": "Llovieron 40 mm o más en los últimos 7 días: el suelo puede estar blando para entrar con animales.",
};
