import { pedir } from "../api/client";
import type { ResultadoLote } from "./types";

export interface RespuestaActualizacionSatelital {
  resultados: ResultadoLote[];
  estado: "completo" | "parcial";
  motivoCorte?: string;
  pendientes: string[];
  erroresPersistencia: { loteId: string; mensaje: string }[];
}

export interface RespuestaActualizacionSatelitalIndividual {
  resultado: ResultadoLote;
  erroresPersistencia: { loteId: string; mensaje: string }[];
  corteCopernicus: boolean;
}

export async function credencialesListas(): Promise<boolean> {
  try {
    return (await pedir<{ configurado: boolean }>("/api/copernicus/estado")).configurado === true;
  } catch {
    return false;
  }
}

export async function actualizarSateliteLote(establecimientoId: string, loteId: string): Promise<RespuestaActualizacionSatelitalIndividual> {
  return await pedir<RespuestaActualizacionSatelitalIndividual>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/satelite/actualizar`, { method: "POST" });
}

export async function actualizarSateliteLotes(establecimientoId: string, loteIds: string[]): Promise<RespuestaActualizacionSatelital> {
  return await pedir<RespuestaActualizacionSatelital>(`/api/establecimientos/${establecimientoId}/lotes/satelite/actualizar`, {
    method: "POST",
    body: JSON.stringify({ loteIds }),
  });
}

