import type { Request, Response } from 'express';
import { contexto } from '../autorizacion/membresia.js';
import { prohibido } from '../autorizacion/reglas.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { esPolygonFeature, puntoEnPoligono } from '../geometria.js';
import { mantenerIncidenciaActiva, resolverIncidencia } from '../services/notificaciones.js';

/**
 * Última posición del punto de GPS simulado del mapa.
 *
 * No es una posición real de ganado ni de un dispositivo: es dónde dejó el
 * usuario el marcador arrastrable de la demo. Se guarda una sola fila por
 * establecimiento, sin historial, para que al volver a entrar el punto aparezca
 * donde quedó en vez de saltar al centroide. Jornadas, tramos y recorridos
 * siguen pausados; esta tabla no los habilita.
 *
 * El establecimiento sale del contexto de membresía de la URL, nunca de un ID
 * del cuerpo. Cualquier miembro puede leer la posición; escribirla queda fuera
 * del alcance del Visor, que es de sólo lectura sobre lo compartido.
 */

interface FilaPosicion {
  latitud: number;
  longitud: number;
  updated_at: Date;
}

function dto(fila: FilaPosicion) {
  return { latitud: fila.latitud, longitud: fila.longitud, actualizadaEn: fila.updated_at };
}

function coordenada(valor: unknown, maximo: number, nombre: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < -maximo || valor > maximo) {
    throw new ApiError(400, 'INVALID_GPS_POSITION', `${nombre} debe ser un número entre ${-maximo} y ${maximo}.`);
  }
  return valor;
}

export async function obtenerPosicionGpsSimulado(req: Request, res: Response): Promise<void> {
  const result = await pool.query<FilaPosicion>(
    'SELECT latitud, longitud, updated_at FROM gps_simulado_posicion WHERE establecimiento_id = $1',
    [contexto(req).establecimientoId],
  );
  res.json({ posicion: result.rows[0] ? dto(result.rows[0]) : null });
}

export async function guardarPosicionGpsSimulado(req: Request, res: Response): Promise<void> {
  const membresia = contexto(req);
  if (membresia.rol === 'VISOR') prohibido();
  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const latitud = coordenada(cuerpo.latitud, 90, 'latitud');
  const longitud = coordenada(cuerpo.longitud, 180, 'longitud');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const establecimiento = await client.query<{ polygon: unknown }>(
      'SELECT polygon FROM establecimientos WHERE id = $1 FOR UPDATE', [membresia.establecimientoId],
    );
    if (!esPolygonFeature(establecimiento.rows[0]?.polygon)) throw new ApiError(500, 'INVALID_STORED_POLYGON', 'El establecimiento tiene una geometría almacenada inválida.');
    const result = await client.query<FilaPosicion>(
      `INSERT INTO gps_simulado_posicion (establecimiento_id, latitud, longitud, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (establecimiento_id)
       DO UPDATE SET latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
                     updated_at = NOW(), updated_by = EXCLUDED.updated_by
       RETURNING latitud, longitud, updated_at`,
      [membresia.establecimientoId, latitud, longitud, membresia.userId],
    );
    const dentro = puntoEnPoligono(latitud, longitud, establecimiento.rows[0].polygon);
    if (dentro) {
      await resolverIncidencia(client, membresia.establecimientoId, 'gps_simulado_fuera_establecimiento', 'gps_simulado');
    } else {
      await mantenerIncidenciaActiva(client, {
        establecimientoId: membresia.establecimientoId, tipo: 'gps_simulado_fuera_establecimiento', clave: 'gps_simulado',
        detalles: { origen: 'gps_simulado' },
        titulo: 'Punto GPS simulado fuera del establecimiento',
        mensaje: 'El punto GPS simulado está fuera de los límites del establecimiento.', soloResponsableGps: true,
      });
    }
    await client.query('COMMIT');
    res.json({ posicion: dto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
