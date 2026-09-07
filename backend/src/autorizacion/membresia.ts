import type { Request, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import type { Membresia, PermisoAdmin } from './catalogo.js';
import { exigir } from './reglas.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function cargarMembresia(establecimientoId: string, userId: string, db: Pick<PoolClient, 'query'> = pool): Promise<Membresia> {
  const result = await db.query(`SELECT m.rol, m.permisos, m.capacidades, e.principal_user_id = m.user_id AS principal
    FROM membresias m JOIN establecimientos e ON e.id = m.establecimiento_id
    WHERE m.establecimiento_id = $1 AND m.user_id = $2`, [establecimientoId, userId]);
  if (!result.rows[0]) throw new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Establecimiento no disponible.');
  return { establecimientoId, userId, ...result.rows[0] };
}
export const requiereMembresia: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
    if (!UUID.test(req.params.establecimientoId ?? '')) throw new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Establecimiento no disponible.');
    req.membresia = await cargarMembresia(req.params.establecimientoId, req.usuario.id);
    next();
  } catch (error) { next(error); }
};
export function contexto(req: Request): Membresia {
  if (!req.membresia) throw new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Falta el contexto del establecimiento.');
  return req.membresia;
}
export function requierePermisos(...permisos: PermisoAdmin[]): RequestHandler {
  return (req, _res, next) => { try { for (const p of permisos) exigir(contexto(req), p); next(); } catch (error) { next(error); } };
}
export function requiereCampos(campos: Record<string, PermisoAdmin>): RequestHandler {
  return (req, _res, next) => {
    try { for (const [campo, permiso] of Object.entries(campos)) if (req.body && Object.hasOwn(req.body, campo)) exigir(contexto(req), permiso); next(); }
    catch (error) { next(error); }
  };
}
