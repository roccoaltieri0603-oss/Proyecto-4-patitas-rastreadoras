import { pedir } from "./client";
import type { RespuestaSugerencias } from "../ia/types";

export async function iaDisponible(): Promise<boolean> {
  try {
    return (await pedir<{ configurado: boolean }>("/api/ia/estado")).configurado === true;
  } catch {
    return false;
  }
}

/** Pide la propuesta de subdivisión. El backend no guarda nada al responder. */
export async function sugerirLotes(): Promise<RespuestaSugerencias> {
  return pedir<RespuestaSugerencias>("/api/ia/sugerir-lotes", { method: "POST" });
}
