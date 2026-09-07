import { pedir } from './client';
import type { Establecimiento } from '../types';
export { PERMISOS_ADMIN, CAPACIDADES_PROPIETARIO, puede, tieneCapacidad } from '../../backend/src/autorizacion/catalogo';
export type { Membresia, PermisoAdmin, CapacidadPropietario, Rol } from '../../backend/src/autorizacion/catalogo';
import type { Membresia } from '../../backend/src/autorizacion/catalogo';

export interface EstablecimientoResumen { id: string; nombre: string; onboardingCompleted: boolean; membresia: Membresia }
export interface Miembro extends Membresia { username: string }
export type ConfiguracionMiembro = Pick<Membresia, 'rol' | 'permisos' | 'capacidades'>;
export const listarEstablecimientos = () => pedir<{ establecimientos: EstablecimientoResumen[] }>('/api/establecimientos');
export const cargarEstablecimiento = (id: string) => pedir<{ establecimiento: Establecimiento; membresia: Membresia }>(`/api/establecimientos/${id}`);
export const unirseConCodigo = (codigo: string) => pedir<{ establecimientoId: string }>('/api/establecimientos/unirse', { method: 'POST', body: JSON.stringify({ codigo }) });
export const obtenerEquipo = (id: string) => pedir<{ miembros: Miembro[] }>(`/api/establecimientos/${id}/equipo`);
export const modificarMiembro = (id: string, userId: string, config: ConfiguracionMiembro) => pedir<void>(`/api/establecimientos/${id}/equipo/${userId}`, { method: 'PATCH', body: JSON.stringify(config) });
export const expulsarMiembro = (id: string, userId: string) => pedir<void>(`/api/establecimientos/${id}/equipo/${userId}`, { method: 'DELETE' });
export const generarInvitacion = (id: string, config: ConfiguracionMiembro) => pedir<{ invitacion: { codigo: string; expiresAt: string } }>(`/api/establecimientos/${id}/invitaciones`, { method: 'POST', body: JSON.stringify(config) });
export const transferirPrincipal = (id: string, userId: string, confirmacion: string) => pedir<void>(`/api/establecimientos/${id}/transferir-principal`, { method: 'POST', body: JSON.stringify({ userId, confirmacion }) });
export const eliminarEstablecimiento = (id: string, confirmacion: string) => pedir<void>(`/api/establecimientos/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmacion }) });
