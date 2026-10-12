import { pedir } from './client';
import type { Establecimiento } from '../types';
export { PERMISOS_ADMIN, CAPACIDADES_PROPIETARIO, puede, tieneCapacidad } from '../../backend/src/autorizacion/catalogo';
export type { Membresia, PermisoAdmin, CapacidadPropietario, Rol } from '../../backend/src/autorizacion/catalogo';
import type { Membresia } from '../../backend/src/autorizacion/catalogo';

export interface EstablecimientoResumen { id: string; nombre: string; onboardingCompleted: boolean; membresia: Membresia & { puestoOperativoId: string; nombreOperativo: string } }
export interface Miembro extends Membresia { username: string }
export type ConfiguracionMiembro = Pick<Membresia, 'rol' | 'permisos' | 'capacidades'>;
export interface PuestoOperativo {
  id: string;
  establecimiento_id: string;
  nombre: string;
  rol: Membresia['rol'];
  permisos: Membresia['permisos'];
  capacidades: Membresia['capacidades'];
  propietario_user_id: string | null;
  predeterminado: boolean;
  integrantes: Array<{ userId: string; username: string; ultimaActividadEn?: string | null; enLinea?: boolean }>;
}
export interface IngresoForzado { id: string; ocurridaEn: string; puesto: string; actor: string; afectado: string }
export const listarEstablecimientos = () => pedir<{ establecimientos: EstablecimientoResumen[] }>('/api/establecimientos');
export const entrarPuesto = (eid: string, puestoId: string, forzar = false) => pedir<{ sesion: { puestoOperativoId: string; establecimientoId: string; nombreOperativo: string; rol: Membresia['rol']; venceEn: string } }>(`/api/establecimientos/${eid}/puestos/${puestoId}/entrar`, { method: 'POST', body: JSON.stringify({ forzar }) });
export const salirDelEstablecimiento = (eid: string) => pedir<void>(`/api/establecimientos/${eid}/salir`, { method: 'POST' });
export const cargarEstablecimiento = (id: string) => pedir<{ establecimiento: Establecimiento; membresia: Membresia }>(`/api/establecimientos/${id}`);
export const unirseConCodigo = (codigo: string) => pedir<{ establecimientoId: string; puestoOperativoId: string }>('/api/establecimientos/unirse', { method: 'POST', body: JSON.stringify({ codigo }) });
export const obtenerEquipo = (id: string) => pedir<{ puestos: PuestoOperativo[]; responsableGpsPuestoId: string | null; miembros: Miembro[]; responsableGpsUserId: string | null }>(`/api/establecimientos/${id}/equipo`);
export const obtenerIngresosForzados = (id: string) => pedir<{ ingresos: IngresoForzado[]; paginacion: { total: number; hayMas: boolean; limit: number; offset: number } }>(`/api/establecimientos/${id}/equipo/ingresos-forzados?limit=20`);
export const designarResponsableGps = (id: string, puestoOperativoId: string | null) => pedir<void>(`/api/establecimientos/${id}/equipo/responsable-gps`, { method: 'PATCH', body: JSON.stringify({ puestoOperativoId }) });
export const modificarMiembro = (id: string, userId: string, config: ConfiguracionMiembro) => pedir<void>(`/api/establecimientos/${id}/equipo/${userId}`, { method: 'PATCH', body: JSON.stringify(config) });
export const expulsarMiembro = (id: string, userId: string) => pedir<void>(`/api/establecimientos/${id}/equipo/${userId}`, { method: 'DELETE' });
export const generarInvitacion = (id: string, destino: { rol?: Membresia['rol']; puestoOperativoId?: string; capacidades?: Membresia['capacidades'] }) => pedir<{ invitacion: { codigo: string; expiresAt: string } }>(`/api/establecimientos/${id}/invitaciones`, { method: 'POST', body: JSON.stringify(destino) });
export const crearPuesto = (id: string, nombre: string, permisos: Membresia['permisos']) => pedir<{ puestoOperativoId: string }>(`/api/establecimientos/${id}/equipo/puestos`, { method: 'POST', body: JSON.stringify({ nombre, permisos }) });
export const actualizarPuesto = (id: string, puesto: PuestoOperativo, config: ConfiguracionMiembro) => pedir<void>(`/api/establecimientos/${id}/equipo/puestos/${puesto.id}`, { method: 'PATCH', body: JSON.stringify({ ...config, confirmarPuestoCompleto: true }) });
export const cambiarRolDeIntegrante = (id: string, puestoId: string, userId: string, rol: Membresia['rol']) => pedir<{ puestoOperativoId: string }>(`/api/establecimientos/${id}/equipo/puestos/${puestoId}/integrantes/${userId}/cambiar-rol`, { method: 'POST', body: JSON.stringify({ rol }) });
export const expulsarDePuesto = (id: string, puestoId: string, userId: string) => pedir<void>(`/api/establecimientos/${id}/equipo/puestos/${puestoId}/integrantes/${userId}`, { method: 'DELETE' });
export const transferirPrincipal = (id: string, userId: string, confirmacion: string) => pedir<void>(`/api/establecimientos/${id}/transferir-principal`, { method: 'POST', body: JSON.stringify({ userId, confirmacion }) });
export const eliminarEstablecimiento = (id: string, confirmacion: string) => pedir<void>(`/api/establecimientos/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmacion }) });
