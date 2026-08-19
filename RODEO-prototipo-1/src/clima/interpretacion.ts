import type { CategoriaLluvia, Clima } from "./types";

/**
 * Categoriza la lluvia de un lote en una sola palabra. Umbrales de punto de
 * partida para pastizales de la Pampa (igual criterio que `RANGOS` en
 * `copernicus/scoring.ts`), no una calibración agronómica.
 */

const LLUVIA_SEMANA_BAJA_MM = 5;
const LLUVIA_SEMANA_ALTA_MM = 40;
const LLUVIA_PRONOSTICO_FUERTE_MM = 15;

export function categorizarLluvia(clima: Clima): CategoriaLluvia {
  const { lluviaUltimos7Dias: semana, lluviaProximosDias: proximos } = clima;
  if (semana >= LLUVIA_SEMANA_ALTA_MM) return "piso-pesado";
  if (proximos >= LLUVIA_PRONOSTICO_FUERTE_MM) return "lluvia";
  if (semana < LLUVIA_SEMANA_BAJA_MM && proximos < LLUVIA_SEMANA_BAJA_MM) return "seco";
  return "normal";
}

export const ETIQUETA_LLUVIA: Record<CategoriaLluvia, string> = {
  seco: "Seco",
  normal: "Normal",
  lluvia: "Lluvia en camino",
  "piso-pesado": "Piso pesado",
};
