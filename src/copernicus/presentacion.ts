import type { CategoriaCondicion } from "./types";

export const ETIQUETA_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "Excelente",
  buena: "Buena",
  regular: "Regular",
  baja: "Baja",
};

// Paleta de campo del proyecto (ver src/index.css). "regular" y "baja" no
// tienen equivalente propio: quedan en un ámbar/rojo estándar, legibles como
// texto chico y como fondo con letra blanca.
export const COLOR_CATEGORIA: Record<CategoriaCondicion, string> = {
  excelente: "var(--color-campo-700)",
  buena: "var(--color-campo-600)",
  regular: "#d97706",
  baja: "#dc2626",
};

export const COLOR_SIN_DATOS = "#94a3b8";
export const COLOR_RADAR = "var(--color-accent)";
export const DIAS_VENTANA_VISIBLE = 45;

