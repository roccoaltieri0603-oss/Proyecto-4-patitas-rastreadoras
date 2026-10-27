import { pool } from '../base-datos/pool.js';
import type { Confianza } from '../estimacion/biomasa.js';
import type { Etapa, EstimacionForraje } from '../estimacion/motor.js';
import { diasEntreFechas, sumarDias } from '../fechas.js';
import { obtenerEstimacionesForraje } from './estimacion-forraje.js';

/**
 * Orden de los lotes del establecimiento para decidir a cuál mandar la
 * hacienda hoy. Se calcula al leer, con la estimación de forraje, el clima y
 * la última imagen; no se guarda nada. No calcula animales, carga ni días de
 * permanencia: siguen pausados.
 */

export const LEYENDA_ORDEN = 'Orden según los datos disponibles. La decisión es tuya.';
/** Decisión de diseño: la categoría de clima vale si la consulta tiene hasta 2 días. */
export const DIAS_CLIMA_RECIENTE = 2;
/** Decisión de diseño: una alerta de agua vale si la imagen óptica tiene hasta 10 días. */
export const DIAS_OPTICA_RECIENTE = 10;
const ALERTA_AGUA = /agua libre|anegado/i;

/**
 * De primero a último:
 * - `listo`: en la ventana de reingreso y con el piso firme;
 * - `pasado`: pasó la ventana, las hojas viejas se empiezan a secar;
 * - `esperar-al-piso`: listo o pasado, pero con el piso pesado;
 * - `rebrotando`: todavía no llegó;
 * - `en-pastoreo`: hay animales adentro;
 * - `sin-datos`: no se puede decir, con su motivo.
 */
export type GrupoOrden = 'listo' | 'pasado' | 'esperar-al-piso' | 'rebrotando' | 'en-pastoreo' | 'sin-datos';
const ORDEN_GRUPOS: GrupoOrden[] = ['listo', 'pasado', 'esperar-al-piso', 'rebrotando', 'en-pastoreo', 'sin-datos'];

export interface PisoDelLote {
  pesado: boolean;
  motivo: string | null;
}

/**
 * Lo que el usuario puede cargar para que el lote entre al orden o lo haga con
 * su etapa real: la pastura, el último pastoreo (sin él se cuenta desde el alta)
 * o el clima. null si no falta nada que esté en sus manos, como el criterio de
 * reingreso de la alfalfa.
 */
export type FaltaDelLote = 'pastura' | 'ultimo-pastoreo' | 'clima';

export interface LoteOrdenado {
  loteId: string;
  numero: number;
  posicion: number;
  grupo: GrupoOrden;
  etapa: Etapa | null;
  etapaEsMinimo: boolean;
  /** Para un lote listo: cuántos días faltan para que pase su punto; null si no pasa dentro del pronóstico. */
  diasHastaPasado: number | null;
  progresoRebrote: number | null;
  /** Para un lote rebrotando: el día más temprano en que estaría listo (ISO); null si no se puede decir. */
  listoEl: string | null;
  pastoEnPieKgMsHa: number | null;
  consumibleKgMsHa: number | null;
  pisoPesado: boolean;
  /** Qué tan firme es la etapa de hoy: baja si se cuenta desde el alta o con temperatura pronosticada. */
  confianza: Confianza | null;
  confianzaPastoEnPie: Confianza | null;
  falta: FaltaDelLote | null;
  motivos: string[];
}

function fecha(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

function kg(valor: number): string {
  return (Math.round(valor / 10) * 10).toLocaleString('es-AR');
}

/** Cuánto se puede confiar en la etapa: sólo media en el mejor caso, porque el criterio de la fuente es un rango. */
function confianzaEtapa(estimacion: EstimacionForraje): Confianza | null {
  const reingreso = estimacion.reingreso;
  const condicion = reingreso?.condicionHoy;
  if (!reingreso || !condicion) return null;
  return reingreso.esMinimo || condicion.climaUsado === 'pronostico' ? 'baja' : 'media';
}

export function evaluarLote(loteId: string, numero: number, estimacion: EstimacionForraje, piso: PisoDelLote, hoy: string): Omit<LoteOrdenado, 'posicion'> {
  const base = {
    loteId, numero, etapa: null, etapaEsMinimo: false, diasHastaPasado: null, progresoRebrote: null, listoEl: null,
    pastoEnPieKgMsHa: null, consumibleKgMsHa: null, pisoPesado: piso.pesado, confianza: null, confianzaPastoEnPie: null, falta: null,
  };
  if (estimacion.mensaje && !estimacion.reingreso) {
    // Sin la migración 015 el tipo también llega vacío, pero cargarlo no serviría.
    const sinPastura = estimacion.tipoPastura === null && !estimacion.mensaje.includes('migración');
    return { ...base, grupo: 'sin-datos', falta: sinPastura ? 'pastura' : null, motivos: [estimacion.mensaje] };
  }
  const deHoy = estimacion.dias.find((dia) => dia.fecha === hoy);
  if (!deHoy) return { ...base, grupo: 'sin-datos', falta: 'clima', motivos: ['No hay clima de hoy guardado: actualizá el clima del lote.'] };
  if (!deHoy.etapa) {
    // Con criterio de reingreso, lo único que deja un día sin etapa es una temperatura que falta.
    return {
      ...base, grupo: 'sin-datos', falta: estimacion.reingreso?.criterio ? 'clima' : null,
      motivos: [deHoy.motivoEtapa ?? estimacion.reingreso?.mensaje ?? 'No se puede estimar la etapa del pasto.'],
    };
  }

  const motivos: string[] = [];
  const etapa = deHoy.etapa;
  let diasHastaPasado: number | null = null;
  if (etapa === 'en-pastoreo') return { ...base, etapa, confianza: confianzaEtapa(estimacion), grupo: 'en-pastoreo', motivos: ['Hay animales en el lote.'] };

  if (etapa === 'listo') {
    const pasa = estimacion.dias.find((dia) => dia.fecha > hoy && dia.etapa === 'pasado');
    diasHastaPasado = pasa ? diasEntreFechas(hoy, pasa.fecha) : null;
    const ultimo = estimacion.dias.at(-1)?.fecha;
    motivos.push(pasa
      ? `Listo: pasa de su mejor momento en ${diasHastaPasado} ${diasHastaPasado === 1 ? 'día' : 'días'} (${fecha(pasa.fecha)}).`
      : `Listo, al menos hasta el ${ultimo ? fecha(ultimo) : 'último día con pronóstico'}.`);
  } else if (etapa === 'pasado') {
    motivos.push('Pasó su mejor momento: las hojas más viejas se empiezan a secar.');
  } else {
    const temprana = estimacion.reingreso?.fechaTemprana;
    motivos.push(`Rebrotando: ${Math.round((deHoy.progresoRebrote ?? 0) * 100)} % del estado foliar óptimo${temprana && temprana > hoy ? `; listo el ${fecha(temprana)}` : ''}.`);
  }
  const comun = {
    ...base,
    etapa,
    etapaEsMinimo: deHoy.etapaEsMinimo,
    diasHastaPasado,
    progresoRebrote: deHoy.progresoRebrote,
    listoEl: etapa === 'rebrotando' ? estimacion.reingreso?.fechaTemprana ?? null : null,
    pastoEnPieKgMsHa: deHoy.biomasaEnPieKgMsHa,
    consumibleKgMsHa: deHoy.consumibleKgMsHa,
    confianza: confianzaEtapa(estimacion),
    confianzaPastoEnPie: deHoy.biomasaConfianza,
    falta: deHoy.etapaEsMinimo ? 'ultimo-pastoreo' as const : null,
  };
  if (deHoy.etapaEsMinimo && etapa !== 'pasado') motivos.push('Sin pastoreos registrados: está como mínimo así de avanzado.');
  if (deHoy.consumibleKgMsHa !== null) motivos.push(`Unos ${kg(deHoy.consumibleKgMsHa)} kg MS/ha para comer.`);
  else if (deHoy.biomasaEnPieKgMsHa !== null) motivos.push(`Unos ${kg(deHoy.biomasaEnPieKgMsHa)} kg MS/ha en pie; ${deHoy.motivoConsumible ?? 'sin dato de cuánto se puede comer.'}`);

  if ((etapa === 'listo' || etapa === 'pasado') && piso.pesado) {
    return { ...comun, grupo: 'esperar-al-piso', motivos: [`Esperar al piso: ${piso.motivo ?? 'el piso está pesado'}.`, ...motivos] };
  }
  return { ...comun, grupo: etapa, motivos };
}

/** Un valor sin dato va al final de su grupo, en cualquier sentido. */
function compararNulos(a: number | null, b: number | null, sentido: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return sentido * (a - b);
}

function comparar(a: Omit<LoteOrdenado, 'posicion'>, b: Omit<LoteOrdenado, 'posicion'>): number {
  const grupo = ORDEN_GRUPOS.indexOf(a.grupo) - ORDEN_GRUPOS.indexOf(b.grupo);
  if (grupo) return grupo;
  let criterio = 0;
  // Más pasto primero: el que se puede comer y, mientras no haya remanente con
  // fuente, el que hay en pie.
  const masPasto = compararNulos(a.consumibleKgMsHa, b.consumibleKgMsHa, -1) || compararNulos(a.pastoEnPieKgMsHa, b.pastoEnPieKgMsHa, -1);
  // Listos: el que antes se pasa, primero; a igualdad, el que más pasto tiene.
  if (a.grupo === 'listo' || a.grupo === 'esperar-al-piso') criterio = compararNulos(a.diasHastaPasado, b.diasHastaPasado, 1) || masPasto;
  else if (a.grupo === 'pasado') criterio = masPasto;
  else if (a.grupo === 'rebrotando') criterio = compararNulos(a.progresoRebrote, b.progresoRebrote, -1);
  return criterio || a.numero - b.numero;
}

export function ordenarLotes(evaluados: Array<Omit<LoteOrdenado, 'posicion'>>): LoteOrdenado[] {
  return [...evaluados].sort(comparar).map((lote, indice) => ({ ...lote, posicion: indice + 1 }));
}

/**
 * Piso pesado si la consulta de clima reciente lo categoriza así o si la
 * última imagen óptica reciente marca agua libre o suelo anegado.
 */
async function pisosDeLotes(establecimientoId: string, hoy: string): Promise<Map<string, PisoDelLote>> {
  const [clima, optica] = await Promise.all([
    pool.query<{ lote_id: string; categoria: string | null; consulted_at: Date }>(
      `SELECT DISTINCT ON (c.lote_id) c.lote_id, c.categoria, c.consulted_at
         FROM consultas_clima c JOIN lotes l ON l.id = c.lote_id
        WHERE l.establecimiento_id = $1 AND l.deleted_at IS NULL AND l.activo = TRUE
        ORDER BY c.lote_id, c.consulted_at DESC, c.id`,
      [establecimientoId],
    ),
    pool.query<{ lote_id: string; observed_at: string; alertas: unknown }>(
      `SELECT DISTINCT ON (m.lote_id) m.lote_id, m.observed_at, m.alertas
         FROM mediciones_satelitales m JOIN lotes l ON l.id = m.lote_id
        WHERE l.establecimiento_id = $1 AND l.deleted_at IS NULL AND l.activo = TRUE AND m.fuente = 'sentinel-2'
        ORDER BY m.lote_id, m.observed_at DESC`,
      [establecimientoId],
    ),
  ]);
  const pisos = new Map<string, PisoDelLote>();
  const limiteClima = new Date(`${sumarDias(hoy, -DIAS_CLIMA_RECIENTE)}T00:00:00Z`);
  for (const fila of clima.rows) {
    if (fila.categoria === 'piso-pesado' && new Date(fila.consulted_at) >= limiteClima) {
      pisos.set(fila.lote_id, { pesado: true, motivo: 'el clima de los últimos días lo marca como piso pesado' });
    }
  }
  for (const fila of optica.rows) {
    if (pisos.has(fila.lote_id) || diasEntreFechas(fila.observed_at, hoy) > DIAS_OPTICA_RECIENTE) continue;
    const alertas = Array.isArray(fila.alertas) ? fila.alertas.map(String) : [];
    if (alertas.some((alerta) => ALERTA_AGUA.test(alerta))) {
      pisos.set(fila.lote_id, { pesado: true, motivo: `la imagen del ${fecha(fila.observed_at)} muestra agua libre o suelo anegado` });
    }
  }
  return pisos;
}

export async function obtenerOrdenPastoreo(establecimientoId: string, desde: string, hoy: string): Promise<{ hoy: string; leyenda: string; lotes: LoteOrdenado[] }> {
  const [estimaciones, pisos] = await Promise.all([obtenerEstimacionesForraje(establecimientoId, desde, hoy), pisosDeLotes(establecimientoId, hoy)]);
  const evaluados = estimaciones.map((item) => evaluarLote(item.loteId, item.numero, item.estimacion, pisos.get(item.loteId) ?? { pesado: false, motivo: null }, hoy));
  return { hoy, leyenda: LEYENDA_ORDEN, lotes: ordenarLotes(evaluados) };
}
