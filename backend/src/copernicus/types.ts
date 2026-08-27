import type { Feature, Polygon } from 'geojson';

export interface EstadisticaIndice {
  media: number;
  mediana: number;
  min: number;
  max: number;
  desvio: number;
}

export type CategoriaCondicion = 'excelente' | 'buena' | 'regular' | 'baja';

/**
 * Recta de mínimos cuadrados sobre los puntajes de `tendencia`. Derivada, no
 * observada: se calcula al responder y no se persiste.
 */
export interface ProyeccionTendencia {
  direccion: 'subiendo' | 'bajando' | 'estable';
  /** Puntos de puntaje que gana o pierde por semana según la recta. */
  pendienteSemanal: number;
  /** Si hay una categoría distinta a la vista en el horizonte, cuándo se cruzaría. */
  proximoCambio: { categoria: CategoriaCondicion; dias: number } | null;
}

export interface CondicionLote {
  fecha: string;
  diasDesde: number;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
  evi: EstadisticaIndice;
  puntaje: number;
  categoria: CategoriaCondicion;
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

export type ResultadoLote =
  | { estado: 'ok'; loteId: string; condicion: CondicionLote }
  | { estado: 'radar'; loteId: string; condicion: CondicionRadar; mensaje: string; optico?: CondicionLote }
  | { estado: 'sin-datos'; loteId: string; mensaje: string }
  | { estado: 'error'; loteId: string; mensaje: string };

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

export type LoteSatelital = { id: string; polygon: Feature<Polygon> };

