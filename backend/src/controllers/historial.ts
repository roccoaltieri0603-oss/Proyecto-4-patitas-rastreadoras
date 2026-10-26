import { contexto } from '../autorizacion/membresia.js';
import type { Request, Response } from 'express';
import { medicionesAlturaDisponibles } from '../base-datos/mediciones-altura-disponibles.js';
import { pool } from '../base-datos/pool.js';
import { esFechaCalendario, hoyCalendario } from '../fechas.js';
import { ApiError } from '../http/errors.js';
import { leerPaginacion, leerRangoCalendario, type Paginacion, type RangoCalendario } from '../http/query.js';
import { obtenerEstadosDeLotes } from '../services/estado-lotes.js';
import { COLUMNAS_DIA_CLIMA, diaClimaDesdeFila } from '../services/consultas-clima.js';
import { COLUMNAS_USO, usoDto, type FilaUso } from '../services/usos-lote.js';
import type { DiaClima } from '../services/open-meteo.js';

function establecimientoId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return contexto(req).establecimientoId;
}

async function loteDelEstablecimiento(req: Request): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT l.id FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = $1 AND e.id = $2 AND l.deleted_at IS NULL`,
    [req.params.id, establecimientoId(req)],
  );
  if (!result.rows[0]) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  return result.rows[0].id;
}

function fechaCalendario(value: unknown, campo: string): string {
  if (!esFechaCalendario(value)) throw new ApiError(400, 'INVALID_DATE', `${campo} debe tener formato YYYY-MM-DD y ser válida.`);
  return value;
}

function measurementDto(row: Record<string, unknown>) {
  return {
    id: row.id, fuente: row.fuente, observedAt: row.observed_at, consultedAt: row.consulted_at,
    coberturaValida: row.cobertura_valida,
    ndvi: { media: row.ndvi_media, mediana: row.ndvi_mediana, min: row.ndvi_min, max: row.ndvi_max, desvio: row.ndvi_desvio },
    ndmi: { media: row.ndmi_media, mediana: row.ndmi_mediana, min: row.ndmi_min, max: row.ndmi_max, desvio: row.ndmi_desvio },
    ndwi: { media: row.ndwi_media, mediana: row.ndwi_mediana, min: row.ndwi_min, max: row.ndwi_max, desvio: row.ndwi_desvio },
    evi: { media: row.evi_media, mediana: row.evi_mediana, min: row.evi_min, max: row.evi_max, desvio: row.evi_desvio },
    rvi: { media: row.rvi_media, mediana: row.rvi_mediana, min: row.rvi_min, max: row.rvi_max, desvio: row.rvi_desvio },
    puntaje: row.puntaje, categoria: row.categoria, alertas: row.alertas, rawMetadata: row.raw_metadata,
  };
}

export async function obtenerMedicionesSatelitales(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const fuente = req.query.fuente;
  if (fuente !== undefined && (typeof fuente !== 'string' || (fuente !== 'sentinel-1' && fuente !== 'sentinel-2'))) {
    throw new ApiError(400, 'INVALID_SOURCE', 'La fuente satelital no es válida.');
  }
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (fuente) { valores.push(fuente); condiciones.push(`fuente = $${valores.length}`); }
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`observed_at >= $${valores.length}::date`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`observed_at <= $${valores.length}::date`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM mediciones_satelitales WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const result = await pool.query(`SELECT * FROM mediciones_satelitales WHERE ${where} ORDER BY observed_at DESC, fuente ASC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const totalNumber = Number(total.rows[0].total);
  res.json({ mediciones: result.rows.map(measurementDto), paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + result.rows.length < totalNumber } });
}

async function consultasClima(loteId: string, paginacion: Paginacion, rango: RangoCalendario) {
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`consulted_at >= ($${valores.length}::date AT TIME ZONE 'UTC')`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`consulted_at < (($${valores.length}::date + INTERVAL '1 day') AT TIME ZONE 'UTC')`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM consultas_clima WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const consultas = await pool.query(`SELECT * FROM consultas_clima WHERE ${where} ORDER BY consulted_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const ids = consultas.rows.map((consulta) => consulta.id as string);
  const dias = ids.length === 0 ? { rows: [] } : await pool.query(`SELECT ${COLUMNAS_DIA_CLIMA} FROM dias_clima WHERE consulta_clima_id = ANY($1::uuid[]) ORDER BY fecha`, [ids]);
  const diasPorConsulta = new Map<string, DiaClima[]>();
  for (const dia of dias.rows) {
    const lista = diasPorConsulta.get(dia.consulta_clima_id) ?? [];
    lista.push(diaClimaDesdeFila(dia));
    diasPorConsulta.set(dia.consulta_clima_id, lista);
  }
  const items = consultas.rows.map((consulta) => ({ id: consulta.id, consultedAt: consulta.consulted_at, origen: consulta.origen, lluviaUltimos7Dias: consulta.lluvia_ultimos_7_dias, lluviaProximosDias: consulta.lluvia_proximos_dias, categoria: consulta.categoria, dias: diasPorConsulta.get(consulta.id) ?? [] }));
  const totalNumber = Number(total.rows[0].total);
  return { items, paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + items.length < totalNumber } };
}

export async function obtenerConsultasClima(req: Request, res: Response): Promise<void> {
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const resultado = await consultasClima(await loteDelEstablecimiento(req), paginacion, rango);
  res.json({ consultas: resultado.items, paginacion: resultado.paginacion });
}

export async function crearUsoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req); const body = req.body as Record<string, unknown>;
  const fecha = fechaCalendario(body.fecha, 'fecha');
  if (fecha > hoyCalendario()) throw new ApiError(400, 'FUTURE_USE_DATE', 'La fecha de uso no puede ser futura.');
  const result = await pool.query<FilaUso>(`INSERT INTO usos_lote (lote_id, fecha, origen) VALUES ($1, $2, $3) RETURNING ${COLUMNAS_USO}`, [loteId, fecha, typeof body.origen === 'string' ? body.origen : 'manual']);
  res.status(201).json({ uso: usoDto(result.rows[0]) });
}

/** Tolerancia para la diferencia de reloj entre el teléfono y el servidor. */
const MARGEN_FUTURO_MS = 5 * 60_000;
const MAXIMO_ANIMALES = 100_000;
const MAXIMO_ALTURA_CM = 300;
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function instante(valor: unknown, campo: string): Date {
  const fecha = typeof valor === 'string' && INSTANTE_ISO.test(valor) ? new Date(valor) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) throw new ApiError(400, 'INVALID_DATETIME', `${campo} debe ser una fecha y hora ISO con zona horaria.`);
  if (fecha.getTime() > Date.now() + MARGEN_FUTURO_MS) throw new ApiError(400, 'FUTURE_DATETIME', `${campo} no puede ser futura.`);
  return fecha;
}

function cantidadAnimales(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > MAXIMO_ANIMALES) {
    throw new ApiError(400, 'INVALID_ANIMAL_COUNT', `${campo} debe ser un número entero de 0 a ${MAXIMO_ANIMALES}.`);
  }
  return valor;
}

function alturaRemanente(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > MAXIMO_ALTURA_CM) {
    throw new ApiError(400, 'INVALID_REMNANT_HEIGHT', `La altura del remanente debe estar entre 0 y ${MAXIMO_ALTURA_CM} cm.`);
  }
  return valor;
}

interface DatosJornada {
  ingreso: Date | null;
  salida: Date | null;
  adultos: number | null;
  toretesVaconas: number | null;
  terneros: number | null;
  alturaCm: number | null;
}

/** Reglas que valen al iniciar, al registrar una jornada pasada y al editar. */
function validarJornada(datos: DatosJornada): void {
  if (datos.salida && !datos.ingreso) throw new ApiError(400, 'EXIT_WITHOUT_ENTRY', 'Para cargar la salida hace falta la entrada.');
  if (datos.salida && datos.ingreso && datos.salida <= datos.ingreso) throw new ApiError(400, 'EXIT_BEFORE_ENTRY', 'La salida tiene que ser posterior a la entrada.');
  if (datos.alturaCm !== null && !datos.salida) throw new ApiError(400, 'REMNANT_WITHOUT_EXIT', 'La altura del remanente se carga al sacar los animales.');
  const animales = (datos.adultos ?? 0) + (datos.toretesVaconas ?? 0) + (datos.terneros ?? 0);
  if (datos.ingreso && animales === 0) throw new ApiError(400, 'ANIMALS_REQUIRED', 'Indicá cuántos animales entraron.');
}

function jornadaAbiertaDuplicada(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'usos_lote_jornada_abierta_unique_idx';
}

const YA_HAY_JORNADA = () => new ApiError(409, 'GRAZING_ALREADY_OPEN', 'Ya hay animales en este lote: finalizá esa jornada antes de iniciar otra.');

/**
 * Inicia una jornada: animales que entran y cuándo. Si viene también la
 * salida, registra una jornada que ya terminó, por ejemplo de días pasados.
 */
export async function iniciarJornada(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const datos: DatosJornada = {
    ingreso: instante(body.ingresoAt, 'La entrada'),
    salida: body.salidaAt === undefined || body.salidaAt === null ? null : instante(body.salidaAt, 'La salida'),
    adultos: cantidadAnimales(body.adultos, 'Adultos'),
    toretesVaconas: cantidadAnimales(body.toretesVaconas, 'Toretes o vaconas'),
    terneros: cantidadAnimales(body.terneros, 'Terneros o terneras'),
    alturaCm: alturaRemanente(body.alturaRemanenteCm),
  };
  validarJornada(datos);
  try {
    const result = await pool.query<FilaUso>(
      `INSERT INTO usos_lote (lote_id, fecha, origen, ingreso_at, salida_at, animales_adultos, animales_toretes_vaconas, animales_terneros, altura_remanente_cm)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNAS_USO}`,
      [loteId, hoyCalendario(datos.ingreso as Date), datos.ingreso, datos.salida, datos.adultos, datos.toretesVaconas, datos.terneros, datos.alturaCm],
    );
    res.status(201).json({ uso: usoDto(result.rows[0]) });
  } catch (error) {
    if (jornadaAbiertaDuplicada(error)) throw YA_HAY_JORNADA();
    throw error;
  }
}

/** Saca los animales: hora de salida y, si se midió, altura del remanente. */
export async function finalizarJornada(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const salida = instante(body.salidaAt, 'La salida');
  const alturaCm = alturaRemanente(body.alturaRemanenteCm);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query<FilaUso>(`SELECT ${COLUMNAS_USO} FROM usos_lote WHERE id = $1 AND lote_id = $2 FOR UPDATE`, [req.params.usoId, loteId]);
    const uso = actual.rows[0];
    if (!uso) throw new ApiError(404, 'USE_NOT_FOUND', 'Registro de uso inexistente.');
    if (!uso.ingreso_at || uso.salida_at) throw new ApiError(409, 'GRAZING_NOT_OPEN', 'Esta jornada no está abierta.');
    if (salida <= new Date(uso.ingreso_at)) throw new ApiError(400, 'EXIT_BEFORE_ENTRY', 'La salida tiene que ser posterior a la entrada.');
    const result = await client.query<FilaUso>(
      `UPDATE usos_lote SET salida_at = $3, altura_remanente_cm = $4 WHERE id = $1 AND lote_id = $2 RETURNING ${COLUMNAS_USO}`,
      [uso.id, loteId, salida, alturaCm],
    );
    await client.query('COMMIT');
    res.json({ uso: usoDto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const CAMPOS_JORNADA = ['ingresoAt', 'salidaAt', 'adultos', 'toretesVaconas', 'terneros', 'alturaRemanenteCm'] as const;

/**
 * Edita un uso. Un uso viejo cambia su fecha; una jornada cambia cualquiera de
 * sus datos, y su fecha sigue siendo la del día de entrada.
 */
export async function modificarUsoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const editaJornada = CAMPOS_JORNADA.some((campo) => campo in body);
  if (!editaJornada && body.fecha === undefined) throw new ApiError(400, 'EMPTY_UPDATE', 'No hay cambios para aplicar.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query<FilaUso>(`SELECT ${COLUMNAS_USO} FROM usos_lote WHERE id = $1 AND lote_id = $2 FOR UPDATE`, [req.params.usoId, loteId]);
    const uso = actual.rows[0];
    if (!uso) throw new ApiError(404, 'USE_NOT_FOUND', 'Registro de uso inexistente.');

    const elegir = <T>(campo: string, leer: (valor: unknown) => T, anterior: T): T => (campo in body ? leer(body[campo]) : anterior);
    const datos: DatosJornada = {
      ingreso: elegir('ingresoAt', (valor) => (valor === null ? null : instante(valor, 'La entrada')), uso.ingreso_at ? new Date(uso.ingreso_at) : null),
      salida: elegir('salidaAt', (valor) => (valor === null ? null : instante(valor, 'La salida')), uso.salida_at ? new Date(uso.salida_at) : null),
      adultos: elegir('adultos', (valor) => cantidadAnimales(valor, 'Adultos'), uso.animales_adultos ?? null),
      toretesVaconas: elegir('toretesVaconas', (valor) => cantidadAnimales(valor, 'Toretes o vaconas'), uso.animales_toretes_vaconas ?? null),
      terneros: elegir('terneros', (valor) => cantidadAnimales(valor, 'Terneros o terneras'), uso.animales_terneros ?? null),
      alturaCm: elegir('alturaRemanenteCm', alturaRemanente, uso.altura_remanente_cm ?? null),
    };
    validarJornada(datos);

    let fecha: string;
    if (datos.ingreso) {
      if (body.fecha !== undefined) throw new ApiError(400, 'USE_HAS_TIMES', 'Este pastoreo tiene horario: cambiá la entrada en lugar de la fecha.');
      fecha = hoyCalendario(datos.ingreso);
    } else {
      fecha = body.fecha === undefined ? uso.fecha : fechaCalendario(body.fecha, 'fecha');
      if (fecha > hoyCalendario()) throw new ApiError(400, 'FUTURE_USE_DATE', 'La fecha de uso no puede ser futura.');
    }

    const result = await client.query<FilaUso>(
      `UPDATE usos_lote SET fecha = $3, ingreso_at = $4, salida_at = $5, animales_adultos = $6,
              animales_toretes_vaconas = $7, animales_terneros = $8, altura_remanente_cm = $9
        WHERE id = $1 AND lote_id = $2 RETURNING ${COLUMNAS_USO}`,
      [uso.id, loteId, fecha, datos.ingreso, datos.salida, datos.adultos, datos.toretesVaconas, datos.terneros, datos.alturaCm],
    );
    await client.query('COMMIT');
    res.json({ uso: usoDto(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    if (jornadaAbiertaDuplicada(error)) throw YA_HAY_JORNADA();
    throw error;
  } finally {
    client.release();
  }
}
export async function eliminarUsoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Una medición de altura es una observación del lote y sobrevive al uso: sólo se desvincula.
    if (await medicionesAlturaDisponibles()) {
      await client.query('UPDATE mediciones_altura SET uso_id = NULL, updated_at = NOW() WHERE uso_id = $1 AND lote_id = $2', [req.params.usoId, loteId]);
    }
    const result = await client.query('DELETE FROM usos_lote WHERE id = $1 AND lote_id = $2 RETURNING id', [req.params.usoId, loteId]);
    if (!result.rows[0]) throw new ApiError(404, 'USE_NOT_FOUND', 'Registro de uso inexistente.');
    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function obtenerUsosLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const paginacion = leerPaginacion(req.query);
  const rango = leerRangoCalendario(req.query);
  const condiciones = ['lote_id = $1'];
  const valores: unknown[] = [loteId];
  if (rango.desde) { valores.push(rango.desde); condiciones.push(`fecha >= $${valores.length}::date`); }
  if (rango.hasta) { valores.push(rango.hasta); condiciones.push(`fecha <= $${valores.length}::date`); }
  const where = condiciones.join(' AND ');
  const total = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM usos_lote WHERE ${where}`, valores);
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const result = await pool.query<FilaUso>(`SELECT ${COLUMNAS_USO} FROM usos_lote WHERE ${where} ORDER BY fecha DESC, created_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, valores);
  const totalNumber = Number(total.rows[0].total);
  res.json({ usos: result.rows.map(usoDto), paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + result.rows.length < totalNumber } });
}

export async function obtenerEstadoLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const [estado] = await obtenerEstadosDeLotes([loteId]);
  res.json(estado);
}

export async function obtenerHistorialLote(req: Request, res: Response): Promise<void> {
  const loteId = await loteDelEstablecimiento(req);
  const mediciones = await pool.query('SELECT * FROM mediciones_satelitales WHERE lote_id = $1 ORDER BY observed_at DESC, fuente ASC, id ASC LIMIT 51', [loteId]);
  const usos = await pool.query<FilaUso>(`SELECT ${COLUMNAS_USO} FROM usos_lote WHERE lote_id = $1 ORDER BY fecha DESC, created_at DESC, id ASC LIMIT 51`, [loteId]);
  const clima = await consultasClima(loteId, { limit: 50, offset: 0 }, {});
  res.json({ satelite: mediciones.rows.slice(0, 50).map(measurementDto), clima: clima.items, usos: usos.rows.slice(0, 50).map(usoDto), paginacion: { satelite: { limit: 50, offset: 0, hayMas: mediciones.rows.length > 50 }, clima: clima.paginacion, usos: { limit: 50, offset: 0, hayMas: usos.rows.length > 50 } } });
}
