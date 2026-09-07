import { contexto } from '../autorizacion/membresia.js';
import { lecturasCompartidas } from '../services/lecturas-compartidas.js';
import { exigir } from '../autorizacion/reglas.js';
import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { estaContenido, esPolygonFeature, seSuperpone } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { obtenerEstadosDeLotes } from '../services/estado-lotes.js';
import { guardarFavorito } from '../services/lotes-favoritos.js';

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}
export async function obtenerLecturasCompartidas(req: Request, res: Response): Promise<void> {
  res.json(await lecturasCompartidas(contexto(req).establecimientoId));
}

function dto(row: { id: string; numero: number; apodo: string | null; polygon: unknown; activo: boolean; favorito?: boolean; created_at: Date; updated_at: Date }) {
  return { id: row.id, numero: row.numero, apodo: row.apodo, polygon: row.polygon, activo: row.activo, favorito: row.favorito ?? false, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function establecimientoPorId(id: string) {
  const result = await pool.query<{ id: string; polygon: unknown }>('SELECT id, polygon FROM establecimientos WHERE id = $1', [id]);
  if (!result.rows[0]) throw new ApiError(409, 'ESTABLISHMENT_REQUIRED', 'Primero tenés que crear un establecimiento.');
  return result.rows[0];
}

export async function obtenerEstadoLotes(req: Request, res: Response): Promise<void> {
  const incluirInactivosParam = req.query.incluirInactivos;
  if (incluirInactivosParam !== undefined && (typeof incluirInactivosParam !== 'string' || (incluirInactivosParam !== 'true' && incluirInactivosParam !== 'false'))) {
    throw new ApiError(400, 'INVALID_INCLUDE_INACTIVE', 'incluirInactivos debe ser true o false.');
  }
  const incluirInactivos = incluirInactivosParam === 'true';
  const establecimiento = await establecimientoPorId(contexto(req).establecimientoId);
  const condiciones = ['establecimiento_id = $1', 'deleted_at IS NULL'];
  if (!incluirInactivos) condiciones.push('activo = TRUE');
  const result = await pool.query<{ id: string }>(`SELECT id FROM lotes WHERE ${condiciones.join(' AND ')} ORDER BY numero ASC`, [establecimiento.id]);
  res.json({ lotes: await obtenerEstadosDeLotes(result.rows.map((lote) => lote.id)) });
}

export async function obtenerLotes(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  const establishment = await establecimientoPorId(contexto(req).establecimientoId);
  const result = await pool.query(`SELECT l.id, l.numero, l.apodo, l.polygon, l.activo, l.created_at, l.updated_at,
    EXISTS (SELECT 1 FROM lotes_favoritos f WHERE f.lote_id = l.id AND f.user_id = $2) AS favorito
    FROM lotes l WHERE l.establecimiento_id = $1 AND l.deleted_at IS NULL ORDER BY l.numero`, [establishment.id, id]);
  res.json({ lotes: result.rows.map(dto) });
}

export async function actualizarFavoritoLote(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  const favorito = (req.body as Record<string, unknown> | null)?.favorito;
  if (typeof favorito !== 'boolean') throw new ApiError(400, 'INVALID_FAVORITE_FLAG', 'favorito debe ser booleano.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    throw new ApiError(400, 'INVALID_LOT_ID', 'El ID de lote no es válido.');
  }
  await guardarFavorito(id, req.params.id, favorito, contexto(req).establecimientoId);
  res.json({ loteId: req.params.id, favorito });
}

export async function crearLote(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  const body = req.body as Record<string, unknown>;
  if (body?.origen === 'ia') exigir(contexto(req), 'usar_ia');
  if (!esPolygonFeature(body.polygon)) throw new ApiError(400, 'INVALID_POLYGON', 'El polygon debe ser un GeoJSON Feature<Polygon> válido.');
  const newPolygon = body.polygon;
  if (body.apodo !== undefined && body.apodo !== null && typeof body.apodo !== 'string') throw new ApiError(400, 'INVALID_NICKNAME', 'El apodo debe ser texto.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const establishment = await client.query<{ id: string; polygon: unknown }>('SELECT id, polygon FROM establecimientos WHERE id = $1 FOR UPDATE', [contexto(req).establecimientoId]);
    if (!establishment.rows[0]) throw new ApiError(409, 'ESTABLISHMENT_REQUIRED', 'Primero tenés que crear un establecimiento.');
    const parent = establishment.rows[0];
    if (!esPolygonFeature(parent.polygon) || !estaContenido(newPolygon, parent.polygon)) throw new ApiError(400, 'LOT_OUTSIDE_ESTABLISHMENT', 'El lote debe quedar completamente dentro del establecimiento.');
    const existing = await client.query<{ polygon: unknown }>('SELECT polygon FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL', [parent.id]);
    if (existing.rows.some((lot) => esPolygonFeature(lot.polygon) && seSuperpone(newPolygon, lot.polygon))) throw new ApiError(400, 'LOT_OVERLAPS_EXISTING', 'El lote se superpone con otro lote no eliminado.');
    const nextNumber = await client.query<{ next_number: number }>('SELECT COALESCE(MAX(numero), 0) + 1 AS next_number FROM lotes WHERE establecimiento_id = $1', [parent.id]);
    const result = await client.query('INSERT INTO lotes (establecimiento_id, numero, apodo, polygon) VALUES ($1, $2, $3, $4) RETURNING id, numero, apodo, polygon, activo, created_at, updated_at', [parent.id, nextNumber.rows[0].next_number, typeof body.apodo === 'string' ? body.apodo.trim() || null : null, newPolygon]);
    await client.query('UPDATE usuarios SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()), updated_at = NOW() WHERE id = $1', [id]);
    await client.query('UPDATE establecimientos SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()) WHERE id = $1', [parent.id]);
    await client.query('COMMIT');
    res.status(201).json({ lote: dto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function actualizarLote(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  const body = req.body as Record<string, unknown>;
  if (body.apodo !== undefined && body.apodo !== null && typeof body.apodo !== 'string') throw new ApiError(400, 'INVALID_NICKNAME', 'El apodo debe ser texto.');
  if (body.activo !== undefined && typeof body.activo !== 'boolean') throw new ApiError(400, 'INVALID_ACTIVE_FLAG', 'activo debe ser booleano.');
  if (body.polygon !== undefined && !esPolygonFeature(body.polygon)) throw new ApiError(400, 'INVALID_POLYGON', 'El polygon debe ser un GeoJSON Feature<Polygon> válido.');
  if (body.apodo === undefined && body.activo === undefined && body.polygon === undefined) throw new ApiError(400, 'EMPTY_UPDATE', 'No hay cambios para aplicar.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ id: string; numero: number; apodo: string | null; polygon: unknown; activo: boolean; created_at: Date; updated_at: Date; establecimiento_id: string }>(
      `SELECT l.id, l.numero, l.apodo, l.polygon, l.activo, l.created_at, l.updated_at, l.establecimiento_id
       FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
       WHERE l.id = $1 AND e.id = $2 AND l.deleted_at IS NULL FOR UPDATE`,
      [req.params.id, contexto(req).establecimientoId],
    );
    const lot = current.rows[0];
    if (!lot) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
    const nextPolygon = body.polygon === undefined ? lot.polygon : body.polygon;
    if (body.polygon !== undefined) {
      const newPolygon = body.polygon;
      const establishment = await client.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id = $1', [lot.establecimiento_id]);
      if (!esPolygonFeature(establishment.rows[0]?.polygon) || !estaContenido(newPolygon, establishment.rows[0].polygon)) throw new ApiError(400, 'LOT_OUTSIDE_ESTABLISHMENT', 'El lote debe quedar completamente dentro del establecimiento.');
      const otherLots = await client.query<{ polygon: unknown }>('SELECT polygon FROM lotes WHERE establecimiento_id = $1 AND id <> $2 AND deleted_at IS NULL', [lot.establecimiento_id, lot.id]);
      if (otherLots.rows.some((other) => esPolygonFeature(other.polygon) && seSuperpone(newPolygon, other.polygon))) throw new ApiError(400, 'LOT_OVERLAPS_EXISTING', 'El lote se superpone con otro lote no eliminado.');
    }
    const nextApodo = body.apodo === undefined ? lot.apodo : typeof body.apodo === 'string' ? body.apodo.trim() || null : null;
    const nextActivo = body.activo === undefined ? lot.activo : body.activo;
    const result = await client.query('UPDATE lotes SET apodo = $1, activo = $2, polygon = $3, updated_at = NOW() WHERE id = $4 RETURNING id, numero, apodo, polygon, activo, created_at, updated_at', [nextApodo, nextActivo, nextPolygon, lot.id]);
    const preferencia = await client.query<{ favorito: boolean }>('SELECT EXISTS (SELECT 1 FROM lotes_favoritos WHERE user_id = $1 AND lote_id = $2) AS favorito', [id, lot.id]);
    await client.query('COMMIT');
    res.json({ lote: dto({ ...result.rows[0], favorito: preferencia.rows[0].favorito }) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function eliminarLote(req: Request, res: Response): Promise<void> {
  const result = await pool.query(
    `UPDATE lotes l SET deleted_at = NOW(), updated_at = NOW()
     FROM establecimientos e
     WHERE l.establecimiento_id = e.id AND e.id = $1 AND l.id = $2 AND l.deleted_at IS NULL
     RETURNING l.id`,
    [contexto(req).establecimientoId, req.params.id],
  );
  if (!result.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  res.status(204).send();
}
