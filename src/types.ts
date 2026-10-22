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
  /** null: nadie cargó la pastura; nunca se asume una por defecto. */
  tipoPastura: TipoPastura | null;
  fechaSiembra: string | null;
  favorito: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Misma lista que TIPOS_PASTURA en backend/src/estimacion/parametros.ts y el CHECK de la migración 015. */
export const NOMBRES_PASTURA = {
  alfalfa: "Alfalfa",
  festuca_alta: "Festuca alta",
  mezcla_alfalfa_gramineas: "Mezcla alfalfa con gramíneas",
  raigras_anual: "Raigrás anual",
  raigras_perenne: "Raigrás perenne",
  agropiro_alargado: "Agropiro alargado",
  pasto_ovillo: "Pasto ovillo",
  cebadilla_criolla: "Cebadilla criolla",
  avena: "Avena (verdeo de invierno)",
  pastizal_natural: "Pastizal natural",
} as const;

export type TipoPastura = keyof typeof NOMBRES_PASTURA;
