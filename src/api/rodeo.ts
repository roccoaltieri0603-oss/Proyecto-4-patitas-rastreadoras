import { pedir } from "./client";
import type { Establecimiento, Lote, PolygonFeature } from "../types";
import type { ResultadoLote } from '../copernicus/types';
import type { ResultadoClimaLote } from '../clima/types';

export function obtenerLecturasCompartidas(establecimientoId: string) {
  return pedir<{ satelite: ResultadoLote[]; clima: Record<string, ResultadoClimaLote> }>(`/api/establecimientos/${establecimientoId}/lotes/lecturas`);
}

export async function obtenerEstablecimiento(establecimientoId: string): Promise<Establecimiento | null> {
  return (await pedir<{ establecimiento: Establecimiento | null }>(`/api/establecimientos/${establecimientoId}`)).establecimiento;
}

export async function crearEstablecimiento(nombre: string, polygon: PolygonFeature): Promise<Establecimiento> {
  return (await pedir<{ establecimiento: Establecimiento }>("/api/establecimientos", {
    method: "POST", body: JSON.stringify({ nombre, polygon }),
  })).establecimiento;
}

export async function actualizarEstablecimiento(establecimientoId: string, changes: Partial<Pick<Establecimiento, "nombre" | "polygon">>): Promise<Establecimiento> {
  return (await pedir<{ establecimiento: Establecimiento }>(`/api/establecimientos/${establecimientoId}`, {
    method: "PATCH", body: JSON.stringify(changes),
  })).establecimiento;
}

export async function obtenerLotes(establecimientoId: string): Promise<Lote[]> {
  return (await pedir<{ lotes: Lote[] }>(`/api/establecimientos/${establecimientoId}/lotes`)).lotes;
}

export async function crearLote(establecimientoId: string, polygon: PolygonFeature, apodo = "", origen: 'manual' | 'ia' = 'manual'): Promise<Lote> {
  return (await pedir<{ lote: Lote }>(`/api/establecimientos/${establecimientoId}/lotes`, {
    method: "POST", body: JSON.stringify({ polygon, apodo: apodo || null, origen }),
  })).lote;
}

export async function actualizarLote(establecimientoId: string, id: string, changes: Partial<Pick<Lote, "apodo" | "activo" | "polygon">>): Promise<Lote> {
  return (await pedir<{ lote: Lote }>(`/api/establecimientos/${establecimientoId}/lotes/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  })).lote;
}

export async function eliminarLote(establecimientoId: string, id: string): Promise<void> {
  await pedir<void>(`/api/establecimientos/${establecimientoId}/lotes/${id}`, { method: "DELETE" });
}

export async function actualizarFavoritoLote(establecimientoId: string, id: string, favorito: boolean): Promise<{ loteId: string; favorito: boolean }> {
  return pedir(`/api/establecimientos/${establecimientoId}/lotes/${id}/favorito`, {
    method: "PATCH", body: JSON.stringify({ favorito }),
  });
}
