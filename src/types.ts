import type { Feature, Polygon } from "geojson";

export type PolygonFeature = Feature<Polygon>;

export interface Establecimiento {
  id: string;
  nombre: string;
  polygon: PolygonFeature;
  createdAt: string;
  updatedAt: string;
}

export interface Lote {
  id: string;
  numero: number;
  apodo: string;
  polygon: PolygonFeature;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}
