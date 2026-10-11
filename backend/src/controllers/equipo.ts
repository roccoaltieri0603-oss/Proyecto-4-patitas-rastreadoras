import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { contexto, UUID } from '../autorizacion/membresia.js';
import type { Rol } from '../autorizacion/catalogo.js';
import {
  aceptarInvitacionPuesto, cambiarPermisosPuesto, cambiarRolIntegrante,
  crearPuestoAdministrador, designarResponsableGpsPuesto, expulsarIntegrante,
  generarInvitacionPuesto, listarEquipoOperativo, transferirPrincipalPuesto,
} from '../services/puestos.js';
import { ApiError } from '../http/errors.js';

export async function obtenerEquipo(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  if (actor.rol !== 'PROPIETARIO' &&
      !actor.permisos.includes('gestionar_administradores') &&
      !actor.permisos.includes('gestionar_visores') &&
      !actor.permisos.includes('invitar_administradores') &&
      !actor.permisos.includes('invitar_visores')) {
    throw new ApiError(403, 'FORBIDDEN', 'No tenés autorización para ver el equipo.');
  }
  const equipo = await listarEquipoOperativo(actor.establecimientoId);
  res.json(actor.rol === 'PROPIETARIO' ? equipo : { ...equipo,
    puestos: equipo.puestos.map(puesto => ({ ...puesto,
      propietario_user_id: null, legacy_user_id: null,
      integrantes: puesto.rol === 'ADMINISTRADOR' && actor.permisos.includes('gestionar_administradores') ||
        puesto.rol === 'VISOR' && actor.permisos.includes('gestionar_visores') ? puesto.integrantes : [],
    })) });
}

async function puestoDeMiembro(req: Request): Promise<{ id: string; rol: Rol }> {
  const actor = contexto(req);
  const userId = req.params.userId;
  if (!UUID.test(userId)) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Integrante no disponible.');
  const result = await pool.query<{ id: string; rol: Rol }>(
    `SELECT p.id, p.rol FROM puestos_operativos p WHERE p.establecimiento_id = $1 AND p.activo
       AND (p.propietario_user_id = $2 OR EXISTS (
         SELECT 1 FROM integrantes_puesto i WHERE i.puesto_operativo_id = p.id AND i.user_id = $2))`,
    [actor.establecimientoId, userId],
  );
  const elegido = req.body?.puestoOperativoId ?? req.query.puestoOperativoId;
  const fila = elegido ? result.rows.find((p) => p.id === elegido) : result.rows.length === 1 ? result.rows[0] : null;
  if (!fila) throw new ApiError(409, 'POST_SELECTION_REQUIRED', 'Elegí el puesto concreto del integrante.');
  return fila;
}

export async function crearPuesto(req: Request, res: Response): Promise<void> {
  const id = await crearPuestoAdministrador(contexto(req), req.body);
  res.status(201).json({ puestoOperativoId: id });
}
export async function actualizarPuesto(req: Request, res: Response): Promise<void> {
  if (req.body?.confirmarPuestoCompleto !== true) {
    throw new ApiError(409, 'POST_WIDE_CONFIRMATION_REQUIRED', 'Este cambio afecta a todos los integrantes del puesto. Confirmalo expresamente.');
  }
  await cambiarPermisosPuesto(contexto(req), req.params.puestoId, req.body);
  res.status(204).send();
}
export async function cambiarRol(req: Request, res: Response): Promise<void> {
  const puestoOperativoId = await cambiarRolIntegrante(contexto(req), req.params.puestoId, req.params.userId, req.body?.rol);
  res.json({ puestoOperativoId });
}
export async function expulsarDePuesto(req: Request, res: Response): Promise<void> {
  await expulsarIntegrante(contexto(req), req.params.puestoId, req.params.userId);
  res.status(204).send();
}
export async function modificarMiembro(req: Request, res: Response): Promise<void> {
  const origen = await puestoDeMiembro(req);
  const rol = req.body?.rol as Rol | undefined;
  if (rol && rol !== origen.rol) {
    await cambiarRolIntegrante(contexto(req), origen.id, req.params.userId, rol);
  } else {
    if (origen.rol !== 'PROPIETARIO' && req.body?.confirmarPuestoCompleto !== true) {
      throw new ApiError(409, 'POST_WIDE_CONFIRMATION_REQUIRED', 'Este cambio afecta a todos los integrantes del puesto. Confirmalo expresamente.');
    }
    await cambiarPermisosPuesto(contexto(req), origen.id, req.body);
  }
  res.status(204).send();
}
export async function expulsarMiembro(req: Request, res: Response): Promise<void> {
  const origen = await puestoDeMiembro(req);
  await expulsarIntegrante(contexto(req), origen.id, req.params.userId);
  res.status(204).send();
}
export async function generarInvitacion(req: Request, res: Response): Promise<void> {
  res.status(201).json({ invitacion: await generarInvitacionPuesto(contexto(req), req.body) });
}
export async function unirse(req: Request, res: Response): Promise<void> {
  res.status(201).json(await aceptarInvitacionPuesto(req.usuario!.id, req.body?.codigo, req.body?.establecimientoId));
}
export async function transferir(req: Request, res: Response): Promise<void> {
  if (req.body?.confirmacion !== 'TRANSFERIR') throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirmá la transferencia escribiendo TRANSFERIR.');
  await transferirPrincipalPuesto(contexto(req), String(req.body?.userId ?? ''));
  res.status(204).send();
}

export async function actualizarResponsableGps(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  if (!req.body || typeof req.body !== 'object' || !Object.hasOwn(req.body, 'puestoOperativoId')) {
    throw new ApiError(400, 'INVALID_GPS_ADMIN', 'Enviá puestoOperativoId o null para quitar la designación.');
  }
  const id = req.body.puestoOperativoId;
  if (id !== null && (typeof id !== 'string' || !UUID.test(id))) {
    throw new ApiError(400, 'INVALID_GPS_ADMIN', 'El ID del puesto responsable no es válido.');
  }
  await designarResponsableGpsPuesto(actor, id);
  res.status(204).send();
}
