import { pedir } from "./client";
import type { EstadisticaIndice } from "../copernicus/types";
import type { DiaClima } from "../clima/types";

export interface MedicionSatelital {
  id: string;
  fuente: "sentinel-1" | "sentinel-2";
  observedAt: string;
  consultedAt: string;
  coberturaValida: number | null;
  ndvi: EstadisticaIndiceNullable;
  ndmi: EstadisticaIndiceNullable;
  ndwi: EstadisticaIndiceNullable;
  evi: EstadisticaIndiceNullable;
  rvi: EstadisticaIndiceNullable;
  puntaje: number | null;
  categoria: string | null;
}

export type EstadisticaIndiceNullable = Partial<EstadisticaIndice> & {
  media: number | null;
  mediana: number | null;
  min: number | null;
  max: number | null;
  desvio: number | null;
};

export interface ConsultaClimaHistorial {
  id: string;
  consultedAt: string;
  origen: "automatico" | "manual" | "legacy";
  lluviaUltimos7Dias: number | null;
  lluviaProximosDias: number | null;
  categoria: string | null;
  dias: DiaClima[];
}

export interface AnimalesDelUso {
  adultos: number | null;
  toretesVaconas: number | null;
  terneros: number | null;
  /** Suma de las categorías cargadas; `null` si no se cargó ninguna. */
  total: number | null;
}

/**
 * Un uso viejo es sólo una fecha. Una jornada de pastoreo, cargada a mano,
 * trae además entrada y salida con hora, animales y altura del remanente.
 */
export interface UsoLote {
  id: string;
  loteId: string;
  /** Día de entrada, en el calendario de Buenos Aires. */
  fecha: string;
  origen: string;
  createdAt: string;
  ingresoAt: string | null;
  salidaAt: string | null;
  /** Hay animales adentro: entraron y todavía no salieron. */
  enCurso: boolean;
  animales: AnimalesDelUso;
  alturaRemanenteCm: number | null;
  diasOcupacion: number | null;
}

export interface DatosJornada {
  ingresoAt?: string;
  salidaAt?: string | null;
  adultos?: number | null;
  toretesVaconas?: number | null;
  terneros?: number | null;
  alturaRemanenteCm?: number | null;
}

export interface HistorialLote {
  satelite: MedicionSatelital[];
  clima: ConsultaClimaHistorial[];
  usos: UsoLote[];
}

export interface PaginacionHistorial {
  limit: number;
  offset: number;
  total: number;
  hayMas: boolean;
}

export interface EstadoLoteApi {
  lote: { id: string; numero: number; apodo: string | null; activo: boolean };
  satelite: {
    optico: EstadoSateliteOptico | null;
    radar: EstadoSateliteRadar | null;
  };
  clima: EstadoClima | null;
  uso: {
    /** `fechaFin`: último día con animales (la salida, o hoy si siguen adentro). */
    ultimoUso: (UsoLote & { fechaFin: string }) | null;
    /** Desde la salida; `null` con animales adentro o sin usos. */
    diasDescanso: number | null;
  };
}

interface EstadoSateliteBase {
  id: string;
  observedAt: string;
  consultedAt: string;
  diasDesdeObservacion: number;
}

export interface EstadoSateliteOptico extends EstadoSateliteBase {
  coberturaValida: number | null;
  ndvi: EstadisticaIndiceNullable;
  ndmi: EstadisticaIndiceNullable;
  ndwi: EstadisticaIndiceNullable;
  evi: EstadisticaIndiceNullable;
  puntaje: number | null;
  categoria: string | null;
}

export interface EstadoSateliteRadar extends EstadoSateliteBase {
  rvi: EstadisticaIndiceNullable;
}

export interface EstadoClima {
  consultedAt: string;
  origen: "automatico" | "manual" | "legacy";
  horasDesdeConsulta: number;
  lluviaUltimos7Dias: number | null;
  lluviaProximosDias: number | null;
  categoria: string | null;
  hoy: DiaClima | null;
  /** Serie completa de la última consulta: 7 días pasados y hasta 16 de pronóstico. */
  dias: DiaClima[];
}

export interface HistorialPaginado<T> {
  items: T;
  paginacion: PaginacionHistorial;
}

export interface OpcionesHistorial {
  limit?: number;
  offset?: number;
  desde?: string;
  hasta?: string;
  fuente?: "sentinel-1" | "sentinel-2";
}

export async function obtenerHistorialLote(establecimientoId: string, loteId: string): Promise<HistorialLote> {
  return pedir<HistorialLote>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/historial`);
}

function queryHistorial(opciones: OpcionesHistorial = {}): string {
  const query = new URLSearchParams();
  Object.entries(opciones).forEach(([clave, valor]) => { if (valor !== undefined) query.set(clave, String(valor)); });
  const texto = query.toString();
  return texto ? `?${texto}` : "";
}

export async function obtenerEstadoLote(establecimientoId: string, loteId: string): Promise<EstadoLoteApi> {
  return pedir<EstadoLoteApi>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/estado`);
}

export async function obtenerMedicionesSatelitales(establecimientoId: string, loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<MedicionSatelital[]>> {
  const respuesta = await pedir<{ mediciones: MedicionSatelital[]; paginacion: PaginacionHistorial }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/mediciones-satelitales${queryHistorial(opciones)}`);
  return { items: respuesta.mediciones, paginacion: respuesta.paginacion };
}

export async function obtenerConsultasClima(establecimientoId: string, loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<ConsultaClimaHistorial[]>> {
  const respuesta = await pedir<{ consultas: ConsultaClimaHistorial[]; paginacion: PaginacionHistorial }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/clima${queryHistorial(opciones)}`);
  return { items: respuesta.consultas, paginacion: respuesta.paginacion };
}

export async function obtenerUsosLote(establecimientoId: string, loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<UsoLote[]>> {
  const respuesta = await pedir<{ usos: UsoLote[]; paginacion: PaginacionHistorial }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos${queryHistorial(opciones)}`);
  return { items: respuesta.usos, paginacion: respuesta.paginacion };
}

export async function registrarUsoLote(establecimientoId: string, loteId: string, fecha: string): Promise<UsoLote> {
  return (await pedir<{ uso: UsoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos`, {
    method: "POST", body: JSON.stringify({ fecha, origen: "manual" }),
  })).uso;
}
export function modificarUsoLote(establecimientoId: string, loteId: string, usoId: string, fecha: string) {
  return pedir<{ uso: UsoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos/${usoId}`, { method: 'PATCH', body: JSON.stringify({ fecha }) });
}

/** Inicia una jornada. Con `salidaAt`, registra una que ya terminó. */
export async function iniciarJornada(establecimientoId: string, loteId: string, datos: DatosJornada & { ingresoAt: string }): Promise<UsoLote> {
  return (await pedir<{ uso: UsoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/jornadas`, {
    method: "POST", body: JSON.stringify(datos),
  })).uso;
}

export async function finalizarJornada(establecimientoId: string, loteId: string, usoId: string, datos: { salidaAt: string; alturaRemanenteCm: number | null }): Promise<UsoLote> {
  return (await pedir<{ uso: UsoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/jornadas/${usoId}/finalizar`, {
    method: "POST", body: JSON.stringify(datos),
  })).uso;
}

export async function modificarJornada(establecimientoId: string, loteId: string, usoId: string, datos: DatosJornada): Promise<UsoLote> {
  return (await pedir<{ uso: UsoLote }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos/${usoId}`, {
    method: "PATCH", body: JSON.stringify(datos),
  })).uso;
}
export function eliminarUsoLote(establecimientoId: string, loteId: string, usoId: string) {
  return pedir<void>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos/${usoId}`, { method: 'DELETE' });
}
