import { ApiError } from '../http/errors.js';
import { copernicus, type RespuestaCopernicus } from '../services/copernicus.js';
import { EVALSCRIPT_INDICES, EVALSCRIPT_RADAR } from './evalscript.js';
import { calcularProyeccion } from './proyeccion.js';
import { calcularPuntaje, categorizar, generarAlertas } from './scoring.js';
import type {
  CondicionRadar,
  EstadisticaIndice,
  IntervaloEstadisticas,
  LoteSatelital,
  RespuestaEstadisticas,
  ResultadoLote,
  StatsCrudas,
} from './types.js';

export const DIAS_VENTANA = 45;
export const RESOLUCION_GRADOS = 0.0002;
export const COBERTURA_MINIMA = 0.35;
export const FECHAS_TENDENCIA = 6;
export const CONCURRENCIA = 2;
export const DIAS_VENTANA_RADAR = 20;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface GatewayEstadisticas {
  obtenerEstadisticas(cuerpo: string): Promise<RespuestaCopernicus>;
}

export function medianocheUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function cuerpoPeticion(lote: LoteSatelital, desde: Date, hasta: Date): string {
  return JSON.stringify({
    input: {
      bounds: {
        geometry: lote.polygon.geometry,
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
    },
    aggregation: {
      timeRange: { from: desde.toISOString(), to: hasta.toISOString() },
      aggregationInterval: { of: 'P1D' },
      resx: RESOLUCION_GRADOS,
      resy: RESOLUCION_GRADOS,
      evalscript: EVALSCRIPT_INDICES,
    },
    calculations: { default: { statistics: { default: { percentiles: { k: [50] } } } } },
  });
}

export function cuerpoPeticionRadar(lote: LoteSatelital, desde: Date, hasta: Date): string {
  return JSON.stringify({
    input: {
      bounds: {
        geometry: lote.polygon.geometry,
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{ type: 'sentinel-1-grd' }],
    },
    aggregation: {
      timeRange: { from: desde.toISOString(), to: hasta.toISOString() },
      aggregationInterval: { of: 'P1D' },
      resx: RESOLUCION_GRADOS,
      resy: RESOLUCION_GRADOS,
      evalscript: EVALSCRIPT_RADAR,
    },
    calculations: { default: { statistics: { default: { percentiles: { k: [50] } } } } },
  });
}

function aNumero(valor: unknown): number | null {
  const numero = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function leerPercentil(stats: StatsCrudas, k: number): number | null {
  const p = stats.percentiles;
  if (!p) return null;
  const clave = Object.keys(p).find((item) => Number(item) === k);
  return clave === undefined ? null : aNumero(p[clave]);
}

function aEstadistica(stats: StatsCrudas): EstadisticaIndice | null {
  const media = aNumero(stats.mean);
  const desvio = aNumero(stats.stDev);
  const min = aNumero(stats.min);
  const max = aNumero(stats.max);
  if (media === null || desvio === null || min === null || max === null) return null;
  return { media, mediana: leerPercentil(stats, 50) ?? media, min, max, desvio };
}

function extraerSalida(intervalo: IntervaloEstadisticas, id: string): StatsCrudas | null {
  const bandas = intervalo.outputs?.[id]?.bands;
  if (!bandas) return null;
  return Object.values(bandas)[0]?.stats ?? null;
}

interface Observacion {
  fecha: string;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
  evi: EstadisticaIndice;
}

export function aObservacion(intervalo: IntervaloEstadisticas): Observacion | null {
  if (intervalo.error) return null;
  const crudas = {
    ndvi: extraerSalida(intervalo, 'ndvi'),
    ndmi: extraerSalida(intervalo, 'ndmi'),
    ndwi: extraerSalida(intervalo, 'ndwi'),
    evi: extraerSalida(intervalo, 'evi'),
  };
  if (!crudas.ndvi || !crudas.ndmi || !crudas.ndwi || !crudas.evi) return null;
  const total = crudas.ndvi.sampleCount;
  if (total <= 0) return null;
  const coberturaValida = (total - crudas.ndvi.noDataCount) / total;
  if (coberturaValida < COBERTURA_MINIMA) return null;
  const ndvi = aEstadistica(crudas.ndvi);
  const ndmi = aEstadistica(crudas.ndmi);
  const ndwi = aEstadistica(crudas.ndwi);
  const evi = aEstadistica(crudas.evi);
  if (!ndvi || !ndmi || !ndwi || !evi) return null;
  return { fecha: intervalo.interval.from.slice(0, 10), coberturaValida, ndvi, ndmi, ndwi, evi };
}

interface ObservacionRadar { fecha: string; coberturaValida: number; rvi: EstadisticaIndice }

export function aObservacionRadar(intervalo: IntervaloEstadisticas): ObservacionRadar | null {
  if (intervalo.error) return null;
  const crudas = extraerSalida(intervalo, 'rvi');
  if (!crudas) return null;
  const total = crudas.sampleCount;
  if (total <= 0) return null;
  const coberturaValida = (total - crudas.noDataCount) / total;
  if (coberturaValida < COBERTURA_MINIMA) return null;
  const rvi = aEstadistica(crudas);
  return rvi ? { fecha: intervalo.interval.from.slice(0, 10), coberturaValida, rvi } : null;
}

function mensajeDeError(estado: number, texto: string): string {
  try {
    const json = JSON.parse(texto) as { error?: string | { message?: string } };
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch { /* respuesta no JSON */ }
  if (estado === 429) return 'Copernicus está limitando las consultas (429). Esperá un minuto y volvé a intentar.';
  return `Copernicus respondió HTTP ${estado}.`;
}

function mensajeExcepcion(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'No se pudo contactar a Copernicus.';
}

export class AnalizadorSatelital {
  constructor(private gateway: GatewayEstadisticas = copernicus) {}

  reemplazarGateway(gateway: GatewayEstadisticas): GatewayEstadisticas {
    const anterior = this.gateway;
    this.gateway = gateway;
    return anterior;
  }

  async consultarOptico(lote: LoteSatelital, ahora: Date): Promise<ResultadoLote> {
    const medianoche = medianocheUTC(ahora);
    const hasta = new Date(medianoche.getTime() + MS_POR_DIA);
    const desde = new Date(medianoche.getTime() - DIAS_VENTANA * MS_POR_DIA);
    let respuestaHttp: RespuestaCopernicus;
    try {
      respuestaHttp = await this.gateway.obtenerEstadisticas(cuerpoPeticion(lote, desde, hasta));
    } catch (error) {
      return { estado: 'error', loteId: lote.id, mensaje: mensajeExcepcion(error) };
    }
    if (respuestaHttp.status < 200 || respuestaHttp.status >= 300) {
      return { estado: 'error', loteId: lote.id, mensaje: mensajeDeError(respuestaHttp.status, respuestaHttp.texto) };
    }
    let respuesta: RespuestaEstadisticas;
    try { respuesta = JSON.parse(respuestaHttp.texto) as RespuestaEstadisticas; }
    catch { return { estado: 'error', loteId: lote.id, mensaje: 'Copernicus devolvió una respuesta que no se pudo interpretar.' }; }
    const observaciones = (respuesta.data ?? []).map(aObservacion).filter((item): item is Observacion => item !== null).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (observaciones.length === 0) return { estado: 'sin-datos', loteId: lote.id, mensaje: `Sin imágenes despejadas en los últimos ${DIAS_VENTANA} días.` };
    const ultima = observaciones[observaciones.length - 1];
    const diasDesde = Math.max(0, Math.floor((ahora.getTime() - new Date(`${ultima.fecha}T12:00:00Z`).getTime()) / MS_POR_DIA));
    const puntaje = calcularPuntaje(ultima.ndvi, ultima.ndmi, ultima.ndwi, ultima.evi);
    const tendencia = observaciones.slice(-FECHAS_TENDENCIA).map((item) => ({ fecha: item.fecha, ndvi: item.ndvi.mediana, ndmi: item.ndmi.media, ndwi: item.ndwi.media, evi: item.evi.media }));
    const proyeccion = calcularProyeccion(tendencia);
    return {
      estado: 'ok',
      loteId: lote.id,
      condicion: {
        fecha: ultima.fecha,
        diasDesde,
        coberturaValida: ultima.coberturaValida,
        ndvi: ultima.ndvi,
        ndmi: ultima.ndmi,
        ndwi: ultima.ndwi,
        evi: ultima.evi,
        puntaje,
        categoria: categorizar(puntaje),
        alertas: generarAlertas({ diasDesde, coberturaValida: ultima.coberturaValida, ndvi: ultima.ndvi, ndmi: ultima.ndmi, ndwi: ultima.ndwi }),
        tendencia,
        ...(proyeccion ? { proyeccion } : {}),
      },
    };
  }

  async consultarRadar(lote: LoteSatelital, ahora: Date): Promise<CondicionRadar | null> {
    const medianoche = medianocheUTC(ahora);
    const hasta = new Date(medianoche.getTime() + MS_POR_DIA);
    const desde = new Date(medianoche.getTime() - DIAS_VENTANA_RADAR * MS_POR_DIA);
    let respuestaHttp: RespuestaCopernicus;
    try { respuestaHttp = await this.gateway.obtenerEstadisticas(cuerpoPeticionRadar(lote, desde, hasta)); }
    catch { return null; }
    if (respuestaHttp.status < 200 || respuestaHttp.status >= 300) return null;
    let respuesta: RespuestaEstadisticas;
    try { respuesta = JSON.parse(respuestaHttp.texto) as RespuestaEstadisticas; }
    catch { return null; }
    const observaciones = (respuesta.data ?? []).map(aObservacionRadar).filter((item): item is ObservacionRadar => item !== null).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (observaciones.length === 0) return null;
    const ultima = observaciones[observaciones.length - 1];
    const diasDesde = Math.max(0, Math.floor((ahora.getTime() - new Date(`${ultima.fecha}T12:00:00Z`).getTime()) / MS_POR_DIA));
    return { fecha: ultima.fecha, diasDesde, rvi: ultima.rvi };
  }

  async consultarLote(lote: LoteSatelital, ahora: Date): Promise<ResultadoLote> {
    const [optico, radar] = await Promise.all([this.consultarOptico(lote, ahora), this.consultarRadar(lote, ahora)]);
    if (!radar) return optico;
    if (optico.estado === 'ok' && radar.diasDesde >= optico.condicion.diasDesde) return optico;
    return {
      estado: 'radar', loteId: lote.id, condicion: radar,
      optico: optico.estado === 'ok' ? optico.condicion : undefined,
      mensaje: optico.estado === 'ok'
        ? `La última óptica despejada es de hace ${optico.condicion.diasDesde} días; se muestra radar Sentinel-1 (${radar.diasDesde === 0 ? 'hoy' : `hace ${radar.diasDesde} días`}), no tapado por nubes.`
        : `Sin óptica despejada en ${DIAS_VENTANA} días; se muestra radar Sentinel-1 (${radar.diasDesde === 0 ? 'hoy' : `hace ${radar.diasDesde} días`}), no tapado por nubes.`,
    };
  }

  async analizarLotes(lotes: LoteSatelital[], ahora = new Date()): Promise<ResultadoLote[]> {
    const resultados = new Array<ResultadoLote>(lotes.length);
    let siguiente = 0;
    const trabajador = async (): Promise<void> => {
      while (siguiente < lotes.length) {
        const indice = siguiente++;
        resultados[indice] = await this.consultarLote(lotes[indice], ahora);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, lotes.length) }, () => trabajador()));
    return resultados;
  }
}

export const analizadorSatelital = new AnalizadorSatelital();

