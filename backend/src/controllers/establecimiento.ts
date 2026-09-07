import { contexto, cargarMembresia } from '../autorizacion/membresia.js';
import { prohibido } from '../autorizacion/reglas.js';
import { transaccion, bloquearEstablecimiento } from '../services/equipo.js';
import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { estaContenido, esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

export async function listarEstablecimientos(req: Request, res: Response): Promise<void> {
  const result = await pool.query(`SELECT e.id, e.nombre, e.onboarding_completed_at, m.rol, m.permisos, m.capacidades,
    e.principal_user_id = m.user_id AS principal FROM establecimientos e JOIN membresias m ON m.establecimiento_id = e.id
    WHERE m.user_id = $1 ORDER BY e.created_at, e.id`, [userId(req)]);
  res.json({ establecimientos: result.rows.map(row => ({ id: row.id, nombre: row.nombre, onboardingCompleted: row.onboarding_completed_at !== null,
    membresia: { establecimientoId: row.id, userId: userId(req), rol: row.rol, principal: row.principal, permisos: row.permisos, capacidades: row.capacidades } })) });
}

export async function eliminarEstablecimiento(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  await transaccion(async db => {
    await bloquearEstablecimiento(db, actor.establecimientoId);
    if (!(await cargarMembresia(actor.establecimientoId, actor.userId, db)).principal) prohibido();
    const lotes = await db.query('SELECT 1 FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL LIMIT 1', [actor.establecimientoId]);
    if (lotes.rows.length) throw new ApiError(409, 'ESTABLISHMENT_HAS_LOTS', 'Eliminá primero todos los lotes, incluidos los inactivos.');
    throw new ApiError(501, 'ESTABLISHMENT_DELETION_PENDING', 'La estrategia de eliminación del establecimiento está pendiente de definición. No se modificaron datos.');
  });
  res.status(204).send();
}

function dto(row: { id: string; nombre: string; polygon: unknown; created_at: Date; updated_at: Date; onboarding_completed_at?: Date | null }) {
  return { id: row.id, nombre: row.nombre, polygon: row.polygon, createdAt: row.created_at, updatedAt: row.updated_at, onboardingCompleted: row.onboarding_completed_at != null };
}

export async function obtenerEstablecimiento(req: Request, res: Response): Promise<void> {
  const result = await pool.query('SELECT id, nombre, polygon, created_at, updated_at, onboarding_completed_at FROM establecimientos WHERE id = $1', [contexto(req).establecimientoId]);
  res.json({ establecimiento: result.rows[0] ? dto(result.rows[0]) : null, membresia: contexto(req) });
}

export async function crearEstablecimiento(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre) throw new ApiError(400, 'INVALID_NAME', 'El nombre del establecimiento es obligatorio.');
  if (!esPolygonFeature(body.polygon)) throw new ApiError(400, 'INVALID_POLYGON', 'El polygon debe ser un GeoJSON Feature<Polygon> válido.');
  const establecimiento = await transaccion(async db => {
    const result = await db.query('INSERT INTO establecimientos (user_id, principal_user_id, nombre, polygon) VALUES ($1, $1, $2, $3) RETURNING *', [userId(req), nombre, body.polygon]);
    await db.query("INSERT INTO membresias (establecimiento_id, user_id, rol) VALUES ($1,$2,'PROPIETARIO')", [result.rows[0].id, userId(req)]);
    return dto(result.rows[0]);
  });
  res.status(201).json({ establecimiento });
}

export async function actualizarEstablecimiento(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.nombre === undefined && body.polygon === undefined) throw new ApiError(400, 'EMPTY_UPDATE', 'No hay cambios para aplicar.');
  const id = contexto(req).establecimientoId;
  const current = await pool.query('SELECT id, nombre, polygon, created_at, updated_at, onboarding_completed_at FROM establecimientos WHERE id = $1', [id]);
  if (!current.rows[0]) throw new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Todavía no existe un establecimiento.');
  const nextName = body.nombre === undefined ? current.rows[0].nombre : typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const nextPolygon = body.polygon === undefined ? current.rows[0].polygon : body.polygon;
  if (!nextName) throw new ApiError(400, 'INVALID_NAME', 'El nombre del establecimiento es obligatorio.');
  if (!esPolygonFeature(nextPolygon)) throw new ApiError(400, 'INVALID_POLYGON', 'El polygon debe ser un GeoJSON Feature<Polygon> válido.');

  if (body.polygon !== undefined) {
    const lots = await pool.query<{ polygon: unknown }>(`SELECT polygon FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL`, [current.rows[0].id]);
    if (lots.rows.some((lot) => !esPolygonFeature(lot.polygon) || !estaContenido(lot.polygon, nextPolygon))) {
      throw new ApiError(400, 'ESTABLISHMENT_GEOMETRY_INVALID', 'El nuevo límite dejaría un lote fuera del establecimiento.');
    }
  }
  const result = await pool.query('UPDATE establecimientos SET nombre = $1, polygon = $2, updated_at = NOW() WHERE id = $3 RETURNING id, nombre, polygon, created_at, updated_at, onboarding_completed_at', [nextName, nextPolygon, current.rows[0].id]);
  res.json({ establecimiento: dto(result.rows[0]) });
}
