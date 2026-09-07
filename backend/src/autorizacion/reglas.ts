import { ApiError } from '../http/errors.js';
import { CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN, puede, tieneCapacidad, type Membresia, type Rol } from './catalogo.js';

export function prohibido(): never { throw new ApiError(403, 'FORBIDDEN', 'No tenés autorización para esta acción.'); }
export function exigir(actor: Membresia, permiso: keyof typeof PERMISOS_ADMIN): void { if (!puede(actor, permiso)) prohibido(); }

export function validarConfiguracion(body: unknown): Pick<Membresia, 'rol' | 'permisos' | 'capacidades'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_MEMBERSHIP', 'La configuración no es válida.');
  const { rol, permisos = [], capacidades = [] } = body as Record<string, unknown>;
  if (!['PROPIETARIO', 'ADMINISTRADOR', 'VISOR'].includes(String(rol)) ||
    !Array.isArray(permisos) || !Array.isArray(capacidades) ||
    permisos.some(p => typeof p !== 'string' || !Object.prototype.hasOwnProperty.call(PERMISOS_ADMIN, p)) ||
    capacidades.some(p => typeof p !== 'string' || !Object.prototype.hasOwnProperty.call(CAPACIDADES_PROPIETARIO, p)) ||
    (rol !== 'ADMINISTRADOR' && permisos.length > 0) || (rol !== 'PROPIETARIO' && capacidades.length > 0)) {
    throw new ApiError(400, 'INVALID_MEMBERSHIP', 'El rol y sus permisos no son válidos.');
  }
  if ((permisos.includes('revocar_cualquier_permiso') || permisos.includes('otorgar_cualquier_permiso')) && !permisos.includes('gestionar_administradores') ||
    permisos.includes('crear_admin_cualquier_permiso') && !permisos.includes('invitar_administradores')) {
    throw new ApiError(400, 'PERMISSION_DEPENDENCY', 'Los permisos especiales requieren su permiso de gestión o invitación.');
  }
  return { rol: rol as Rol, permisos: [...new Set(permisos)], capacidades: [...new Set(capacidades)] };
}

function validarCapacidades(actor: Membresia, anteriores: Membresia['capacidades'], siguientes: Membresia['capacidades']): void {
  for (const p of Object.keys(CAPACIDADES_PROPIETARIO) as Membresia['capacidades']) {
    if (anteriores.includes(p) === siguientes.includes(p)) continue;
    if (p === 'poderes_principal') { if (!actor.principal) prohibido(); }
    else if (p === 'protegido') { if (!actor.principal && !actor.capacidades.includes('poderes_principal')) prohibido(); }
    else if (!tieneCapacidad(actor, p)) prohibido();
  }
}

export function autorizarInvitacion(actor: Membresia, nueva: ReturnType<typeof validarConfiguracion>): void {
  if (nueva.rol === 'PROPIETARIO') {
    if (!tieneCapacidad(actor, 'crear_propietarios')) prohibido();
    validarCapacidades(actor, [], nueva.capacidades);
  } else if (nueva.rol === 'VISOR') exigir(actor, 'invitar_visores');
  else {
    exigir(actor, 'invitar_administradores');
    if (actor.rol === 'ADMINISTRADOR' && !actor.permisos.includes('crear_admin_cualquier_permiso') && nueva.permisos.some(p => !actor.permisos.includes(p))) prohibido();
  }
}

export function autorizarCambio(actor: Membresia, objetivo: Membresia, nueva: ReturnType<typeof validarConfiguracion> | null): void {
  if (actor.establecimientoId !== objetivo.establecimientoId || actor.userId === objetivo.userId || objetivo.principal || actor.rol === 'VISOR') prohibido();
  if (actor.rol === 'ADMINISTRADOR') {
    if (objetivo.rol === 'PROPIETARIO' || nueva?.rol === 'PROPIETARIO') prohibido();
    exigir(actor, objetivo.rol === 'VISOR' ? 'gestionar_visores' : 'gestionar_administradores');
    if (nueva?.rol === 'ADMINISTRADOR') exigir(actor, 'gestionar_administradores');
    const anteriores = objetivo.permisos;
    const siguientes = nueva?.permisos ?? [];
    if (anteriores.some(p => !siguientes.includes(p) && !actor.permisos.includes(p) && !actor.permisos.includes('revocar_cualquier_permiso'))) prohibido();
    if (siguientes.some(p => !anteriores.includes(p) && !actor.permisos.includes(p) && !actor.permisos.includes('otorgar_cualquier_permiso'))) prohibido();
    return;
  }
  if (objetivo.rol === 'PROPIETARIO') {
    if (nueva?.rol !== 'PROPIETARIO') {
      if (!tieneCapacidad(actor, 'eliminar_propietarios') || (objetivo.capacidades.includes('protegido') && !tieneCapacidad(actor, 'ignorar_proteccion'))) prohibido();
      // Degradar/expulsar no permite retirar indirectamente la autoridad reservada al principal.
      if (objetivo.capacidades.includes('poderes_principal') && !actor.principal) prohibido();
    } else {
      if (!tieneCapacidad(actor, 'modificar_propietarios')) prohibido();
      validarCapacidades(actor, objetivo.capacidades, nueva.capacidades);
    }
  } else if (nueva?.rol === 'PROPIETARIO') {
    if (!tieneCapacidad(actor, 'crear_propietarios')) prohibido();
    validarCapacidades(actor, [], nueva.capacidades);
  }
}
