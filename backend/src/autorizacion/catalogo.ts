export const PERMISOS_ADMIN = {
  crear_lotes: ['Lotes', 'Crear lotes'],
  editar_lotes: ['Lotes', 'Editar información de lotes'],
  editar_geometria_lotes: ['Lotes', 'Editar límites de lotes'],
  activar_lotes: ['Lotes', 'Activar/desactivar lotes'],
  eliminar_lotes: ['Lotes', 'Eliminar lotes'],
  actualizar_satelite: ['Datos', 'Actualizar datos satelitales'],
  actualizar_clima: ['Datos', 'Actualizar clima'],
  registrar_usos: ['Pastoreo / usos', 'Registrar usos'],
  modificar_usos: ['Pastoreo / usos', 'Modificar/eliminar registros de uso'],
  usar_ia: ['IA', 'Usar subdivisión con IA'],
  renombrar_establecimiento: ['Establecimiento', 'Renombrar establecimiento'],
  editar_limite_establecimiento: ['Establecimiento', 'Editar límite del establecimiento'],
  invitar_visores: ['Equipo', 'Generar códigos de Visor'],
  invitar_administradores: ['Equipo', 'Generar códigos de Admin'],
  gestionar_visores: ['Equipo', 'Gestionar Visores'],
  gestionar_administradores: ['Equipo', 'Gestionar Administradores'],
  revocar_cualquier_permiso: ['Especiales', 'Revocar cualquier permiso'],
  otorgar_cualquier_permiso: ['Especiales', 'Otorgar cualquier permiso'],
  crear_admin_cualquier_permiso: ['Especiales', 'Crear administradores con cualquier permiso'],
} as const;

export const CAPACIDADES_PROPIETARIO = {
  crear_propietarios: 'Crear propietarios',
  eliminar_propietarios: 'Eliminar/degradar propietarios',
  modificar_propietarios: 'Modificar permisos de propietarios',
  protegido: 'Protegido contra expulsión',
  ignorar_proteccion: 'Ignorar protección de otros propietarios',
  poderes_principal: 'Poderes de Propietario principal',
} as const;

export type PermisoAdmin = keyof typeof PERMISOS_ADMIN;
export type CapacidadPropietario = keyof typeof CAPACIDADES_PROPIETARIO;
export type Rol = 'PROPIETARIO' | 'ADMINISTRADOR' | 'VISOR';
export interface Membresia {
  establecimientoId: string;
  userId: string;
  rol: Rol;
  principal: boolean;
  permisos: PermisoAdmin[];
  capacidades: CapacidadPropietario[];
}
export function puede(miembro: Membresia | null, permiso: PermisoAdmin): boolean {
  return !!miembro && (miembro.rol === 'PROPIETARIO' || (miembro.rol === 'ADMINISTRADOR' && miembro.permisos.includes(permiso)));
}
export function tieneCapacidad(miembro: Membresia, capacidad: CapacidadPropietario): boolean {
  return miembro.rol === 'PROPIETARIO' && (miembro.principal || miembro.capacidades.includes('poderes_principal') || miembro.capacidades.includes(capacidad));
}
