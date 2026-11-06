import type { Feature, Polygon } from 'geojson';

export interface EstadisticaIndice {
  media: number;
  mediana: number;
  min: number;
  max: number;
  desvio: number;
}

/**
 * Recta de mínimos cuadrados sobre la mediana de NDVI de `tendencia`. Derivada,
 * no observada: se calcula al responder y no se persiste.
 */
export interface ProyeccionTendencia {
  direccion: 'subiendo' | 'bajando' | 'estable';
  /** NDVI que gana o pierde por semana según la recta. */
  pendienteSemanal: number;
}

/**
 * La misma recta de `ProyeccionTendencia`, leída contra un NDVI propio del
 * lote. Derivada y efímera igual que aquélla: se calcula al responder y no se
 * persiste.
 */
export interface ProyeccionRecuperacion {
  /** Mediana de NDVI de la que se parte. */
  ndviInicial: number;
  /** Mediana de NDVI a partir de la cual el lote se considera recuperado. */
  umbralRecuperado: number;
  /** NDVI por semana según la serie real del lote. */
  pendienteSemanal: number;
  /** Días hasta cruzar el umbral a ese ritmo. */
  dias: number;
}

export interface CondicionLote {
  fecha: string;
  diasDesde: number;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
  evi: EstadisticaIndice;
  /**
   * Media de NDWI1 = (B04 − B11) / (B04 + B11) de Durante y Di Bella (2020).
   * Experimental; null en las observaciones anteriores a la migración 022.
   */
  ndwi1Media: number | null;
  /** Fracción de los píxeles despejados con NDWI1 por encima de −0,2 (0..1); null si no se midió. */
  fraccionInundada: number | null;
  alertas: string[];
  tendencia: { fecha: string; ndvi: number; ndmi: number; ndwi: number; evi: number }[];
  /** Ausente cuando la tendencia tiene muy pocos puntos para ajustar una recta. */
  proyeccion?: ProyeccionTendencia;
}

export interface CondicionRadar {
  fecha: string;
  diasDesde: number;
  rvi: EstadisticaIndice;
}

export type ResultadoLote = (
  | { estado: 'ok'; loteId: string; condicion: CondicionLote }
  | { estado: 'radar'; loteId: string; condicion: CondicionRadar; mensaje: string; optico?: CondicionLote }
  | { estado: 'sin-datos'; loteId: string; mensaje: string }
  | { estado: 'error'; loteId: string; mensaje: string }
) & { limiteCopernicus?: boolean };

export interface RespuestaEstadisticas {
  data?: IntervaloEstadisticas[];
  status?: string;
  error?: string | { message?: string };
}

export interface IntervaloEstadisticas {
  interval: { from: string; to: string };
  outputs?: Record<string, { bands: Record<string, { stats: StatsCrudas }> }>;
  error?: unknown;
}

export interface StatsCrudas {
  min: number | string;
  max: number | string;
  mean: number | string;
  stDev: number | string;
  sampleCount: number;
  noDataCount: number;
  percentiles?: Record<string, number | string>;
}

export type LoteSatelital = { id: string; polygon: Feature<Polygon>; establecimientoId?: string };

