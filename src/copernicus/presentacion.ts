/**
 * Presentación de la condición satelital. Desde el 04/11/2026 el mapa ya no
 * colorea por el índice de condición 0-100 ni por categorías ("buena",
 * "excelente"): colorea por la mediana de NDVI de la última imagen óptica, con
 * una escala continua.
 */

export const COLOR_SIN_DATOS = "#94a3b8";
export const COLOR_RADAR = "var(--color-accent)";
export const DIAS_VENTANA_VISIBLE = 45;

/**
 * Extremos de la escala de color del mapa. Decisión de diseño, no un umbral
 * agronómico: por debajo de 0 y por encima de 0,9 el color queda en el tope.
 */
export const ESCALA_NDVI = { minimo: 0, maximo: 0.9 } as const;

/** Paradas de la escala, de suelo desnudo a canopeo cerrado; se interpola entre ellas. */
const PARADAS_NDVI: Array<{ ndvi: number; rgb: [number, number, number] }> = [
  { ndvi: 0, rgb: [214, 196, 160] },
  { ndvi: 0.3, rgb: [205, 196, 92] },
  { ndvi: 0.6, rgb: [112, 168, 62] },
  { ndvi: 0.9, rgb: [24, 92, 40] },
];

/** Color continuo para una mediana de NDVI. Sin dato, el gris de "sin datos". */
export function colorNdvi(ndvi: number | null | undefined): string {
  if (ndvi === null || ndvi === undefined || !Number.isFinite(ndvi)) return COLOR_SIN_DATOS;
  const valor = Math.min(ESCALA_NDVI.maximo, Math.max(ESCALA_NDVI.minimo, ndvi));
  const despues = PARADAS_NDVI.findIndex((parada) => parada.ndvi >= valor);
  if (despues <= 0) return rgb(PARADAS_NDVI[0].rgb);
  const a = PARADAS_NDVI[despues - 1];
  const b = PARADAS_NDVI[despues];
  const t = (valor - a.ndvi) / (b.ndvi - a.ndvi);
  return rgb([0, 1, 2].map((i) => Math.round(a.rgb[i] + (b.rgb[i] - a.rgb[i]) * t)) as [number, number, number]);
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Degradado CSS de la misma escala, de abajo (NDVI bajo) hacia arriba. */
export const DEGRADADO_NDVI = `linear-gradient(to top, ${PARADAS_NDVI.map((parada) => `${rgb(parada.rgb)} ${Math.round(((parada.ndvi - ESCALA_NDVI.minimo) / (ESCALA_NDVI.maximo - ESCALA_NDVI.minimo)) * 100)}%`).join(", ")})`;

/** "0,72": dos decimales con coma, como se lee en el campo. */
export function formatoNdvi(ndvi: number): string {
  return ndvi.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "dd/mm" de una fecha ISO. */
export function diaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

/** Porcentaje del lote inundado, redondeado; null si no se midió. */
export function porcentajeInundado(fraccion: number | null | undefined): number | null {
  return fraccion === null || fraccion === undefined || !Number.isFinite(fraccion) ? null : Math.round(fraccion * 100);
}
