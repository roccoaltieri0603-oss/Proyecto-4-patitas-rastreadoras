import type { Feature, Polygon } from "geojson";

export type PolygonFeature = Feature<Polygon>;

export interface Establecimiento {
  id: string;
  nombre: string;
  polygon: PolygonFeature;
}

export interface Lote {
  id: string;
  numero: number;
  apodo: string;
  polygon: PolygonFeature;
  activo: boolean;
  createdAt: number;
}

export interface RodeoState {
  establecimiento: Establecimiento | null;
  lotes: Lote[];
  nextLoteNumero: number;
}
