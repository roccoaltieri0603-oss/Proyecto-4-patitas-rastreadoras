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
