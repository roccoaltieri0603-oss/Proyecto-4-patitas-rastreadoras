import type { Request, Response } from 'express';
import { UUID, contexto } from '../autorizacion/membresia.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { leerBooleano, leerPaginacion, leerRangoCalendario } from '../http/query.js';
import { obtenerRegistroDeUsos, type FiltrosRegistroDeUsos } from '../services/registro-usos.js';
import { construirLibroRegistro } from '../services/registro-usos-excel.js';

/**
 * Planilla de uso de potreros del establecimiento. La vista en pantalla y la
 * descarga en Excel salen de la misma consulta; lo único que cambia es cómo se
 * serializa. Es lectura pura sobre `usos_lote`: no escribe nada y no llama
 * servicios externos.
 */

/** Tope de renglones por descarga. Más que esto hay que acotarlo por fechas. */
export const MAXIMO_FILAS_EXCEL = 5000;

function filtros(req: Request): FiltrosRegistroDeUsos {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  const loteId = req.query.loteId;
  if (loteId !== undefined && (typeof loteId !== 'string' || !UUID.test(loteId))) {
    throw new ApiError(400, 'INVALID_LOT_ID', 'El ID de lote no es válido.');
  }
  return {
    ...leerRangoCalendario(req.query),
    loteId,
    incluirInactivos: leerBooleano(req.query, 'incluirInactivos') ?? false,
  };
}

export async function obtenerRegistroUsos(req: Request, res: Response): Promise<void> {
  const seleccion = filtros(req);
  const registro = await obtenerRegistroDeUsos(contexto(req).establecimientoId, seleccion, leerPaginacion(req.query));
  res.json(registro);
}

function nombreDeArchivo(establecimiento: string, rango: { desde?: string; hasta?: string }): string {
  // Sin acentos ni espacios: el nombre viaja en una cabecera HTTP.
  const limpio = establecimiento.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
  const periodo = [rango.desde, rango.hasta].filter(Boolean).join('_');
  return ['registro-manejo-potreros', limpio || 'establecimiento', periodo].filter(Boolean).join('-') + '.xlsx';
}

export async function descargarRegistroUsosExcel(req: Request, res: Response): Promise<void> {
  const seleccion = filtros(req);
  const establecimientoId = contexto(req).establecimientoId;

  // El libro lleva el período entero, no una página: se pide todo de una y se
  // corta con un tope explícito en lugar de generar un archivo imposible.
  const registro = await obtenerRegistroDeUsos(establecimientoId, seleccion, { limit: MAXIMO_FILAS_EXCEL, offset: 0 });
  if (registro.paginacion.total > MAXIMO_FILAS_EXCEL) {
    throw new ApiError(400, 'EXPORT_TOO_LARGE',
      `El período elegido tiene ${registro.paginacion.total} registros y la descarga admite hasta ${MAXIMO_FILAS_EXCEL}. Acotá el rango de fechas.`);
  }

  const establecimiento = await pool.query<{ nombre: string }>('SELECT nombre FROM establecimientos WHERE id = $1', [establecimientoId]);
  const nombre = establecimiento.rows[0]?.nombre ?? 'Establecimiento';

  // Con un potrero elegido va sólo su hoja; si no, una hoja por potrero.
  const lotes = seleccion.loteId
    ? registro.lotes.filter((lote) => lote.id === seleccion.loteId)
    : registro.lotes.filter((lote) => lote.activo || seleccion.incluirInactivos);

  const libro = construirLibroRegistro({
    establecimiento: nombre,
    lotes,
    registros: registro.registros,
    desde: seleccion.desde,
    hasta: seleccion.hasta,
    generadoEn: new Date(),
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDeArchivo(nombre, seleccion)}"`);
  await libro.xlsx.write(res);
  res.end();
}
