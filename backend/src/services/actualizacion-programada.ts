import { pool } from '../base-datos/pool.js';
import { analizadorSatelital } from '../copernicus/analizar.js';
import type { LoteSatelital } from '../copernicus/types.js';
import { esPolygonFeature } from '../geometria.js';
import { persistirConsultaClima } from './consultas-clima.js';
import { persistirResultadoSatelital } from './mediciones-satelitales.js';
import { openMeteo } from './open-meteo.js';

/**
 * Actualización programada de satélite y clima.
 *
 * Hasta ahora las observaciones sólo entraban cuando alguien abría la
 * aplicación y apretaba un botón, así que el historial de un lote tenía una o
 * dos fechas y todo lo que necesita una serie —la tendencia, la proyección— no
 * arrancaba. Esto la va llenando sola.
 *
 * Las reglas del proyecto siguen igual y por eso se reusan los mismos
 * servicios que usan los endpoints: sólo se persiste lo que Copernicus y
 * Open-Meteo devuelven de verdad, un `error` o un `sin-datos` no escribe nada,
 * y el reloj es el del servidor. No hay tablas nuevas.
 *
 * Es deliberadamente prudente con los servicios externos: procesa de a tandas
 * chicas, espera entre una y otra, y corta solo si Copernicus empieza a
 * rechazar todo, que es lo que pasa cuando se lo consulta muchas veces
 * seguidas. Correrlo dos veces seguidas no duplica nada: el filtro por
 * antigüedad deja afuera lo que se acaba de consultar.
 */

export interface OpcionesActualizacion {
  /** No reconsultar un lote cuya última observación óptica sea más nueva que esto. */
  horasSatelite?: number;
  /** Ídem para el clima. */
  horasClima?: number;
  /** Techo de lotes por corrida, para que una corrida no se lleve la cuota. */
  maxLotes?: number;
  /** Cuántos lotes por tanda. */
  tamanoTanda?: number;
  /** Pausa entre tandas, en milisegundos. */
  pausaMs?: number;
  ahora?: Date;
}

export interface ResumenParcial {
  pendientes: number;
  consultados: number;
  persistidos: number;
  sinDatos: number;
  errores: number;
  cortado: boolean;
}

export interface ResumenActualizacion {
  comenzoEn: string;
  terminoEn: string;
  satelite: ResumenParcial;
  clima: ResumenParcial;
}

/** Lo que la rutina necesita del mundo; los tests le pasan otra cosa. */
export interface DependenciasActualizacion {
  lotesPendientesSatelite(horas: number, limite: number, ahora: Date): Promise<LoteSatelital[]>;
  lotesPendientesClima(horas: number, limite: number, ahora: Date): Promise<LoteSatelital[]>;
  analizarSatelite: typeof analizadorSatelital.analizarLotes;
  persistirSatelite: typeof persistirResultadoSatelital;
  consultarClima: typeof openMeteo.consultar;
  persistirClima: typeof persistirConsultaClima;
  dormir(ms: number): Promise<void>;
  registrar(evento: Record<string, unknown>): void;
}

export const HORAS_SATELITE = 24;
export const HORAS_CLIMA = 6;
export const MAX_LOTES = 40;
export const TAMANO_TANDA = 5;
export const PAUSA_MS = 2_000;
/** Tandas seguidas fallando entero antes de cortar: es un límite de cuota, no mala suerte. */
const TANDAS_FALLIDAS_PARA_CORTAR = 3;

async function lotesPendientes(tabla: 'mediciones_satelitales' | 'consultas_clima', horas: number, limite: number, ahora: Date): Promise<LoteSatelital[]> {
  // Los más viejos primero, y los que nunca se consultaron antes que todos: así
  // una corrida corta igual avanza sobre lo que más lo necesita.
  const filtro = tabla === 'mediciones_satelitales' ? "AND h.fuente = 'sentinel-2'" : '';
  const result = await pool.query<{ id: string; polygon: unknown }>(
    `SELECT l.id, l.polygon
       FROM lotes l
       LEFT JOIN LATERAL (
         SELECT MAX(h.consulted_at) AS ultima FROM ${tabla} h WHERE h.lote_id = l.id ${filtro}
       ) u ON TRUE
      WHERE l.deleted_at IS NULL AND l.activo = TRUE
        AND (u.ultima IS NULL OR u.ultima < $1::timestamptz - ($2 || ' hours')::interval)
      ORDER BY u.ultima ASC NULLS FIRST, l.id ASC
      LIMIT $3`,
    [ahora, String(horas), limite],
  );
  return result.rows
    .filter((row): row is { id: string; polygon: LoteSatelital['polygon'] } => esPolygonFeature(row.polygon))
    .map((row) => ({ id: row.id, polygon: row.polygon }));
}

const dependenciasReales: DependenciasActualizacion = {
  lotesPendientesSatelite: (horas, limite, ahora) => lotesPendientes('mediciones_satelitales', horas, limite, ahora),
  lotesPendientesClima: (horas, limite, ahora) => lotesPendientes('consultas_clima', horas, limite, ahora),
  analizarSatelite: (lotes, referencia) => analizadorSatelital.analizarLotes(lotes, referencia),
  persistirSatelite: persistirResultadoSatelital,
  consultarClima: (lotes, referencia) => openMeteo.consultar(lotes, referencia),
  persistirClima: persistirConsultaClima,
  dormir: (ms) => new Promise((listo) => { setTimeout(listo, ms); }),
  registrar: (evento) => { console.log(JSON.stringify(evento)); },
};

function tandas<T>(items: T[], tamano: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, tamano)) salida.push(items.slice(i, i + Math.max(1, tamano)));
  return salida;
}

function resumenVacio(pendientes: number): ResumenParcial {
  return { pendientes, consultados: 0, persistidos: 0, sinDatos: 0, errores: 0, cortado: false };
}

async function actualizarSatelite(
  deps: DependenciasActualizacion,
  opciones: Required<Pick<OpcionesActualizacion, 'horasSatelite' | 'maxLotes' | 'tamanoTanda' | 'pausaMs'>>,
  ahora: Date,
): Promise<ResumenParcial> {
  const lotes = await deps.lotesPendientesSatelite(opciones.horasSatelite, opciones.maxLotes, ahora);
  const resumen = resumenVacio(lotes.length);
  let fallidasSeguidas = 0;

  for (const tanda of tandas(lotes, opciones.tamanoTanda)) {
    const resultados = await deps.analizarSatelite(tanda, new Date());
    let errores = 0;
    for (const resultado of resultados) {
      resumen.consultados += 1;
      if (resultado.estado === 'error') { resumen.errores += 1; errores += 1; continue; }
      if (resultado.estado === 'sin-datos') { resumen.sinDatos += 1; continue; }
      try {
        await deps.persistirSatelite(resultado, new Date());
        resumen.persistidos += 1;
      } catch (error) {
        resumen.errores += 1;
        deps.registrar({ evento: 'satelite_no_persistido', loteId: resultado.loteId, detalle: String(error) });
      }
    }
    // Una tanda entera en error es el síntoma del límite de consultas de
    // Copernicus. Insistir sólo gasta cuota y ensucia el log.
    fallidasSeguidas = errores === resultados.length && resultados.length > 0 ? fallidasSeguidas + 1 : 0;
    if (fallidasSeguidas >= TANDAS_FALLIDAS_PARA_CORTAR) {
      resumen.cortado = true;
      deps.registrar({ evento: 'satelite_cortado', motivo: 'tandas seguidas con error, probable límite de consultas' });
      break;
    }
    await deps.dormir(opciones.pausaMs);
  }
  return resumen;
}

async function actualizarClima(
  deps: DependenciasActualizacion,
  opciones: Required<Pick<OpcionesActualizacion, 'horasClima' | 'maxLotes' | 'tamanoTanda' | 'pausaMs'>>,
  ahora: Date,
): Promise<ResumenParcial> {
  const lotes = await deps.lotesPendientesClima(opciones.horasClima, opciones.maxLotes, ahora);
  const resumen = resumenVacio(lotes.length);

  for (const tanda of tandas(lotes, opciones.tamanoTanda)) {
    const referencia = new Date();
    const resultados = await deps.consultarClima(tanda, referencia);
    for (const lote of tanda) {
      const resultado = resultados[lote.id];
      resumen.consultados += 1;
      if (!resultado || resultado.estado === 'error') { resumen.errores += 1; continue; }
      try {
        // Origen `automatico`: el servicio ya descarta una consulta repetida
        // dentro de la hora, así que dos corridas seguidas no duplican historial.
        const persistencia = await deps.persistirClima(resultado, 'automatico', referencia);
        if (persistencia.guardado) resumen.persistidos += 1; else resumen.sinDatos += 1;
      } catch (error) {
        resumen.errores += 1;
        deps.registrar({ evento: 'clima_no_persistido', loteId: lote.id, detalle: String(error) });
      }
    }
    await deps.dormir(opciones.pausaMs);
  }
  return resumen;
}

export async function actualizarLotesPendientes(
  opciones: OpcionesActualizacion = {},
  deps: DependenciasActualizacion = dependenciasReales,
): Promise<ResumenActualizacion> {
  const ahora = opciones.ahora ?? new Date();
  const comunes = {
    maxLotes: opciones.maxLotes ?? MAX_LOTES,
    tamanoTanda: opciones.tamanoTanda ?? TAMANO_TANDA,
    pausaMs: opciones.pausaMs ?? PAUSA_MS,
  };

  const satelite = await actualizarSatelite(deps, { ...comunes, horasSatelite: opciones.horasSatelite ?? HORAS_SATELITE }, ahora);
  const clima = await actualizarClima(deps, { ...comunes, horasClima: opciones.horasClima ?? HORAS_CLIMA }, ahora);

  return {
    comenzoEn: ahora.toISOString(),
    terminoEn: new Date().toISOString(),
    satelite,
    clima,
  };
}
