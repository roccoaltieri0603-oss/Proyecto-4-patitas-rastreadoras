import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { esFechaCalendario } from '../fechas.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const DIAS_PASADOS = 7;
const DIAS_PRONOSTICO = 5;
const TIMEOUT_MS = 20_000;

type PolygonFeature = Feature<Polygon>;
export type LoteClima = { id: string; polygon: PolygonFeature };
export type CategoriaLluvia = 'seco' | 'normal' | 'lluvia' | 'piso-pesado';
export interface DiaClima { fecha: string; lluviaMm: number | null; tempMin: number | null; tempMax: number | null; esPronostico: boolean; }
export interface Clima { consultadoEn: number; dias: DiaClima[]; lluviaUltimos7Dias: number | null; lluviaProximosDias: number | null; hoy: DiaClima | null; }
export type ResultadoClimaLote =
  | { estado: 'ok'; loteId: string; clima: Clima; categoria: CategoriaLluvia | null }
  | { estado: 'error'; loteId: string; mensaje: string };

export interface RespuestaOpenMeteo { ok: boolean; status: number; json(): Promise<unknown>; }
export type TransporteOpenMeteo = (url: string, signal: AbortSignal) => Promise<RespuestaOpenMeteo>;

function aNumero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function categorizarLluvia(clima: Clima): CategoriaLluvia | null {
  const { lluviaUltimos7Dias: semana, lluviaProximosDias: proximos } = clima;
  if (semana === null || proximos === null) return null;
  if (semana >= 40) return 'piso-pesado';
  if (proximos >= 15) return 'lluvia';
  if (semana < 5 && proximos < 5) return 'seco';
  return 'normal';
}

function centroidOf(polygon: PolygonFeature): [number, number] {
  const [lng, lat] = turf.centroid(polygon).geometry.coordinates;
  return [lat, lng];
}

function sumarPeriodo(dias: DiaClima[], inicio: number, fin?: number): number | null {
  const periodo = dias.slice(inicio, fin);
  const cantidadEsperada = fin === undefined ? DIAS_PRONOSTICO : fin - inicio;
  if (periodo.length !== cantidadEsperada) return null;
  let total = 0;
  for (const dia of periodo) {
    if (dia.lluviaMm === null) return null;
    total += dia.lluviaMm;
  }
  return total;
}

function aClima(registro: unknown, referencia: Date): Clima | null {
  if (!registro || typeof registro !== 'object') return null;
  const daily = (registro as Record<string, unknown>).daily;
  if (!daily || typeof daily !== 'object') return null;
  const campos = daily as Record<string, unknown>;
  const tiemposCrudos = campos.time;
  if (!Array.isArray(tiemposCrudos) || tiemposCrudos.length === 0 || tiemposCrudos.some((fecha) => !esFechaCalendario(fecha)) || new Set(tiemposCrudos).size !== tiemposCrudos.length) return null;
  const tiempos = tiemposCrudos as string[];
  const lluvias = Array.isArray(campos.precipitation_sum) ? campos.precipitation_sum : [];
  const tempsMax = Array.isArray(campos.temperature_2m_max) ? campos.temperature_2m_max : [];
  const tempsMin = Array.isArray(campos.temperature_2m_min) ? campos.temperature_2m_min : [];
  const dias = tiempos.map((fecha, i) => ({ fecha, lluviaMm: aNumero(lluvias[i]), tempMax: aNumero(tempsMax[i]), tempMin: aNumero(tempsMin[i]), esPronostico: i >= DIAS_PASADOS }));
  if (dias.every((dia) => dia.lluviaMm === null && dia.tempMin === null && dia.tempMax === null)) return null;
  return {
    consultadoEn: referencia.getTime(),
    dias,
    lluviaUltimos7Dias: sumarPeriodo(dias, 0, DIAS_PASADOS),
    lluviaProximosDias: sumarPeriodo(dias, DIAS_PASADOS),
    hoy: dias[DIAS_PASADOS] ?? null,
  };
}

const transporteFetch: TransporteOpenMeteo = async (url, signal) => fetch(url, { signal });

export class OpenMeteoClient {
  constructor(private transportar: TransporteOpenMeteo = transporteFetch) {}

  reemplazarTransporte(transportar: TransporteOpenMeteo): TransporteOpenMeteo {
    const anterior = this.transportar;
    this.transportar = transportar;
    return anterior;
  }

  async consultar(lotes: LoteClima[], referencia = new Date()): Promise<Record<string, ResultadoClimaLote>> {
    if (lotes.length === 0) return {};
    const centros = lotes.map((lote) => centroidOf(lote.polygon));
    const params = new URLSearchParams({
      latitude: centros.map(([lat]) => lat.toFixed(4)).join(','),
      longitude: centros.map(([, lng]) => lng.toFixed(4)).join(','),
      daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
      past_days: String(DIAS_PASADOS),
      forecast_days: String(DIAS_PRONOSTICO),
      timezone: 'auto',
    });
    const errorParaTodos = (mensaje: string) => Object.fromEntries(lotes.map((lote) => [lote.id, { estado: 'error', loteId: lote.id, mensaje } as const]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let respuesta: RespuestaOpenMeteo;
    try {
      respuesta = await this.transportar(`${ENDPOINT}?${params.toString()}`, controller.signal);
    } catch {
      clearTimeout(timeout);
      return errorParaTodos('No se pudo contactar al servicio meteorológico (Open-Meteo).');
    }
    clearTimeout(timeout);
    if (!respuesta.ok) return errorParaTodos(`Open-Meteo respondió HTTP ${respuesta.status}.`);
    let json: unknown;
    try { json = await respuesta.json(); } catch { return errorParaTodos('Open-Meteo devolvió una respuesta que no se pudo interpretar.'); }
    const registros: unknown[] = Array.isArray(json) ? json : [json];
    const resultados: Record<string, ResultadoClimaLote> = {};
    lotes.forEach((lote, i) => {
      const clima = aClima(registros[i] ?? {}, referencia);
      resultados[lote.id] = clima ? { estado: 'ok', loteId: lote.id, clima, categoria: categorizarLluvia(clima) } : { estado: 'error', loteId: lote.id, mensaje: 'Sin datos de Open-Meteo para este lote.' };
    });
    return resultados;
  }
}

export const openMeteo = new OpenMeteoClient();
