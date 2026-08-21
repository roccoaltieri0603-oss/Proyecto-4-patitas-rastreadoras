import type { CategoriaCondicion } from "./types";

export const ETIQUETA_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "Excelente",
  buena: "Buena",
  regular: "Regular",
  baja: "Baja",
};

export const COLOR_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "#16a34a",
  buena: "#84cc16",
  regular: "#f59e0b",
  baja: "#dc2626",
};

export const COLOR_SIN_DATOS = "#94a3b8";
export const COLOR_RADAR = "#0ea5e9";
export const DIAS_VENTANA_VISIBLE = 45;

