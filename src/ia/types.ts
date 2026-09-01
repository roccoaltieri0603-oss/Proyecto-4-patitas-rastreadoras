import type { PolygonFeature } from "../types";

/**
 * Una subdivisión propuesta por el modelo. Vive sólo en memoria del navegador
 * hasta que el usuario confirma: recién ahí se convierte en lotes reales vía
 * POST /api/lotes. Nunca se guarda sola.
 */
export interface SugerenciaLote {
  id: string;
  polygon: PolygonFeature;
  hectareas: number;
  confianza: number | null;
}

export interface MetaSugerencias {
  modelo: string;
  dispositivo: string | null;
  zoom: number;
  tiles: number;
  metrosPorPixel: number;
  detectadas: number;
  descartadas: number;
  segundos: number;
  generadoEn: string;
}

export interface RespuestaSugerencias {
  sugerencias: SugerenciaLote[];
  meta: MetaSugerencias;
}
