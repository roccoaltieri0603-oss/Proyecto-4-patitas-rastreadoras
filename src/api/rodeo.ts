import { pedir } from "./client";
import type { Establecimiento, Lote, PolygonFeature } from "../types";

export async function obtenerEstablecimiento(): Promise<Establecimiento | null> {
  return (await pedir<{ establecimiento: Establecimiento | null }>("/api/establecimiento")).establecimiento;
}

export async function crearEstablecimiento(nombre: string, polygon: PolygonFeature): Promise<Establecimiento> {
  return (await pedir<{ establecimiento: Establecimiento }>("/api/establecimiento", {
    method: "POST", body: JSON.stringify({ nombre, polygon }),
  })).establecimiento;
}

export async function actualizarEstablecimiento(changes: Partial<Pick<Establecimiento, "nombre" | "polygon">>): Promise<Establecimiento> {
  return (await pedir<{ establecimiento: Establecimiento }>("/api/establecimiento", {
    method: "PATCH", body: JSON.stringify(changes),
  })).establecimiento;
}

export async function obtenerLotes(): Promise<Lote[]> {
  return (await pedir<{ lotes: Lote[] }>("/api/lotes")).lotes;
}

export async function crearLote(polygon: PolygonFeature, apodo = ""): Promise<Lote> {
  return (await pedir<{ lote: Lote }>("/api/lotes", {
    method: "POST", body: JSON.stringify({ polygon, apodo: apodo || null }),
  })).lote;
}

export async function actualizarLote(id: string, changes: Partial<Pick<Lote, "apodo" | "activo" | "polygon">>): Promise<Lote> {
  return (await pedir<{ lote: Lote }>(`/api/lotes/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  })).lote;
}

export async function eliminarLote(id: string): Promise<void> {
  await pedir<void>(`/api/lotes/${id}`, { method: "DELETE" });
}
