import type { PoolClient } from 'pg';
import type { Request, Response } from 'express';
import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { contexto } from '../autorizacion/membresia.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { esPolygonFeature, puntoEnPoligono } from '../geometria.js';
import { puntoInicial, UMBRALES_BATERIA_GPS, validarNumero } from '../services/gps-simulados.js';
import { evaluarBateria, evaluarConexion, evaluarLimiteEstablecimiento, evaluarLoteAsignado, notificarCambioLote } from '../services/alertas-gps.js';

interface Fila {
  id: string; numero: 1 | 2; apodo: string; latitud: number; longitud: number;
  bateria_porcentaje: number; conexion: 'en-linea' | 'sin-senal'; updated_at: Date; lote_asignado_id: string | null;
}
interface Lote { id: string; numero: number; apodo: string | null; polygon: unknown }
interface Incidencia { tipo: string; clave: string }
const CLAVE = (userId: string, dispositivoId: string) => `gps:${userId}:${dispositivoId}`;
const condicionBateria = (p: number): 'normal' | 'baja' | 'critica' => p <= UMBRALES_BATERIA_GPS.critica ? 'critica' : p <= UMBRALES_BATERIA_GPS.baja ? 'baja' : 'normal';
const puntoEnLote = (lat: number, lng: number, lots: Lote[]) => lots.find(l => esPolygonFeature(l.polygon) && puntoEnPoligono(lat, lng, l.polygon)) ?? null;
const contiene = (lat: number, lng: number, polygon: unknown) => esPolygonFeature(polygon)
  && turf.booleanPointInPolygon(turf.point([lng, lat]), polygon as Feature<Polygon>);

function dto(r: Fila, polygon: unknown, lotes: Lote[], incidencias: Incidencia[], userId: string) {
  const loteActual = puntoEnLote(r.latitud, r.longitud, lotes);
  const loteAsignado = lotes.find(l => l.id === r.lote_asignado_id) ?? null;
  const clave = CLAVE(userId, r.id);
  const activas = incidencias.filter(i => i.clave === clave).map(i => i.tipo);
  return {
    id: r.id, numero: r.numero, identificadorEquipo: r.id, apodo: r.apodo,
    latitud: r.latitud, longitud: r.longitud, bateriaPorcentaje: r.bateria_porcentaje,
    condicionBateria: condicionBateria(r.bateria_porcentaje), conexion: r.conexion,
    actualizadaEn: r.updated_at, ultimaSenal: null,
    ubicacion: { latitud: r.latitud, longitud: r.longitud, precisionMetros: null },
    loteId: loteActual?.id ?? null, numeroLote: loteActual?.numero ?? null, animalId: null,
    loteActual: loteActual ? { id: loteActual.id, numero: loteActual.numero, apodo: loteActual.apodo } : null,
    loteAsignado: loteAsignado ? { id: loteAsignado.id, numero: loteAsignado.numero, apodo: loteAsignado.apodo } : null,
    dentroEstablecimiento: contiene(r.latitud, r.longitud, polygon), incidenciasActivas: activas,
  };
}

async function lotesActivos(db: PoolClient, establecimientoId: string): Promise<Lote[]> {
  const result = await db.query<Lote>(`SELECT id,numero,apodo,polygon FROM lotes
    WHERE establecimiento_id=$1 AND deleted_at IS NULL AND activo ORDER BY numero`, [establecimientoId]);
  return result.rows;
}

async function leerIncidencias(db: PoolClient, establecimientoId: string, userId: string): Promise<Incidencia[]> {
  const result = await db.query<Incidencia>(`SELECT tipo,clave FROM incidencias_establecimiento
    WHERE establecimiento_id=$1 AND estado='activa' AND clave LIKE $2`, [establecimientoId, `gps:${userId}:%`]);
  return result.rows;
}

async function contextoAlerta(db: PoolClient, row: Fila, establecimientoId: string, userId: string) {
  const polygon = await db.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id=$1', [establecimientoId]);
  if (!esPolygonFeature(polygon.rows[0]?.polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'Geometría del establecimiento inválida.');
  const lots = await lotesActivos(db, establecimientoId);
  const asignado = lots.find(l => l.id === row.lote_asignado_id) ?? null;
  return { polygon: polygon.rows[0].polygon, lots, asignado,
    alerta: { establecimientoId, userId, dispositivoId: row.id, numero: row.numero, apodo: row.apodo } as const };
}

export async function listarGpsSimulados(req: Request, res: Response): Promise<void> {
  const m = contexto(req);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const e = await db.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id=$1 FOR UPDATE', [m.establecimientoId]);
    if (!esPolygonFeature(e.rows[0]?.polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'Geometría del establecimiento inválida.');
    const existentes = await db.query<Fila>('SELECT * FROM gps_simulados WHERE establecimiento_id=$1 AND user_id=$2 ORDER BY numero FOR UPDATE', [m.establecimientoId, m.userId]);
    const posiciones: Array<[number, number]> = existentes.rows.map(r => [r.longitud, r.latitud]);
    for (const numero of [1, 2] as const) if (!existentes.rows.some(r => r.numero === numero)) {
      const xy = puntoInicial(e.rows[0].polygon as Feature<Polygon>, posiciones[0]);
      const bateria = 25 + Math.floor(Math.random() * 76);
      await db.query(`INSERT INTO gps_simulados(establecimiento_id,user_id,numero,apodo,latitud,longitud,bateria_porcentaje)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(establecimiento_id,user_id,numero) DO NOTHING`,
        [m.establecimientoId, m.userId, numero, `GPS simulado ${numero}`, xy[1], xy[0], bateria]);
      posiciones.push(xy);
    }
    const rows = await db.query<Fila>('SELECT * FROM gps_simulados WHERE establecimiento_id=$1 AND user_id=$2 ORDER BY numero', [m.establecimientoId, m.userId]);
    const lotes = await lotesActivos(db, m.establecimientoId);
    const incidencias = await leerIncidencias(db, m.establecimientoId, m.userId);
    await db.query('COMMIT');
    res.json({ dispositivos: rows.rows.map(r => dto(r, e.rows[0].polygon, lotes, incidencias, m.userId)) });
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function actualizarGpsSimulado(req: Request, res: Response): Promise<void> {
  const m = contexto(req);
  const id = req.params.dispositivoId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const campos: string[] = []; const values: unknown[] = [];
  if (Object.hasOwn(body, 'bateriaPorcentaje')) { values.push(validarNumero(body.bateriaPorcentaje, 'La batería')); campos.push(`bateria_porcentaje=$${values.length}`); }
  if (Object.hasOwn(body, 'apodo')) {
    if (typeof body.apodo !== 'string' || body.apodo.trim().length < 1 || body.apodo.trim().length > 60) throw new ApiError(400, 'INVALID_GPS_NICKNAME', 'El apodo debe tener entre 1 y 60 caracteres.');
    values.push(body.apodo.trim()); campos.push(`apodo=$${values.length}`);
  }
  if (Object.hasOwn(body, 'conexion')) {
    if (body.conexion !== 'en-linea' && body.conexion !== 'sin-senal') throw new ApiError(400, 'INVALID_GPS_CONNECTION', 'Estado de conexión simulado inválido.');
    values.push(body.conexion); campos.push(`conexion=$${values.length}`);
  }
  const mueve = Object.hasOwn(body, 'latitud') || Object.hasOwn(body, 'longitud');
  if (mueve) {
    if (typeof body.latitud !== 'number' || !Number.isFinite(body.latitud) || body.latitud < -90 || body.latitud > 90 ||
        typeof body.longitud !== 'number' || !Number.isFinite(body.longitud) || body.longitud < -180 || body.longitud > 180) {
      throw new ApiError(400, 'INVALID_GPS_POSITION', 'Latitud o longitud inválida.');
    }
    values.push(body.latitud); campos.push(`latitud=$${values.length}`);
    values.push(body.longitud); campos.push(`longitud=$${values.length}`);
  }
  const cambiaAsignacion = Object.hasOwn(body, 'loteAsignadoId');
  if (cambiaAsignacion && body.loteAsignadoId !== null && (typeof body.loteAsignadoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.loteAsignadoId))) {
    throw new ApiError(400, 'INVALID_ASSIGNED_LOT', 'El lote asignado no es válido.');
  }
  if (cambiaAsignacion) { values.push(body.loteAsignadoId); campos.push(`lote_asignado_id=$${values.length}`); }
  if (!campos.length) throw new ApiError(400, 'EMPTY_GPS_UPDATE', 'Indicá al menos un dato para actualizar.');
  values.push(m.establecimientoId); const eidx = values.length; values.push(m.userId); const uidx = values.length; values.push(id); const didx = values.length;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const establishment = await db.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id=$1 FOR UPDATE', [m.establecimientoId]);
    if (!esPolygonFeature(establishment.rows[0]?.polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'Geometría del establecimiento inválida.');
    const previous = await db.query<Fila>(`SELECT * FROM gps_simulados WHERE establecimiento_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE`, [m.establecimientoId, m.userId, id]);
    const old = previous.rows[0];
    if (!old) throw new ApiError(404, 'GPS_SIMULATED_NOT_FOUND', 'Dispositivo no disponible.');
    if (cambiaAsignacion && body.loteAsignadoId !== null) {
      const validLot = await db.query('SELECT 1 FROM lotes WHERE id=$1 AND establecimiento_id=$2 AND activo AND deleted_at IS NULL', [body.loteAsignadoId, m.establecimientoId]);
      if (!validLot.rows.length) throw new ApiError(404, 'ASSIGNED_LOT_NOT_FOUND', 'El lote activo no existe en este establecimiento.');
    }
    const result = await db.query<Fila>(`UPDATE gps_simulados SET ${campos.join(',')},updated_at=NOW()
      WHERE establecimiento_id=$${eidx} AND user_id=$${uidx} AND id=$${didx} RETURNING *`, values);
    const actual = result.rows[0];
    const gps = { establecimientoId: m.establecimientoId, userId: m.userId, dispositivoId: actual.id, numero: actual.numero, apodo: actual.apodo };
    const al = await contextoAlerta(db, actual, m.establecimientoId, m.userId);
    const posicionCambio = old.latitud !== actual.latitud || old.longitud !== actual.longitud;
    const bateriaCambio = old.bateria_porcentaje !== actual.bateria_porcentaje;
    const conexionCambio = old.conexion !== actual.conexion;
    const asignacionCambio = old.lote_asignado_id !== actual.lote_asignado_id;
    if (bateriaCambio) await evaluarBateria(db, gps, actual.bateria_porcentaje);
    if (conexionCambio) await evaluarConexion(db, gps, actual.conexion);
    if (posicionCambio) {
      const dentro = contiene(actual.latitud, actual.longitud, al.polygon);
      await evaluarLimiteEstablecimiento(db, gps, dentro);
    }
    if (posicionCambio || asignacionCambio) {
      const assigned = al.asignado;
      const dentroAsignado = assigned ? contiene(actual.latitud, actual.longitud, assigned.polygon) : true;
      await evaluarLoteAsignado(db, gps, assigned, dentroAsignado);
    }
    if (posicionCambio) {
      const beforeLot = puntoEnLote(old.latitud, old.longitud, al.lots);
      const afterLot = puntoEnLote(actual.latitud, actual.longitud, al.lots);
      if (beforeLot && afterLot && beforeLot.id !== afterLot.id) await notificarCambioLote(db, gps, beforeLot, afterLot);
    }
    const incidencias = await leerIncidencias(db, m.establecimientoId, m.userId);
    await db.query('COMMIT');
    res.json({ dispositivo: dto(actual, al.polygon, al.lots, incidencias, m.userId) });
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
