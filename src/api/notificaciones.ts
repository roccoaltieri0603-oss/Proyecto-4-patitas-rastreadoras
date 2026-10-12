import { pedir } from "./client";

export interface Notificacion {
  id: string;
  establecimientoId: string;
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

export interface NotificacionPersonal extends Omit<Notificacion, 'loteId'> { loteId?: null }
export const obtenerNotificacionesPersonales = (opciones: { limit?: number; offset?: number } = {}) => {
  const query = new URLSearchParams();
  if (opciones.limit !== undefined) query.set('limit', String(opciones.limit));
  if (opciones.offset !== undefined) query.set('offset', String(opciones.offset));
  return pedir<Omit<PaginaNotificaciones, 'notificaciones'> & { notificaciones: NotificacionPersonal[] }>(
    `/api/notificaciones-personales${query.size ? `?${query}` : ''}`);
};
export const marcarNotificacionPersonalLeida = (id: string) => pedir<void>(`/api/notificaciones-personales/${id}/leida`, { method: 'PATCH' });
export const marcarTodasPersonalesLeidas = () => pedir<{ actualizadas: number }>('/api/notificaciones-personales/leidas', { method: 'PATCH' });
export const eliminarNotificacionPersonalLeida = (id: string) => pedir<void>(`/api/notificaciones-personales/${id}`, { method: 'DELETE' });

export async function obtenerNotificaciones(establecimientoId: string, opciones: { limit?: number; offset?: number; soloNoLeidas?: boolean } = {}): Promise<PaginaNotificaciones> {
  const query = new URLSearchParams();
  if (opciones.limit !== undefined) query.set("limit", String(opciones.limit));
  if (opciones.offset !== undefined) query.set("offset", String(opciones.offset));
  if (opciones.soloNoLeidas !== undefined) query.set("soloNoLeidas", String(opciones.soloNoLeidas));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return pedir<PaginaNotificaciones>(`/api/establecimientos/${establecimientoId}/notificaciones${suffix}`);
}

export async function marcarNotificacionLeida(establecimientoId: string, id: string): Promise<Notificacion> {
  return (await pedir<{ notificacion: Notificacion }>(`/api/establecimientos/${establecimientoId}/notificaciones/${id}/leida`, { method: "PATCH" })).notificacion;
}

export async function marcarTodasLeidas(establecimientoId: string): Promise<number> {
  return (await pedir<{ actualizadas: number }>(`/api/establecimientos/${establecimientoId}/notificaciones/leidas`, { method: "PATCH" })).actualizadas;
}

export async function eliminarNotificacionLeida(establecimientoId: string, id: string): Promise<void> {
  await pedir<void>(`/api/establecimientos/${establecimientoId}/notificaciones/${id}`, { method: "DELETE" });
}
