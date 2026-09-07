import { pedir } from "./client";
import type { RespuestaSugerencias } from "../ia/types";

export async function iaDisponible(establecimientoId: string): Promise<boolean> {
  try {
    return (await pedir<{ configurado: boolean }>(`/api/establecimientos/${establecimientoId}/ia/estado`)).configurado === true;
  } catch {
    return false;
  }
}

/** Pide la propuesta de subdivisión. El backend no guarda nada al responder. */
export async function sugerirLotes(establecimientoId: string): Promise<RespuestaSugerencias> {
  return pedir<RespuestaSugerencias>(`/api/establecimientos/${establecimientoId}/ia/sugerir-lotes`, { method: "POST" });
}
