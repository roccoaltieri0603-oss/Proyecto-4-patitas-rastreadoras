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
  /**
   * `ia`: la detectó el modelo. `hueco`: superficie que quedó sin cubrir y se
   * ofrece como candidata; nadie afirma que ahí haya un lote, así que la
   * interfaz la muestra destildada y aparte.
   */
  origen: "ia" | "hueco";
}

export interface MetaSugerencias {
  modelo: string;
  dispositivo: string | null;
  zoom: number;
  tiles: number;
  metrosPorPixel: number;
  detectadas: number;
  descartadas: number;
  /** Franjas de recorte que el backend repartió entre lotes vecinos. */
  franjasAsignadas: number;
  /** Huecos sin cubrir ofrecidos como candidatos, incluidos en `sugerencias`. */
  huecos: number;
  segundos: number;
  generadoEn: string;
}

export interface RespuestaSugerencias {
  sugerencias: SugerenciaLote[];
  meta: MetaSugerencias;
}
