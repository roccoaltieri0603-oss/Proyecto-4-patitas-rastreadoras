import type { Request, Response } from 'express';
import { contexto } from '../autorizacion/membresia.js';
import { medicionesAlturaDisponibles } from '../base-datos/mediciones-altura-disponibles.js';
import { pool } from '../base-datos/pool.js';
import { hoyCalendario } from '../fechas.js';
import { ApiError } from '../http/errors.js';
import { leerPaginacion } from '../http/query.js';
import {
  COLUMNAS_MEDICION, copiarRemanenteAlUso, leerDatosMedicion, medicionDto, quitarRemanenteDelUso, verificarUsoDelLote,
  type DatosMedicion, type FilaMedicion,
} from '../services/mediciones-altura.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function exigirMigracion(): Promise<void> {
  if (!(await medicionesAlturaDisponibles())) {
    throw new ApiError(503, 'HEIGHT_MIGRATION_PENDING', 'La base de datos todavía no tiene la migración 018: no se pueden guardar mediciones de altura.');
  }
}

/** El lote sale de la URL y del establecimiento de la sesión, igual que los usos. */
async function loteDelEstablecimiento(req: Request): Promise<string> {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  const result = await pool.query<{ id: string }>(
    `SELECT l.id FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
      WHERE l.id = $1 AND e.id = $2 AND l.deleted_at IS NULL`,
    [req.params.id, contexto(req).establecimientoId],
  );
  if (!result.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  return result.rows[0].id;
}

function datosDeFila(fila: FilaMedicion): DatosMedicion {
  return {
    fecha: fila.fecha, momento: fila.momento, instrumento: fila.instrumento, alturaPromedioCm: fila.altura_promedio_cm,
    cantidadLecturas: fila.cantidad_lecturas, desvioCm: fila.desvio_cm, usoId: fila.uso_id,
  };
}

export async function obtenerMedicionesAltura(req: Request, res: Response): Promise<void> {
  await exigirMigracion();
  const loteId = await loteDelEstablecimiento(req);
  const { limit, offset } = leerPaginacion(req.query, 50);
  const usoId = typeof req.query.usoId === 'string' ? req.query.usoId : undefined;
  if (usoId !== undefined && !UUID.test(usoId)) throw new ApiError(400, 'INVALID_USE_ID', 'usoId debe ser un UUID.');
  const filtro = usoId ? 'lote_id = $1 AND uso_id = $2' : 'lote_id = $1';
  const valores = usoId ? [loteId, usoId] : [loteId];
  const [total, filas] = await Promise.all([
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM mediciones_altura WHERE ${filtro}`, valores),
    pool.query<FilaMedicion>(
      `SELECT ${COLUMNAS_MEDICION} FROM mediciones_altura WHERE ${filtro}
        ORDER BY fecha DESC, created_at DESC, id LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
      [...valores, limit, offset],
    ),
  ]);
  const cantidad = Number(total.rows[0]?.total ?? 0);
  res.json({ mediciones: filas.rows.map(medicionDto), paginacion: { limit, offset, total: cantidad, hayMas: offset + filas.rows.length < cantidad } });
}

export async function crearMedicionAltura(req: Request, res: Response): Promise<void> {
  await exigirMigracion();
  const loteId = await loteDelEstablecimiento(req);
  const datos = leerDatosMedicion(req.body, hoyCalendario());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (datos.usoId) await verificarUsoDelLote(client, datos.usoId, loteId);
    const result = await client.query<FilaMedicion>(
      `INSERT INTO mediciones_altura (lote_id, fecha, momento, instrumento, altura_promedio_cm, cantidad_lecturas, desvio_cm, uso_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNAS_MEDICION}`,
      [loteId, datos.fecha, datos.momento, datos.instrumento, datos.alturaPromedioCm, datos.cantidadLecturas, datos.desvioCm, datos.usoId, req.usuario!.id],
    );
    await copiarRemanenteAlUso(client, datos, loteId);
    await client.query('COMMIT');
    res.status(201).json({ medicion: medicionDto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function modificarMedicionAltura(req: Request, res: Response): Promise<void> {
  await exigirMigracion();
  const loteId = await loteDelEstablecimiento(req);
  if (!UUID.test(String(req.params.medicionId))) throw new ApiError(404, 'MEASUREMENT_NOT_FOUND', 'Medición inexistente.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query<FilaMedicion>(`SELECT ${COLUMNAS_MEDICION} FROM mediciones_altura WHERE id = $1 AND lote_id = $2 FOR UPDATE`, [req.params.medicionId, loteId]);
    if (!actual.rows[0]) throw new ApiError(404, 'MEASUREMENT_NOT_FOUND', 'Medición inexistente.');
    const datos = leerDatosMedicion(req.body, hoyCalendario(), datosDeFila(actual.rows[0]));
    if (datos.usoId) await verificarUsoDelLote(client, datos.usoId, loteId);
    await quitarRemanenteDelUso(client, actual.rows[0], loteId);
    const result = await client.query<FilaMedicion>(
      `UPDATE mediciones_altura SET fecha = $3, momento = $4, instrumento = $5, altura_promedio_cm = $6, cantidad_lecturas = $7,
              desvio_cm = $8, uso_id = $9, updated_at = NOW()
        WHERE id = $1 AND lote_id = $2 RETURNING ${COLUMNAS_MEDICION}`,
      [req.params.medicionId, loteId, datos.fecha, datos.momento, datos.instrumento, datos.alturaPromedioCm, datos.cantidadLecturas, datos.desvioCm, datos.usoId],
    );
    await copiarRemanenteAlUso(client, datos, loteId);
    await client.query('COMMIT');
    res.json({ medicion: medicionDto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function eliminarMedicionAltura(req: Request, res: Response): Promise<void> {
  await exigirMigracion();
  const loteId = await loteDelEstablecimiento(req);
  if (!UUID.test(String(req.params.medicionId))) throw new ApiError(404, 'MEASUREMENT_NOT_FOUND', 'Medición inexistente.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const borrada = await client.query<FilaMedicion>(`DELETE FROM mediciones_altura WHERE id = $1 AND lote_id = $2 RETURNING ${COLUMNAS_MEDICION}`, [req.params.medicionId, loteId]);
    if (!borrada.rows[0]) throw new ApiError(404, 'MEASUREMENT_NOT_FOUND', 'Medición inexistente.');
    await quitarRemanenteDelUso(client, borrada.rows[0], loteId);
    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
