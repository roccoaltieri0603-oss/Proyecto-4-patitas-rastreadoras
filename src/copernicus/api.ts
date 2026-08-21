import { pedir } from "../api/client";
import type { ResultadoLote } from "./types";

export async function credencialesListas(): Promise<boolean> {
  try {
    return (await pedir<{ configurado: boolean }>("/api/copernicus/estado")).configurado === true;
  } catch {
    return false;
  }
}

export async function actualizarSateliteLote(loteId: string): Promise<ResultadoLote> {
  return (await pedir<{ resultado: ResultadoLote }>(`/api/lotes/${loteId}/satelite/actualizar`, { method: "POST" })).resultado;
}

export async function actualizarSateliteLotes(loteIds: string[]): Promise<ResultadoLote[]> {
  return (await pedir<{ resultados: ResultadoLote[] }>("/api/lotes/satelite/actualizar", {
    method: "POST",
    body: JSON.stringify({ loteIds }),
  })).resultados;
}

