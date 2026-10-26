import type { Request, Response } from 'express';
import { contexto } from '../autorizacion/membresia.js';
import { prohibido } from '../autorizacion/reglas.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { esPolygonFeature, puntoEnPoligono } from '../geometria.js';
import { puntoInicial, validarNumero } from '../services/gps-simulados.js';

type Fila = { id: string; numero: 1 | 2; apodo: string; latitud: number; longitud: number; bateria_porcentaje: number; conexion: 'en-linea' | 'sin-senal'; updated_at: Date };
const dto = (r: Fila) => ({ id: r.id, numero: r.numero, identificadorEquipo: r.id, apodo: r.apodo, latitud: r.latitud, longitud: r.longitud, bateriaPorcentaje: r.bateria_porcentaje, conexion: r.conexion, actualizadaEn: r.updated_at, ultimaSenal: null, ubicacion: { latitud: r.latitud, longitud: r.longitud, precisionMetros: null }, loteId: null, numeroLote: null, animalId: null });
export async function listarGpsSimulados(req: Request, res: Response): Promise<void> {
  const m = contexto(req); if (m.rol === 'VISOR') prohibido();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const e = await db.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id=$1 FOR UPDATE', [m.establecimientoId]);
    if (!esPolygonFeature(e.rows[0]?.polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'Geometría del establecimiento inválida.');
    const existentes = await db.query<Fila>('SELECT * FROM gps_simulados WHERE establecimiento_id=$1 AND user_id=$2 ORDER BY numero', [m.establecimientoId, m.userId]);
    const posiciones: Array<[number, number]> = existentes.rows.map((r) => [r.longitud, r.latitud]);
    for (const numero of [1, 2] as const) if (!existentes.rows.some((r) => r.numero === numero)) {
      const xy = puntoInicial(e.rows[0].polygon, posiciones[0]);
      const bateria = 25 + Math.floor(Math.random() * 76);
      await db.query(`INSERT INTO gps_simulados(establecimiento_id,user_id,numero,apodo,latitud,longitud,bateria_porcentaje)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(establecimiento_id,user_id,numero) DO NOTHING`,
        [m.establecimientoId, m.userId, numero, `GPS simulado ${numero}`, xy[1], xy[0], bateria]);
      posiciones.push(xy);
    }
    const result = await db.query<Fila>('SELECT * FROM gps_simulados WHERE establecimiento_id=$1 AND user_id=$2 ORDER BY numero', [m.establecimientoId, m.userId]);
    await db.query('COMMIT'); res.json({ dispositivos: result.rows.map(dto) });
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
export async function actualizarGpsSimulado(req: Request, res: Response): Promise<void> {
  const m = contexto(req); if (m.rol === 'VISOR') prohibido();
  const id = req.params.dispositivoId;
  const body = req.body as Record<string, unknown>;
  const cambios: string[] = []; const valores: unknown[] = [];
  if (Object.hasOwn(body, 'bateriaPorcentaje')) { valores.push(validarNumero(body.bateriaPorcentaje, 'La batería')); cambios.push(`bateria_porcentaje=$${valores.length}`); }
  if (Object.hasOwn(body, 'apodo')) {
    if (typeof body.apodo !== 'string' || body.apodo.trim().length < 1 || body.apodo.trim().length > 60) throw new ApiError(400, 'INVALID_GPS_NICKNAME', 'El apodo debe tener entre 1 y 60 caracteres.');
    valores.push(body.apodo.trim()); cambios.push(`apodo=$${valores.length}`);
  }
  if (Object.hasOwn(body, 'conexion')) {
    if (body.conexion !== 'en-linea' && body.conexion !== 'sin-senal') throw new ApiError(400, 'INVALID_GPS_CONNECTION', 'Estado de conexión simulado inválido.');
    valores.push(body.conexion); cambios.push(`conexion=$${valores.length}`);
  }
  const mueve = Object.hasOwn(body, 'latitud') || Object.hasOwn(body, 'longitud');
  if (mueve) {
    const lat = body.latitud, lng = body.longitud;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 || typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new ApiError(400, 'INVALID_GPS_POSITION', 'Latitud o longitud inválida.');
    valores.push(lat); cambios.push(`latitud=$${valores.length}`); valores.push(lng); cambios.push(`longitud=$${valores.length}`);
  }
  if (!cambios.length) throw new ApiError(400, 'EMPTY_GPS_UPDATE', 'Indicá al menos un dato para actualizar.');
  valores.push(m.establecimientoId); const eid = valores.length; valores.push(m.userId); const uid = valores.length; valores.push(id); const did = valores.length;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (mueve) {
      const geo = await db.query<{ polygon: unknown }>('SELECT polygon FROM establecimientos WHERE id=$1 FOR UPDATE', [m.establecimientoId]);
      const lat = body.latitud as number, lng = body.longitud as number;
      if (!esPolygonFeature(geo.rows[0]?.polygon) || !puntoEnPoligono(lat, lng, geo.rows[0].polygon)) throw new ApiError(400, 'GPS_OUTSIDE_ESTABLISHMENT', 'El GPS debe quedar dentro del establecimiento.');
    }
    const result = await db.query<Fila>(`UPDATE gps_simulados SET ${cambios.join(',')},updated_at=NOW() WHERE establecimiento_id=$${eid} AND user_id=$${uid} AND id=$${did} RETURNING *`, valores);
    if (!result.rows[0]) throw new ApiError(404, 'GPS_SIMULATED_NOT_FOUND', 'Dispositivo no disponible.');
    await db.query('COMMIT'); res.json({ dispositivo: dto(result.rows[0]) });
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
