/** Clases Tailwind compartidas por los rankings de lotes (ClimaPanel y CondicionPanel). */

export const RANKING_LIST = "m-0 flex list-none flex-col gap-2 p-0";

export function rankingItemClass(selected: boolean): string {
  const base = "cursor-pointer rounded-md border bg-white px-2.5 py-2 transition-colors hover:border-gray-400";
  return selected ? `${base} border-amber-500 shadow-[0_0_0_1px_#f59e0b_inset]` : `${base} border-gray-200`;
}

export const RANKING_HEADER = "flex items-center gap-2";
export const RANKING_PUESTO =
  "flex h-5 w-5 flex-none items-center justify-center rounded-full bg-gray-200 text-[0.72rem] font-semibold text-gray-700";
export const RANKING_NOMBRE = "flex-1 text-sm font-semibold text-gray-800";
export const RANKING_PUNTAJE = "min-w-8 rounded px-1.5 py-0.5 text-center text-sm font-bold text-white";
export const RANKING_PUNTAJE_SIN_DATOS = "min-w-8 rounded bg-gray-200 px-1.5 py-0.5 text-center text-sm font-bold text-gray-500";
export const RANKING_SUB = "mt-1.5 flex flex-wrap items-center gap-2 pl-7";
export const RANKING_SIN_DATOS_TEXTO = "mt-1 pl-7";
export const CATEGORIA_CHIP = "text-xs font-semibold uppercase tracking-[0.03em]";
export const BADGE_RECOMENDADO =
  "rounded border border-green-300 bg-green-100 px-1.5 py-px text-[0.68rem] uppercase tracking-[0.04em] text-green-800";
export const VALORES_INLINE = "mt-1.5 flex flex-wrap gap-2.5 pl-7 text-[0.82rem] text-gray-800 tabular-nums";
export const VALORES_COBERTURA = "text-[0.75rem] text-gray-400";

const ANTIGUEDAD_TONE: Record<"fresco" | "tibio" | "viejo", string> = {
  fresco: "bg-green-100 text-green-800",
  tibio: "bg-amber-100 text-amber-800",
  viejo: "bg-red-100 text-red-800",
};

export function antiguedadClass(tono: "fresco" | "tibio" | "viejo"): string {
  return `whitespace-nowrap rounded px-1.5 py-px text-[0.75rem] ${ANTIGUEDAD_TONE[tono]}`;
}

/** Equivalente a la clase CSS .muted del diseño original. */
export const MUTED = "text-[0.85rem] text-gray-500";
/** Equivalente a la combinación .muted.small (texto aún más chico). */
export const MUTED_SMALL = "text-[0.78rem] text-gray-500";
