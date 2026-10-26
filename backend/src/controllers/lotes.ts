import { contexto } from '../autorizacion/membresia.js';
import { lecturasCompartidas } from '../services/lecturas-compartidas.js';
import { exigir } from '../autorizacion/reglas.js';
import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { estaContenido, esPolygonFeature, mismaGeometria, seSuperpone } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import { obtenerEstadosDeLotes } from '../services/estado-lotes.js';
import { guardarFavorito } from '../services/lotes-favoritos.js';
import { registrarEventoAdministrativo } from '../services/notificaciones.js';
import { nombreAutorOperativo } from '../autorizacion/catalogo.js';
import { esTipoPastura } from '../estimacion/parametros.js';
import { esFechaCalendario, hoyCalendario } from '../fechas.js';
import { columnasPasturaDisponibles } from '../base-datos/columnas-pastura.js';
import { desasignarLoteInactivo } from '../services/alertas-gps.js';

function columnasLote(conPastura: boolean, prefijo = ''): string {
  const pastura = conPastura ? `${prefijo}tipo_pastura, ${prefijo}fecha_siembra` : 'NULL::text AS tipo_pastura, NULL::date AS fecha_siembra';
  return `${prefijo}id, ${prefijo}numero, ${prefijo}apodo, ${prefijo}polygon, ${prefijo}activo, ${pastura}, ${prefijo}created_at, ${prefijo}updated_at`;
}

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}
export async function obtenerLecturasCompartidas(req: Request, res: Response): Promise<void> {
  res.json(await lecturasCompartidas(contexto(req).establecimientoId));
}

function dto(row: { id: string; numero: number; apodo: string | null; polygon: unknown; activo: boolean; tipo_pastura: string | null; fecha_siembra: string | null; favorito?: boolean; created_at: Date; updated_at: Date }) {
  return { id: row.id, numero: row.numero, apodo: row.apodo, polygon: row.polygon, activo: row.activo, tipoPastura: row.tipo_pastura, fechaSiembra: row.fecha_siembra, favorito: row.favorito ?? false, createdAt: row.created_at, updatedAt: row.updated_at };
}

function validarPastura(body: Record<string, unknown>): void {
  if (body.tipoPastura !== undefined && body.tipoPastura !== null && !esTipoPastura(body.tipoPastura)) {
    throw new ApiError(400, 'INVALID_PASTURE_TYPE', 'El tipo de pastura no está soportado.');
  }
  if (body.fechaSiembra !== undefined && body.fechaSiembra !== null) {
    if (!esFechaCalendario(body.fechaSiembra)) throw new ApiError(400, 'INVALID_SOWING_DATE', 'La fecha de siembra debe tener formato YYYY-MM-DD.');
    if (body.fechaSiembra > hoyCalendario()) throw new ApiError(400, 'FUTURE_SOWING_DATE', 'La fecha de siembra no puede ser futura.');
  }
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
  const conPastura = await columnasPasturaDisponibles();
  const result = await pool.query(`SELECT ${columnasLote(conPastura, 'l.')},
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
  const conPastura = await columnasPasturaDisponibles();
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
    const result = await client.query(`INSERT INTO lotes (establecimiento_id, numero, apodo, polygon) VALUES ($1, $2, $3, $4) RETURNING ${columnasLote(conPastura)}`, [parent.id, nextNumber.rows[0].next_number, typeof body.apodo === 'string' ? body.apodo.trim() || null : null, newPolygon]);
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
  validarPastura(body);
  if (body.apodo === undefined && body.activo === undefined && body.polygon === undefined && body.tipoPastura === undefined && body.fechaSiembra === undefined) throw new ApiError(400, 'EMPTY_UPDATE', 'No hay cambios para aplicar.');
  const conPastura = await columnasPasturaDisponibles();
  if (!conPastura && (body.tipoPastura !== undefined || body.fechaSiembra !== undefined)) {
    throw new ApiError(503, 'PASTURE_MIGRATION_PENDING', 'La base de datos todavía no tiene la migración 015: no se puede guardar la pastura.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE', [contexto(req).establecimientoId]);
    const current = await client.query<{ id: string; numero: number; apodo: string | null; polygon: unknown; activo: boolean; tipo_pastura: string | null; fecha_siembra: string | null; created_at: Date; updated_at: Date; establecimiento_id: string }>(
      `SELECT ${columnasLote(conPastura, 'l.')}, l.establecimiento_id
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
    const changedGeometry = body.polygon !== undefined && esPolygonFeature(body.polygon) && (!esPolygonFeature(lot.polygon) || !mismaGeometria(lot.polygon, body.polygon));
    const nextTipoPastura = body.tipoPastura === undefined ? lot.tipo_pastura : body.tipoPastura;
    const nextFechaSiembra = body.fechaSiembra === undefined ? lot.fecha_siembra : body.fechaSiembra;
    const result = conPastura
      ? await client.query(
        `UPDATE lotes SET apodo = $1, activo = $2, polygon = $3, tipo_pastura = $4, fecha_siembra = $5, updated_at = NOW() WHERE id = $6 RETURNING ${columnasLote(true)}`,
        [nextApodo, nextActivo, nextPolygon, nextTipoPastura, nextFechaSiembra, lot.id],
      )
      : await client.query(
        `UPDATE lotes SET apodo = $1, activo = $2, polygon = $3, updated_at = NOW() WHERE id = $4 RETURNING ${columnasLote(false)}`,
        [nextApodo, nextActivo, nextPolygon, lot.id],
      );
    if (lot.activo && !nextActivo) await desasignarLoteInactivo(client, lot.establecimiento_id, lot.id);
    if (changedGeometry) {
      const actor = contexto(req);
      await registrarEventoAdministrativo(client, {
        establecimientoId: lot.establecimiento_id, tipo: 'limite_lote_modificado', actorId: id,
        actorPuestoId: actor.puestoOperativoId,
        loteId: lot.id, titulo: `Límites del lote ${lot.numero} modificados`,
        tituloAgrupado: 'Límites de lotes modificados',
        mensaje: `${nombreAutorOperativo(actor)} modificó los límites del lote ${lot.numero}.`,
        detalles: { numeroLote: lot.numero, apodo: nextApodo },
        permisoDestinatario: 'editar_geometria_lotes', excluirAutor: true,
      });
    }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** No llama a servicios externos: el tope sólo acota el pedido, y alcanza para establecimientos grandes. */
export const MAXIMO_LOTES_PASTURA = 500;

/**
 * La misma pastura para varios lotes del establecimiento, en una sola
 * transacción: se guardan todos o ninguno. Mismas validaciones y permiso que
 * el PATCH de un lote.
 */
export async function asignarPasturaLotes(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = body.loteIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAXIMO_LOTES_PASTURA || ids.some((loteId) => typeof loteId !== 'string' || !UUID.test(loteId))) {
    throw new ApiError(400, 'INVALID_LOT_IDS', `loteIds debe ser un arreglo de 1 a ${MAXIMO_LOTES_PASTURA} IDs válidos.`);
  }
  if (!esTipoPastura(body.tipoPastura)) throw new ApiError(400, 'INVALID_PASTURE_TYPE', 'El tipo de pastura no está soportado.');
  if (!await columnasPasturaDisponibles()) {
    throw new ApiError(503, 'PASTURE_MIGRATION_PENDING', 'La base de datos todavía no tiene la migración 015: no se puede guardar la pastura.');
  }
  const unicos = [...new Set(ids as string[])];
  const establecimientoId = contexto(req).establecimientoId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE', [establecimientoId]);
    const result = await client.query(
      `UPDATE lotes SET tipo_pastura = $1, updated_at = NOW()
        WHERE establecimiento_id = $2 AND id = ANY($3::uuid[]) AND deleted_at IS NULL
        RETURNING ${columnasLote(true)}`,
      [body.tipoPastura, establecimientoId, unicos],
    );
    // Un lote ajeno o eliminado deshace todo: no se guarda una parte del pedido.
    if (result.rows.length !== unicos.length) throw new ApiError(404, 'LOT_NOT_FOUND', 'Algún lote no existe en este establecimiento.');
    const favoritos = await client.query<{ lote_id: string }>('SELECT lote_id FROM lotes_favoritos WHERE user_id = $1 AND lote_id = ANY($2::uuid[])', [id, unicos]);
    await client.query('COMMIT');
    const deFavorito = new Set(favoritos.rows.map((fila) => fila.lote_id));
    const lotes = result.rows
      .map((fila) => dto({ ...fila, favorito: deFavorito.has(fila.id) }))
      .sort((a, b) => a.numero - b.numero);
    res.json({ lotes });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function eliminarLote(req: Request, res: Response): Promise<void> {
  const eid = contexto(req).establecimientoId;
  const actorId = userId(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE', [eid]);
    const result = await client.query<{ id: string; numero: number; apodo: string | null }>(
      `UPDATE lotes SET deleted_at = NOW(), updated_at = NOW()
       WHERE establecimiento_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id, numero, apodo`, [eid, req.params.id],
    );
    const lote = result.rows[0];
    if (!lote) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
    await desasignarLoteInactivo(client, eid, lote.id);
    const actor = contexto(req);
    await registrarEventoAdministrativo(client, {
      establecimientoId: eid, tipo: 'lote_eliminado', actorId, loteId: lote.id,
      actorPuestoId: actor.puestoOperativoId,
      titulo: `Lote ${lote.numero} eliminado`,
      tituloAgrupado: 'Eliminación de lotes',
      mensaje: `${nombreAutorOperativo(actor)} eliminó el lote ${lote.numero} del establecimiento.`,
      detalles: { referenciaLote: { numero: lote.numero, apodo: lote.apodo } },
      permisoDestinatario: 'eliminar_lotes', excluirAutor: true,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.status(204).send();
}
