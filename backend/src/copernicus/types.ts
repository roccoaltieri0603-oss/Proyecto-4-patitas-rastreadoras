import type { Feature, Polygon } from 'geojson';

export interface EstadisticaIndice {
  media: number;
  mediana: number;
  min: number;
  max: number;
  desvio: number;
}

export type CategoriaCondicion = 'excelente' | 'buena' | 'regular' | 'baja';

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

