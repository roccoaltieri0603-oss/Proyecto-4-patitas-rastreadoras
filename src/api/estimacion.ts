import { pedir } from "./client";
import type { TipoPastura } from "../types";

/** Ver backend/src/estimacion/motor.ts y docs/ESTIMACION_FORRAJE.md. Todo es derivado: nada se persiste. */

/** `historico`: completado con el clima histórico de Open-Meteo, de los mismos modelos. */
export type OrigenClima = "observado" | "historico" | "pronostico";
export type EtapaPasto = "en-pastoreo" | "rebrotando" | "listo" | "pasado";
export type Confianza = "alta" | "media" | "baja";
export type CondicionPastoreo = "no-apto" | "cuidado" | "perfecto" | "regular";

export interface DiaEstimacion {
  fecha: string;
  /** De dónde sale la temperatura de ese día; null si falta. */
  climaUsado: OrigenClima | null;
  etapa: EtapaPasto | null;
  motivoEtapa: string | null;
  /** Contada desde el alta del lote: como mínimo así de avanzado. */
  etapaEsMinimo: boolean;
  /** Grados-día sobre la vida media foliar mínima: 1 es "listo". Sin tope. */
  progresoRebrote: number | null;
  /** kg MS/ha en pie medidos ese día; null los días sin medición. */
  biomasaEnPieKgMsHa: number | null;
  /** Con el intervalo del 95 % del coeficiente de la fuente. */
  biomasaRango: [number, number] | null;
  biomasaOrigen: "medido" | null;
  fechaMedicion: string | null;
  biomasaConfianza: Confianza | null;
  motivoBiomasa: string | null;
  /** Pasto en pie por encima del remanente objetivo; null sin remanente con fuente. */
  consumibleKgMsHa: number | null;
  motivoConsumible: string | null;
}

export interface ValidacionPublicada {
  n: number;
  r2: number;
  ccc: number;
  /** (media modelada − observada) / observada, en %. */
  sesgoPorcentaje: number;
}

export interface MedicionConvertida {
  id: string | null;
  fecha: string;
  momento: "salida" | "antes-de-entrar" | "recorrida";
  instrumento: "plato" | "regla";
  alturaPromedioCm: number;
  cantidadLecturas: number;
  /** null si no hay conversión con fuente para esta pastura e instrumento. */
  kgMsHa: number | null;
  rango: [number, number] | null;
  coeficienteKgPorCm: number | null;
  estacion: "verano" | "otono" | "invierno" | "primavera";
  validacion: ValidacionPublicada | null;
  confianza: Confianza | null;
  avisos: string[];
  motivo: string | null;
}

export interface ConversionAltura {
  porEstacion: Record<"verano" | "otono" | "invierno" | "primavera", { kgPorCm: number; intervalo95: [number, number]; n: number; r2: number; validacion: ValidacionPublicada | null; usaAnual: boolean; fueraDeEstacion: boolean }>;
  rangoValidoCm: [number, number];
  zona: string;
  instrumento: string;
}

export interface DiaCondicion {
  fecha: string;
  condicion: CondicionPastoreo;
  avanceEstadoFoliar: number;
  gradosDia: { conBaseMaxima: number; conBaseMinima: number };
  climaUsado: OrigenClima;
}

export interface CriterioReingreso {
  hojasVivasPorMacollo: number;
  filocronoGradosDia: [number, number];
  vidaMediaFoliarGradosDia: [number, number];
  temperaturaBaseC: [number, number];
}

export interface ReingresoEstimado {
  criterio: CriterioReingreso | null;
  fechaUltimoPastoreo: string | null;
  fechaTemprana: string | null;
  fechaTardia: string | null;
  gradosDiaAcumulados: { conBaseMaxima: number; conBaseMinima: number } | null;
  contadoHasta: string | null;
  usaPronostico: boolean;
  condiciones: DiaCondicion[];
  condicionHoy: DiaCondicion | null;
  /** `alta`: sin pastoreos registrados se cuenta desde el alta del lote en RODEO. */
  inicioConteo: "pastoreo" | "alta" | null;
  fechaInicioConteo: string | null;
  /** Contado desde el alta: la condición es un piso y las fechas, lo más tarde posible. "Regular" sí es segura. */
  esMinimo: boolean;
  mensaje: string | null;
}

export interface ParametroConFuente<T> {
  /** null: sin fuente verificada; el modelo no lo reemplaza por un supuesto. */
  valor: T | null;
  fuente: { cita: string; url: string | null; nota?: string } | null;
  provisional: boolean;
}

export interface EstimacionForraje {
  versionModelo: string;
  tipoPastura: TipoPastura | null;
  desde: string;
  hasta: string | null;
  dias: DiaEstimacion[];
  reingreso: ReingresoEstimado | null;
  mediciones: MedicionConvertida[];
  avisos: string[];
  /** Sin `reingreso`, es lo único que hay para mostrar: sin pastura, sin parámetros, sin clima o sin migración. */
  mensaje: string | null;
  parametrosUsados: {
    pastura: string;
    reingreso: ParametroConFuente<CriterioReingreso>;
    alturaAKg: Record<"plato" | "regla", ParametroConFuente<ConversionAltura>>;
    remanenteObjetivoCm: Record<"plato" | "regla", ParametroConFuente<number>>;
  } | null;
}

/** De primero a último; ver backend/src/services/orden-pastoreo.ts. */
export type GrupoOrden = "listo" | "pasado" | "esperar-al-piso" | "rebrotando" | "en-pastoreo" | "sin-datos";

/** Lo que el usuario puede cargar para que el lote entre al orden con su etapa real. */
export type FaltaDelLote = "pastura" | "ultimo-pastoreo" | "clima";

export interface LoteOrdenado {
  loteId: string;
  numero: number;
  posicion: number;
  grupo: GrupoOrden;
  etapa: EtapaPasto | null;
  etapaEsMinimo: boolean;
  /** Para un lote listo: días hasta que pase su punto; null si no pasa dentro del pronóstico. */
  diasHastaPasado: number | null;
  progresoRebrote: number | null;
  /** Para un lote rebrotando: el día más temprano en que estaría listo (ISO); null si no se puede decir. */
  listoEl: string | null;
  pastoEnPieKgMsHa: number | null;
  consumibleKgMsHa: number | null;
  pisoPesado: boolean;
  confianza: Confianza | null;
  confianzaPastoEnPie: Confianza | null;
  falta: FaltaDelLote | null;
  motivos: string[];
}

export interface OrdenPastoreo {
  hoy: string;
  leyenda: string;
  lotes: LoteOrdenado[];
}

export async function obtenerOrdenPastoreo(establecimientoId: string): Promise<OrdenPastoreo> {
  return pedir<OrdenPastoreo>(`/api/establecimientos/${establecimientoId}/lotes/orden-pastoreo`);
}

/** Todos los lotes activos del establecimiento en una sola llamada, ordenados por número. */
export async function obtenerEstimacionesForraje(establecimientoId: string, desde?: string): Promise<Array<{ loteId: string; numero: number; estimacion: EstimacionForraje }>> {
  const consulta = desde ? `?desde=${encodeURIComponent(desde)}` : "";
  return (await pedir<{ estimaciones: Array<{ loteId: string; numero: number; estimacion: EstimacionForraje }> }>(`/api/establecimientos/${establecimientoId}/lotes/estimacion${consulta}`)).estimaciones;
}

export async function obtenerEstimacionForraje(establecimientoId: string, loteId: string, desde?: string): Promise<EstimacionForraje> {
  const consulta = desde ? `?desde=${encodeURIComponent(desde)}` : "";
  return (await pedir<{ estimacion: EstimacionForraje }>(`/api/establecimientos/${establecimientoId}/lotes/${loteId}/estimacion${consulta}`)).estimacion;
}
