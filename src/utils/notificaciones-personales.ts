import type { EstablecimientoResumen } from '../api/establecimientos';
import type { NotificacionPersonal } from '../api/notificaciones';

export interface GrupoEstablecimiento extends Omit<EstablecimientoResumen, 'membresia'> {
  membresias: EstablecimientoResumen['membresia'][];
}

export function agruparEstablecimientos(items: EstablecimientoResumen[]): GrupoEstablecimiento[] {
  const grupos = new Map<string, GrupoEstablecimiento>();
  for (const item of items) {
    const grupo = grupos.get(item.id);
    if (!grupo) {
      grupos.set(item.id, { id: item.id, nombre: item.nombre,
        onboardingCompleted: item.onboardingCompleted, membresias: [item.membresia] });
    } else if (!grupo.membresias.some((membresia) => membresia.puestoOperativoId === item.membresia.puestoOperativoId)) {
      grupo.membresias.push(item.membresia);
    }
  }
  return [...grupos.values()];
}

export function agruparAvisosPersonales(
  avisos: NotificacionPersonal[], establecimientosVisibles: ReadonlySet<string>,
): { visibles: Map<string, NotificacionPersonal[]>; sinAcceso: Map<string, NotificacionPersonal[]> } {
  const unicos = new Map<string, NotificacionPersonal>();
  for (const aviso of avisos) {
    if (!unicos.has(aviso.id)) unicos.set(aviso.id, aviso);
  }
  const ordenados = [...unicos.values()].sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const visibles = new Map<string, NotificacionPersonal[]>();
  const sinAcceso = new Map<string, NotificacionPersonal[]>();
  for (const aviso of ordenados) {
    const grupos = establecimientosVisibles.has(aviso.establecimientoId) ? visibles : sinAcceso;
    const existentes = grupos.get(aviso.establecimientoId) ?? [];
    existentes.push(aviso);
    grupos.set(aviso.establecimientoId, existentes);
  }
  return { visibles, sinAcceso };
}
