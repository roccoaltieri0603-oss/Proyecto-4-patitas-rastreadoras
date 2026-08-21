import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { estaContenido, esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

function dto(row: { id: string; nombre: string; polygon: unknown; created_at: Date; updated_at: Date }) {
  return { id: row.id, nombre: row.nombre, polygon: row.polygon, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function obtenerEstablecimiento(req: Request, res: Response): Promise<void> {
  const result = await pool.query('SELECT id, nombre, polygon, created_at, updated_at FROM establecimientos WHERE user_id = $1', [userId(req)]);
  res.json({ establecimiento: result.rows[0] ? dto(result.rows[0]) : null });
}

export async function crearEstablecimiento(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre) throw new ApiError(400, 'INVALID_NAME', 'El nombre del establecimiento es obligatorio.');
  if (!esPolygonFeature(body.polygon)) throw new ApiError(400, 'INVALID_POLYGON', 'El polygon debe ser un GeoJSON Feature<Polygon> válido.');
  try {
    const result = await pool.query('INSERT INTO establecimientos (user_id, nombre, polygon) VALUES ($1, $2, $3) RETURNING id, nombre, polygon, created_at, updated_at', [userId(req), nombre, body.polygon]);
    res.status(201).json({ establecimiento: dto(result.rows[0]) });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ESTABLISHMENT_EXISTS', 'El usuario ya tiene un establecimiento.');
    throw error;
  }
}

export async function actualizarEstablecimiento(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const id = userId(req);
  const current = await pool.query('SELECT id, nombre, polygon, created_at, updated_at FROM establecimientos WHERE user_id = $1', [id]);
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
  const result = await pool.query('UPDATE establecimientos SET nombre = $1, polygon = $2, updated_at = NOW() WHERE id = $3 RETURNING id, nombre, polygon, created_at, updated_at', [nextName, nextPolygon, current.rows[0].id]);
  res.json({ establecimiento: dto(result.rows[0]) });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
