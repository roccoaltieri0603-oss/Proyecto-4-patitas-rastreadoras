import type { RodeoState } from "./types";

const STORAGE_KEY = "rodeo:state:v1";

export const emptyState: RodeoState = {
  establecimiento: null,
  lotes: [],
  nextLoteNumero: 1,
};

export function loadState(): RodeoState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState;
  try {
    const parsed = JSON.parse(raw) as RodeoState;
    return {
      establecimiento: parsed.establecimiento ?? null,
      lotes: parsed.lotes ?? [],
      nextLoteNumero: parsed.nextLoteNumero ?? 1,
    };
  } catch {
    return emptyState;
  }
}

export function saveState(state: RodeoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
