import { pedir } from "./client";

export interface Notificacion {
  id: string;
  loteId: string | null;
  tipo: string;
  titulo: string;
  mensaje: string;
  leida: boolean;
  readAt: string | null;
  metadata: unknown | null;
  createdAt: string;
}

export interface PaginaNotificaciones {
  notificaciones: Notificacion[];
  noLeidas: number;
  paginacion: { limit: number; offset: number; total: number; hayMas: boolean };
}

export async function obtenerNotificaciones(opciones: { limit?: number; offset?: number; soloNoLeidas?: boolean } = {}): Promise<PaginaNotificaciones> {
  const query = new URLSearchParams();
  if (opciones.limit !== undefined) query.set("limit", String(opciones.limit));
  if (opciones.offset !== undefined) query.set("offset", String(opciones.offset));
  if (opciones.soloNoLeidas !== undefined) query.set("soloNoLeidas", String(opciones.soloNoLeidas));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return pedir<PaginaNotificaciones>(`/api/notificaciones${suffix}`);
}

export async function marcarNotificacionLeida(id: string): Promise<Notificacion> {
  return (await pedir<{ notificacion: Notificacion }>(`/api/notificaciones/${id}/leida`, { method: "PATCH" })).notificacion;
}

export async function marcarTodasLeidas(): Promise<number> {
  return (await pedir<{ actualizadas: number }>("/api/notificaciones/leidas", { method: "PATCH" })).actualizadas;
}
