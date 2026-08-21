import { pedir } from "./client";
import type { EstadisticaIndice } from "../copernicus/types";

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
  dias: { fecha: string; lluviaMm: number | null; tempMin: number | null; tempMax: number | null; esPronostico: boolean }[];
}

export interface UsoLote {
  id: string;
  loteId: string;
  fecha: string;
  origen: string;
  createdAt: string;
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
  uso: { ultimoUso: { fecha: string; origen: string } | null; diasDescanso: number | null };
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
  hoy: { fecha: string; lluviaMm: number | null; tempMin: number | null; tempMax: number | null; esPronostico: boolean } | null;
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

export async function obtenerHistorialLote(loteId: string): Promise<HistorialLote> {
  return pedir<HistorialLote>(`/api/lotes/${loteId}/historial`);
}

function queryHistorial(opciones: OpcionesHistorial = {}): string {
  const query = new URLSearchParams();
  Object.entries(opciones).forEach(([clave, valor]) => { if (valor !== undefined) query.set(clave, String(valor)); });
  const texto = query.toString();
  return texto ? `?${texto}` : "";
}

export async function obtenerEstadoLote(loteId: string): Promise<EstadoLoteApi> {
  return pedir<EstadoLoteApi>(`/api/lotes/${loteId}/estado`);
}

export async function obtenerMedicionesSatelitales(loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<MedicionSatelital[]>> {
  const respuesta = await pedir<{ mediciones: MedicionSatelital[]; paginacion: PaginacionHistorial }>(`/api/lotes/${loteId}/mediciones-satelitales${queryHistorial(opciones)}`);
  return { items: respuesta.mediciones, paginacion: respuesta.paginacion };
}

export async function obtenerConsultasClima(loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<ConsultaClimaHistorial[]>> {
  const respuesta = await pedir<{ consultas: ConsultaClimaHistorial[]; paginacion: PaginacionHistorial }>(`/api/lotes/${loteId}/clima${queryHistorial(opciones)}`);
  return { items: respuesta.consultas, paginacion: respuesta.paginacion };
}

export async function obtenerUsosLote(loteId: string, opciones: OpcionesHistorial = {}): Promise<HistorialPaginado<UsoLote[]>> {
  const respuesta = await pedir<{ usos: UsoLote[]; paginacion: PaginacionHistorial }>(`/api/lotes/${loteId}/usos${queryHistorial(opciones)}`);
  return { items: respuesta.usos, paginacion: respuesta.paginacion };
}

export async function registrarUsoLote(loteId: string, fecha: string): Promise<UsoLote> {
  return (await pedir<{ uso: UsoLote }>(`/api/lotes/${loteId}/usos`, {
    method: "POST", body: JSON.stringify({ fecha, origen: "manual" }),
  })).uso;
}
