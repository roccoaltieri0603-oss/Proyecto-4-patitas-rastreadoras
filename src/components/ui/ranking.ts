/** Clases Tailwind compartidas por los rankings de lotes (ClimaPanel y CondicionPanel). */

export const RANKING_LIST = "m-0 flex list-none flex-col gap-2 p-0";

export function rankingItemClass(selected: boolean, compact = false): string {
  const base = `cursor-pointer rounded-lg border bg-white transition-colors hover:border-[var(--color-campo-600)]/50 ${compact ? "px-2.5 py-2" : "px-3 py-2.5"}`;
  return selected ? `${base} border-[var(--color-campo-600)] shadow-[0_0_0_1px_var(--color-campo-600)_inset]` : `${base} border-gray-200`;
}

export const RANKING_HEADER = "flex items-center gap-2";
export const RANKING_NOMBRE = "flex-1 truncate text-sm font-bold text-gray-900 underline decoration-[var(--color-campo-600)]/40 decoration-2 underline-offset-2";
export const RANKING_PUNTAJE = "min-w-9 rounded-full px-2.5 py-0.5 text-center text-sm font-bold text-white";
export const RANKING_PUNTAJE_SIN_DATOS = "min-w-9 rounded-full bg-gray-200 px-2.5 py-0.5 text-center text-sm font-bold text-gray-500";
export const RANKING_SUB = "mt-1.5 flex flex-wrap items-center gap-1.5";
export const RANKING_SIN_DATOS_TEXTO = "mt-1";

/** Pill con fondo tenue del mismo color (vía color-mix, no hace falta una variante clara por color). */
export const CATEGORIA_CHIP = "rounded-full border px-2 py-0.5 text-[0.72rem] font-semibold";
export function categoriaChipStyle(color: string): { color: string; borderColor: string; background: string } {
  return { color, borderColor: color, background: `color-mix(in srgb, ${color} 12%, white)` };
}

export const BADGE_RECOMENDADO =
  "rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.04em] text-green-800";
export const VALORES_INLINE = "mt-1.5 flex flex-wrap gap-2.5 text-[0.82rem] text-gray-800 tabular-nums";
export const VALORES_COBERTURA = "text-[0.75rem] text-gray-400";

const ANTIGUEDAD_TONE: Record<"fresco" | "tibio" | "viejo", string> = {
  fresco: "bg-green-100 text-green-800",
  tibio: "bg-amber-100 text-amber-800",
  viejo: "bg-red-100 text-red-800",
};

export function antiguedadClass(tono: "fresco" | "tibio" | "viejo"): string {
  return `whitespace-nowrap rounded-full px-2 py-0.5 text-[0.75rem] ${ANTIGUEDAD_TONE[tono]}`;
}

/** Equivalente a la clase CSS .muted del diseño original. */
export const MUTED = "text-[0.85rem] text-gray-500";
/** Equivalente a la combinación .muted.small (texto aún más chico). */
export const MUTED_SMALL = "text-[0.78rem] text-gray-500";
