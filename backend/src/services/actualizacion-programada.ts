import { pool } from '../base-datos/pool.js';
import { analizadorSatelital } from '../copernicus/analizar.js';
import type { LoteSatelital, ResultadoLote } from '../copernicus/types.js';
import { esPolygonFeature } from '../geometria.js';
import { completarClimaHistorico, type OpcionesClimaHistorico, type ResumenClimaHistorico } from './clima-historico.js';
import { persistirConsultaClima } from './consultas-clima.js';
import { persistirResultadoSatelital } from './mediciones-satelitales.js';
import { openMeteo } from './open-meteo.js';
import { evaluarDatosOpticosDesactualizados, idEjecucionProgramada, registrarResultadoProveedor, type ProveedorActualizacion } from './incidencias-automaticas.js';

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
 * y el reloj es el del servidor. Al final completa el clima histórico que le
 * falte a la estimación de forraje, en su propia tabla (migración 016).
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
  /** Techo independiente para clima y su relleno histórico. */
  maxLotesClima?: number;
  /** Cuántos lotes por tanda. */
  tamanoTanda?: number;
  /** Pausa entre tandas, en milisegundos. */
  pausaMs?: number;
  ahora?: Date;
  /** Identificador estable por intento; Actions lo usa para deduplicar reintentos. */
  ejecucionId?: string;
  /** Acota la corrida a un establecimiento; sin esto recorre todos, como la rutina diaria. */
  establecimientoId?: string;
  /**
   * Tiempo máximo de la corrida. Al pasarse, corta entre tandas y deja el resto
   * para la próxima; lo consultado hasta ahí ya quedó guardado.
   *
   * Lo necesita la corrida que se dispara al abrir la aplicación, que ocurre
   * dentro de un request con alguien esperando: 160 lotes de clima en tandas de
   * 5 con pausas tardan minutos y el servidor corta el request a los 90 s, así
   * que sin esto la actualización no terminaba nunca y la pantalla se quedaba
   * esperando. La rutina diaria no pasa este límite y recorre todo.
   */
  limiteMs?: number;
}

export interface ResumenParcial {
  pendientes: number;
  consultados: number;
  persistidos: number;
  sinDatos: number;
  errores: number;
  fallosProveedor: number;
  erroresPersistencia: number;
  cortado: boolean;
  motivoCorte?: string;
}

export interface ResumenActualizacion {
  comenzoEn: string;
  terminoEn: string;
  satelite: ResumenParcial;
  clima: ResumenParcial;
  /** Días históricos que faltaban para la estimación de forraje; ausente si no se corrió. */
  climaHistorico?: ResumenClimaHistorico;
}

/** Lo que la rutina necesita del mundo; los tests le pasan otra cosa. */
export interface DependenciasActualizacion {
  lotesPendientesSatelite(horas: number, limite: number, ahora: Date, establecimientoId?: string): Promise<LoteSatelital[]>;
  lotesPendientesClima(horas: number, limite: number, ahora: Date, establecimientoId?: string): Promise<LoteSatelital[]>;
  analizarSatelite: typeof analizadorSatelital.analizarLotes;
  persistirSatelite: typeof persistirResultadoSatelital;
  consultarClima: typeof openMeteo.consultar;
  persistirClima: typeof persistirConsultaClima;
  dormir(ms: number): Promise<void>;
  registrar(evento: Record<string, unknown>): void;
  registrarResultadoProveedor?(establecimientoId: string, proveedor: ProveedorActualizacion, ejecucionId: string, falloTecnico: boolean): Promise<void>;
  evaluarIncidenciasOpticas?(ahora: Date): Promise<void>;
  completarClimaHistorico?(opciones: OpcionesClimaHistorico): Promise<ResumenClimaHistorico>;
}

export const HORAS_SATELITE = 24;
export const HORAS_CLIMA = 6;
export const MAX_LOTES = 40;
/** Cubre los 153 lotes actuales en una corrida diaria, con margen para crecer. */
export const MAX_LOTES_CLIMA = 160;
export const TAMANO_TANDA = 5;
export const PAUSA_MS = 2_000;
/** Evita que un establecimiento con un fallo persistente monopolice la cola diaria. */
export const HORAS_ESPERA_TRAS_FALLO = 36;
/** Tandas seguidas fallando entero antes de cortar: es un límite de cuota, no mala suerte. */
const TANDAS_FALLIDAS_PARA_CORTAR = 3;

export async function lotesPendientes(tabla: 'mediciones_satelitales' | 'consultas_clima', horas: number, limite: number, ahora: Date, establecimientoId?: string): Promise<LoteSatelital[]> {
  // Los más viejos primero, y los que nunca se consultaron antes que todos: así
  // una corrida corta igual avanza sobre lo que más lo necesita.
  const filtro = tabla === 'mediciones_satelitales' ? "AND h.fuente = 'sentinel-2'" : '';
  // Acotar a un establecimiento es lo que permite reusar esta misma cola cuando
  // alguien abre su campo, sin consultar los lotes de los demás.
  const porEstablecimiento = establecimientoId ? 'AND l.establecimiento_id = $6' : '';
  const result = await pool.query<{ id: string; polygon: unknown; establecimiento_id: string }>(
    `SELECT l.id, l.polygon, l.establecimiento_id
       FROM lotes l
       LEFT JOIN LATERAL (
         SELECT MAX(h.consulted_at) AS ultima FROM ${tabla} h WHERE h.lote_id = l.id ${filtro}
       ) u ON TRUE
      WHERE l.deleted_at IS NULL AND l.activo = TRUE
        ${porEstablecimiento}
        AND (u.ultima IS NULL OR u.ultima < $1::timestamptz - ($2 || ' hours')::interval)
        AND NOT EXISTS (
          SELECT 1 FROM estado_fallos_actualizacion f
           WHERE f.establecimiento_id = l.establecimiento_id
             AND f.proveedor = $4
             AND f.fallos_consecutivos > 0
             AND f.actualizado_en > $1::timestamptz - ($5 || ' hours')::interval
        )
      ORDER BY u.ultima ASC NULLS FIRST, l.id ASC
      LIMIT $3`,
    [ahora, String(horas), limite, tabla === 'mediciones_satelitales' ? 'copernicus' : 'open_meteo', String(HORAS_ESPERA_TRAS_FALLO),
      ...(establecimientoId ? [establecimientoId] : [])],
  );
  return result.rows
    .filter((row): row is { id: string; polygon: LoteSatelital['polygon']; establecimiento_id: string } => esPolygonFeature(row.polygon))
    .map((row) => ({ id: row.id, polygon: row.polygon, establecimientoId: row.establecimiento_id }));
}

const dependenciasReales: DependenciasActualizacion = {
  lotesPendientesSatelite: (horas, limite, ahora, establecimientoId) => lotesPendientes('mediciones_satelitales', horas, limite, ahora, establecimientoId),
  lotesPendientesClima: (horas, limite, ahora, establecimientoId) => lotesPendientes('consultas_clima', horas, limite, ahora, establecimientoId),
  analizarSatelite: (lotes, referencia) => analizadorSatelital.analizarLotes(lotes, referencia),
  persistirSatelite: persistirResultadoSatelital,
  consultarClima: (lotes, referencia) => openMeteo.consultar(lotes, referencia),
  persistirClima: persistirConsultaClima,
  dormir: (ms) => new Promise((listo) => { setTimeout(listo, ms); }),
  registrar: (evento) => { console.log(JSON.stringify(evento)); },
  registrarResultadoProveedor,
  evaluarIncidenciasOpticas: evaluarDatosOpticosDesactualizados,
  completarClimaHistorico: (opciones) => completarClimaHistorico(opciones),
};

function tandas<T>(items: T[], tamano: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, tamano)) salida.push(items.slice(i, i + Math.max(1, tamano)));
  return salida;
}

/** Sin límite, nunca vence: la rutina diaria recorre todo lo que haya. */
function seVencio(limiteMs: number | undefined, inicioMs: number): boolean {
  return limiteMs !== undefined && Date.now() - inicioMs >= limiteMs;
}

function resumenVacio(pendientes: number): ResumenParcial {
  return { pendientes, consultados: 0, persistidos: 0, sinDatos: 0, errores: 0, fallosProveedor: 0, erroresPersistencia: 0, cortado: false };
}

async function actualizarSatelite(
  deps: DependenciasActualizacion,
  opciones: Required<Pick<OpcionesActualizacion, 'horasSatelite' | 'maxLotes' | 'tamanoTanda' | 'pausaMs'>> & Pick<OpcionesActualizacion, 'establecimientoId' | 'limiteMs'>,
  ahora: Date,
  ejecucionId: string,
): Promise<ResumenParcial> {
  const inicioMs = Date.now();
  const lotes = await deps.lotesPendientesSatelite(opciones.horasSatelite, opciones.maxLotes, ahora, opciones.establecimientoId);
  const resumen = resumenVacio(lotes.length);
  let fallidasSeguidas = 0;
  const resultadoPorEstablecimiento = new Map<string, { intentos: number; fallos: number }>();
  const registrarResultado = (establecimientoId: string | undefined, fallo: boolean) => {
    if (!establecimientoId) return;
    const actual = resultadoPorEstablecimiento.get(establecimientoId) ?? { intentos: 0, fallos: 0 };
    actual.intentos += 1;
    if (fallo) actual.fallos += 1;
    resultadoPorEstablecimiento.set(establecimientoId, actual);
  };

  for (const tanda of tandas(lotes, opciones.tamanoTanda)) {
    if (seVencio(opciones.limiteMs, inicioMs)) { resumen.cortado = true; break; }
    let resultados: ResultadoLote[];
    try {
      resultados = await deps.analizarSatelite(tanda, new Date());
    } catch (error) {
      resumen.consultados += tanda.length;
      resumen.errores += tanda.length;
      resumen.fallosProveedor += tanda.length;
      for (const lote of tanda) registrarResultado(lote.establecimientoId, true);
      deps.registrar({ evento: 'satelite_consulta_fallida', detalle: String(error) });
      fallidasSeguidas += 1;
      if (fallidasSeguidas >= TANDAS_FALLIDAS_PARA_CORTAR) { resumen.cortado = true; break; }
      await deps.dormir(opciones.pausaMs);
      continue;
    }
    let errores = 0;
    let limiteCopernicus = false;
    for (const resultado of resultados) {
      resumen.consultados += 1;
      limiteCopernicus ||= Boolean(resultado.limiteCopernicus);
      const lote = tanda.find((item) => item.id === resultado.loteId);
      if (resultado.estado === 'error') {
        const esLimite = Boolean(resultado.limiteCopernicus) || /(?:HTTP\s*)?429|rate limit|rate_limit_exceeded/i.test(resultado.mensaje);
        limiteCopernicus ||= esLimite;
        resumen.errores += 1; resumen.fallosProveedor += 1; errores += 1;
        // Un límite global temporal o una cuota no es una falla propia del
        // establecimiento y no debe sacarlo de la cola por 36 horas.
        registrarResultado(lote?.establecimientoId, !esLimite);
        deps.registrar({ evento: 'satelite_consulta_error', loteId: resultado.loteId, detalle: resultado.mensaje });
        continue;
      }
      if (resultado.estado === 'sin-datos') { resumen.sinDatos += 1; registrarResultado(lote?.establecimientoId, false); continue; }
      registrarResultado(lote?.establecimientoId, false);
      try {
        await deps.persistirSatelite(resultado, new Date());
        resumen.persistidos += 1;
      } catch (error) {
        resumen.errores += 1;
        resumen.erroresPersistencia += 1;
        deps.registrar({ evento: 'satelite_no_persistido', loteId: resultado.loteId, detalle: String(error) });
      }
    }
    if (limiteCopernicus) {
      resumen.cortado = true;
      resumen.motivoCorte = 'Copernicus agotó los reintentos recuperables o indicó una cuota no disponible; se omitieron las consultas satelitales restantes.';
      deps.registrar({ evento: 'satelite_cortado', motivo: resumen.motivoCorte });
      break;
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
  if (deps.registrarResultadoProveedor) {
    for (const [establecimientoId, resultado] of resultadoPorEstablecimiento) {
      await deps.registrarResultadoProveedor(establecimientoId, 'copernicus', ejecucionId,
        resultado.intentos > 0 && resultado.fallos > 0);
    }
  }
  return resumen;
}

async function actualizarClima(
  deps: DependenciasActualizacion,
  opciones: Required<Pick<OpcionesActualizacion, 'horasClima' | 'maxLotes' | 'maxLotesClima' | 'tamanoTanda' | 'pausaMs'>> & Pick<OpcionesActualizacion, 'establecimientoId' | 'limiteMs'>,
  ahora: Date,
  ejecucionId: string,
): Promise<ResumenParcial> {
  const inicioMs = Date.now();
  const lotes = await deps.lotesPendientesClima(opciones.horasClima, opciones.maxLotesClima, ahora, opciones.establecimientoId);
  const resumen = resumenVacio(lotes.length);
  const resultadoPorEstablecimiento = new Map<string, { intentos: number; fallos: number }>();

  for (const tanda of tandas(lotes, opciones.tamanoTanda)) {
    if (seVencio(opciones.limiteMs, inicioMs)) { resumen.cortado = true; break; }
    const referencia = new Date();
    let resultados: Awaited<ReturnType<DependenciasActualizacion['consultarClima']>>;
    try {
      resultados = await deps.consultarClima(tanda, referencia);
    } catch (error) {
      resumen.consultados += tanda.length;
      resumen.errores += tanda.length;
      resumen.fallosProveedor += tanda.length;
      for (const lote of tanda) {
        if (!lote.establecimientoId) continue;
        const actual = resultadoPorEstablecimiento.get(lote.establecimientoId) ?? { intentos: 0, fallos: 0 };
        actual.intentos += 1; actual.fallos += 1; resultadoPorEstablecimiento.set(lote.establecimientoId, actual);
      }
      deps.registrar({ evento: 'clima_consulta_fallida', detalle: String(error) });
      await deps.dormir(opciones.pausaMs);
      continue;
    }
    for (const lote of tanda) {
      const resultado = resultados[lote.id];
      resumen.consultados += 1;
      if (resultado?.estado === 'error' && /sin datos de open-meteo/i.test(resultado.mensaje)) {
        resumen.sinDatos += 1;
        if (lote.establecimientoId) {
          const actual = resultadoPorEstablecimiento.get(lote.establecimientoId) ?? { intentos: 0, fallos: 0 };
          actual.intentos += 1;
          resultadoPorEstablecimiento.set(lote.establecimientoId, actual);
        }
        continue;
      }
      const falloProveedor = !resultado || resultado.estado === 'error';
      if (lote.establecimientoId) {
        const actual = resultadoPorEstablecimiento.get(lote.establecimientoId) ?? { intentos: 0, fallos: 0 };
        actual.intentos += 1; if (falloProveedor) actual.fallos += 1;
        resultadoPorEstablecimiento.set(lote.establecimientoId, actual);
      }
      if (falloProveedor) {
        resumen.errores += 1; resumen.fallosProveedor += 1;
        deps.registrar({ evento: 'clima_consulta_error', loteId: lote.id, detalle: resultado?.estado === 'error' ? resultado.mensaje : 'Open-Meteo no devolvió resultado para el lote.' });
        continue;
      }
      try {
        // Origen `automatico`: el servicio ya descarta una consulta repetida
        // dentro de la hora, así que dos corridas seguidas no duplican historial.
        const persistencia = await deps.persistirClima(resultado, 'automatico', referencia);
        if (persistencia.guardado) resumen.persistidos += 1; else resumen.sinDatos += 1;
      } catch (error) {
        resumen.errores += 1;
        resumen.erroresPersistencia += 1;
        deps.registrar({ evento: 'clima_no_persistido', loteId: lote.id, detalle: String(error) });
      }
    }
    await deps.dormir(opciones.pausaMs);
  }
  if (deps.registrarResultadoProveedor) {
    for (const [establecimientoId, resultado] of resultadoPorEstablecimiento) {
      await deps.registrarResultadoProveedor(establecimientoId, 'open_meteo', ejecucionId,
        resultado.intentos > 0 && resultado.fallos > 0);
    }
  }
  return resumen;
}

export async function actualizarLotesPendientes(
  opciones: OpcionesActualizacion = {},
  deps: DependenciasActualizacion = dependenciasReales,
): Promise<ResumenActualizacion> {
  const ahora = opciones.ahora ?? new Date();
  const inicioMs = Date.now();
  const comunes = {
    maxLotes: opciones.maxLotes ?? MAX_LOTES,
    tamanoTanda: opciones.tamanoTanda ?? TAMANO_TANDA,
    pausaMs: opciones.pausaMs ?? PAUSA_MS,
    establecimientoId: opciones.establecimientoId,
    limiteMs: opciones.limiteMs,
  };
  const limiteClima = opciones.maxLotesClima ?? opciones.maxLotes ?? MAX_LOTES_CLIMA;

  const ejecucionId = opciones.ejecucionId ?? idEjecucionProgramada();
  const satelite = await actualizarSatelite(deps, { ...comunes, horasSatelite: opciones.horasSatelite ?? HORAS_SATELITE }, ahora, ejecucionId);
  const clima = await actualizarClima(deps, { ...comunes, maxLotes: limiteClima, maxLotesClima: limiteClima, horasClima: opciones.horasClima ?? HORAS_CLIMA }, ahora, ejecucionId);
  // Después del clima regular, para que lo recién consultado ya cuente como cubierto.
  // Un fallo acá no invalida lo anterior: queda en el log y se reintenta mañana.
  // El relleno histórico es trabajo de fondo y puede tardar: con un límite de
  // tiempo ya agotado se deja para la rutina diaria.
  let climaHistorico: ResumenClimaHistorico | undefined;
  if (deps.completarClimaHistorico && !seVencio(opciones.limiteMs, inicioMs)) {
    try {
      climaHistorico = await deps.completarClimaHistorico({ ...comunes, maxLotes: limiteClima, referencia: new Date() });
    } catch (error) {
      deps.registrar({ evento: 'clima_historico_fallido', detalle: String(error) });
      climaHistorico = { disponible: false, pendientes: 0, consultados: 0, lotesCompletados: 0, diasGuardados: 0, errores: 1, cortado: false };
    }
  }
  await deps.evaluarIncidenciasOpticas?.(ahora);

  return {
    comenzoEn: ahora.toISOString(),
    terminoEn: new Date().toISOString(),
    satelite,
    clima,
    ...(climaHistorico ? { climaHistorico } : {}),
  };
}

/** Un paso con errores o cortado debe hacer fallar el job del planificador. */
export function actualizacionNecesitaReintento(resumen: ResumenActualizacion): boolean {
  if ([resumen.satelite, resumen.clima].some((parcial) => parcial.errores > 0 || parcial.cortado)) return true;
  return Boolean(resumen.climaHistorico && (!resumen.climaHistorico.disponible || resumen.climaHistorico.errores > 0 || resumen.climaHistorico.cortado));
}
