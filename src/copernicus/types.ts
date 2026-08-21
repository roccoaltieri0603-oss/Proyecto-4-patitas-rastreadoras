/** Estadísticas de un índice sobre el polígono del lote, para una fecha. */
export interface EstadisticaIndice {
  media: number;
  mediana: number;
  min: number;
  max: number;
  desvio: number;
}

export type CategoriaCondicion = "excelente" | "buena" | "regular" | "baja";

/** Lectura satelital más reciente utilizable de un lote. */
export interface CondicionLote {
  /** Fecha de la pasada de Sentinel-2 (ISO, YYYY-MM-DD). */
  fecha: string;
  /** Días transcurridos desde esa pasada. */
  diasDesde: number;
  /** Fracción del lote sin nubes/sombras en esa pasada (0..1). */
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
  evi: EstadisticaIndice;
  /** Aptitud para pastoreo, 0..100. */
  puntaje: number;
  categoria: CategoriaCondicion;
  /** Avisos para el usuario (dato viejo, anegamiento, poca cobertura...). */
  alertas: string[];
  /** Serie de índices de fechas previas despejadas, del más viejo al más nuevo. */
  tendencia: { fecha: string; ndvi: number; ndmi: number; ndwi: number; evi: number }[];
}

/**
 * Lectura de respaldo por radar (Sentinel-1), cuando no hay ninguna pasada
 * óptica despejada reciente. El RVI no es comparable con el puntaje 0..100
 * de `CondicionLote`: por eso viaja aparte, sin puntaje ni categoría.
 */
export interface CondicionRadar {
  /** Fecha de la pasada de Sentinel-1 (ISO, YYYY-MM-DD). */
  fecha: string;
  /** Días transcurridos desde esa pasada. */
  diasDesde: number;
  /** Radar Vegetation Index (RVI4S1), 0..1: crece con la biomasa del canopeo. */
  rvi: EstadisticaIndice;
}

export type ResultadoLote =
  | { estado: "ok"; loteId: string; condicion: CondicionLote }
  | {
      estado: "radar";
      loteId: string;
      condicion: CondicionRadar;
      mensaje: string;
      /**
       * Última óptica despejada, cuando la hubo pero el radar le ganó en
       * frescura. Viaja aparte de `condicion` a propósito: el NDVI sigue
       * siendo el dato agronómico útil aunque sea más viejo, pero no se
       * combina ni se promedia con el RVI (física distinta, sin calibración
       * cruzada). Se muestra rotulado y con su propia fecha.
       */
      optico?: CondicionLote;
    }
  | { estado: "sin-datos"; loteId: string; mensaje: string }
  | { estado: "error"; loteId: string; mensaje: string };
