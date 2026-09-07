import { pedir } from "../api/client";
import type { ResultadoLote } from "./types";

export async function credencialesListas(): Promise<boolean> {
  try {
    return (await pedir<{ configurado: boolean }>("/api/copernicus/estado")).configurado === true;
  } catch {
    return false;
  }
}

export async function actualizarSateliteLote(establecimientoId: string, loteId: string): Promise<ResultadoLote> {
  return (await pedir<{ resultado: ResultadoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/satelite/actualizar`, { method: "POST" })).resultado;
}

export async function actualizarSateliteLotes(establecimientoId: string, loteIds: string[]): Promise<ResultadoLote[]> {
  return (await pedir<{ resultados: ResultadoLote[] }>(`/api/establecimientos/${establecimientoId}/lotes/satelite/actualizar`, {
    method: "POST",
    body: JSON.stringify({ loteIds }),
  })).resultados;
}

