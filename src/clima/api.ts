import { ApiError, pedir } from "../api/client";
import type { ResultadoClimaLote } from "./types";

export type OrigenConsultaClima = "automatico" | "manual";

/** El backend obtiene los polígonos, consulta Open-Meteo y persiste los resultados válidos. */
export async function actualizarClimaLotes(loteIds: string[], origen: OrigenConsultaClima): Promise<Record<string, ResultadoClimaLote>> {
  if (loteIds.length === 0) return {};

  try {
    const body = await pedir<{ resultados: Record<string, ResultadoClimaLote> }>("/api/lotes/clima/actualizar", {
      method: "POST",
      body: JSON.stringify({ loteIds, origen }),
    });
    return body.resultados;
  } catch (error) {
    const mensaje = error instanceof ApiError ? error.message : "No se pudo contactar al servicio meteorológico.";
    return Object.fromEntries(
      loteIds.map((loteId) => [loteId, { estado: "error", loteId, mensaje } as const]),
    );
  }
}

export async function actualizarClimaLote(loteId: string, origen: OrigenConsultaClima): Promise<ResultadoClimaLote> {
  return (await pedir<{ resultado: ResultadoClimaLote }>(`/api/lotes/${loteId}/clima/actualizar`, {
    method: "POST",
    body: JSON.stringify({ origen }),
  })).resultado;
}
