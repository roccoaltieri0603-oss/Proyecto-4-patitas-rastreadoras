import { pool } from '../base-datos/pool.js';
import { diasEntreFechas } from '../fechas.js';
import { areaHectareas, esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';
import type { Paginacion, RangoCalendario } from '../http/query.js';

/**
 * Registro de uso de potreros: la planilla de campo armada sobre `usos_lote`,
 * que es el registro real que ya lleva el establecimiento.
 *
 * No hay tabla nueva ni dato nuevo. Lo único que agrega esta capa es lo que se
 * deriva de lo ya guardado: la superficie del potrero, que sale del polígono
 * con Turf, y los días de descanso, que son la diferencia de fechas calendario
 * contra el uso anterior del mismo potrero.
 *
 * Los días de ocupación, los animales y las recomendaciones de manejo que
 * tiene la planilla en papel **no están acá**: requieren fecha de salida y
 * jornadas de pastoreo, que siguen pausadas en CLAUDE.md y
 * docs/OPEN_QUESTIONS.md. No se completan con un valor inventado.
 */

export interface LoteDelRegistro {
  id: string;
  numero: number;
  apodo: string | null;
  activo: boolean;
  /** Derivada del polígono guardado; `null` si la geometría almacenada no es un Feature<Polygon> válido. */
  hectareas: number | null;
}

export interface RegistroDeUso {
  id: string;
  loteId: string;
  fecha: string;
  origen: string;
  createdAt: string;
  /** Uso inmediatamente anterior del mismo potrero, aunque caiga fuera del rango consultado. */
  fechaUsoAnterior: string | null;
  /** Días calendario entre el uso anterior y éste. `null` en el primer uso registrado del potrero. */
  diasDescanso: number | null;
}

export interface RegistroDeUsos {
  /**
   * Catálogo completo de potreros no eliminados del establecimiento, activos e
   * inactivos. No es la lista de los que tienen renglones: sirve para el
   * selector de la planilla y para resolver el nombre y la superficie de cada
   * renglón. Qué potreros aportan renglones lo deciden `loteId` e
   * `incluirInactivos`.
   */
  lotes: LoteDelRegistro[];
  registros: RegistroDeUso[];
  paginacion: Paginacion & { total: number; hayMas: boolean };
}

export interface FiltrosRegistroDeUsos extends RangoCalendario {
  /** Limita la planilla a un solo potrero. Si se pasa, `incluirInactivos` deja de importar. */
  loteId?: string;
  incluirInactivos?: boolean;
}

function hectareas(polygon: unknown): number | null {
  if (!esPolygonFeature(polygon)) return null;
  return Number(areaHectareas(polygon).toFixed(2));
}

async function potrerosDelEstablecimiento(establecimientoId: string): Promise<LoteDelRegistro[]> {
  const result = await pool.query(
    'SELECT id, numero, apodo, activo, polygon FROM lotes WHERE establecimiento_id = $1 AND deleted_at IS NULL ORDER BY numero ASC',
    [establecimientoId],
  );
  return result.rows.map((lote) => ({
    id: lote.id as string,
    numero: lote.numero as number,
    apodo: lote.apodo as string | null,
    activo: lote.activo as boolean,
    hectareas: hectareas(lote.polygon),
  }));
}

/** Qué potreros aportan renglones. El catálogo que se devuelve es siempre el completo. */
function potrerosConRenglones(lotes: LoteDelRegistro[], filtros: FiltrosRegistroDeUsos): string[] {
  // Pedir un potrero puntual que no es de este establecimiento es un 404, igual
  // que en el resto de los endpoints por lote. Que esté inactivo no lo esconde:
  // el usuario lo eligió explícitamente.
  if (filtros.loteId) {
    if (!lotes.some((lote) => lote.id === filtros.loteId)) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
    return [filtros.loteId];
  }
  return lotes.filter((lote) => lote.activo || filtros.incluirInactivos).map((lote) => lote.id);
}

export async function obtenerRegistroDeUsos(
  establecimientoId: string,
  filtros: FiltrosRegistroDeUsos,
  paginacion: Paginacion,
): Promise<RegistroDeUsos> {
  const lotes = await potrerosDelEstablecimiento(establecimientoId);
  const ids = potrerosConRenglones(lotes, filtros);
  if (ids.length === 0) {
    return { lotes, registros: [], paginacion: { ...paginacion, total: 0, hayMas: false } };
  }

  // El descanso se calcula sobre la historia completa del potrero y recién
  // después se filtra el rango: así el primer renglón de un mes sigue sabiendo
  // cuántos días descansó desde el uso del mes anterior.
  const historico = `WITH historico AS (
      SELECT id, lote_id, fecha, origen, created_at,
             LAG(fecha) OVER (PARTITION BY lote_id ORDER BY fecha ASC, created_at ASC, id ASC) AS fecha_anterior
        FROM usos_lote
       WHERE lote_id = ANY($1::uuid[])
    )`;
  const valores: unknown[] = [ids];
  const condiciones: string[] = [];
  if (filtros.desde) { valores.push(filtros.desde); condiciones.push(`fecha >= $${valores.length}::date`); }
  if (filtros.hasta) { valores.push(filtros.hasta); condiciones.push(`fecha <= $${valores.length}::date`); }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const total = await pool.query<{ total: string }>(
    `${historico} SELECT COUNT(*)::text AS total FROM historico ${where}`,
    valores,
  );
  const limitIndex = valores.push(paginacion.limit);
  const offsetIndex = valores.push(paginacion.offset);
  const result = await pool.query(
    `${historico} SELECT * FROM historico ${where}
     ORDER BY fecha DESC, created_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    valores,
  );

  const registros = result.rows.map((uso) => {
    const fecha = uso.fecha as string;
    const fechaUsoAnterior = (uso.fecha_anterior as string | null) ?? null;
    return {
      id: uso.id as string,
      loteId: uso.lote_id as string,
      fecha,
      origen: uso.origen as string,
      createdAt: uso.created_at as string,
      fechaUsoAnterior,
      diasDescanso: fechaUsoAnterior ? Math.max(0, diasEntreFechas(fechaUsoAnterior, fecha)) : null,
    };
  });

  const totalNumber = Number(total.rows[0].total);
  return {
    lotes,
    registros,
    paginacion: { ...paginacion, total: totalNumber, hayMas: paginacion.offset + registros.length < totalNumber },
  };
}
