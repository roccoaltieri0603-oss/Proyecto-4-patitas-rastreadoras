import type { Feature, Polygon } from "geojson";

export type PolygonFeature = Feature<Polygon>;

export interface Establecimiento {
  onboardingCompleted: boolean;
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
  favorito: boolean;
  createdAt: string;
  updatedAt: string;
}
