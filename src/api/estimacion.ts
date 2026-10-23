import { pedir } from "./client";
import type { TipoPastura } from "../types";

/** Ver backend/src/estimacion/motor.ts y docs/ESTIMACION_FORRAJE.md. Todo es derivado: nada se persiste. */

/** `historico`: completado con el clima histórico de Open-Meteo, de los mismos modelos. */
export type OrigenClima = "observado" | "historico" | "pronostico";
export type OrigenDiaEstimacion = "observado" | "proyectado" | "en-pastoreo" | "sin-dato";
export type CondicionPastoreo = "no-apto" | "cuidado" | "perfecto" | "regular";

export interface DiaEstimacion {
  fecha: string;
  crecimientoKgMsHaDia: number | null;
  /** Producido desde el ancla. No es la biomasa en pie del lote. */
  acumuladoKgMsHa: number | null;
  origen: OrigenDiaEstimacion;
  fechaAncla: string | null;
  tipoAncla: "pastoreo" | "inicio" | "reanudacion" | null;
  diasDesdeAncla: number | null;
  ndviUsado: number | null;
  fechaImagen: string | null;
  diasDesdeImagen: number | null;
  climaUsado: OrigenClima | null;
  motivo: string | null;
}

export interface DiaCondicion {
  fecha: string;
  condicion: CondicionPastoreo;
  avanceEstadoFoliar: number;
  gradosDia: { conBaseMaxima: number; conBaseMinima: number };
  climaUsado: OrigenClima;
}

export interface ReingresoEstimado {
  criterio: { hojasVivasPorMacollo: number; filocronoGradosDia: [number, number]; vidaMediaFoliarGradosDia: [number, number]; temperaturaBaseC: [number, number] } | null;
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

interface FuenteParametro {
  valor: unknown;
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
  erroresReinicio: Array<{ fecha: string; fechaImagenAnterior: string; diasSinImagen: number; ndviSupuesto: number; ndviObservado: number; diferencia: number }>;
  avisos: string[];
  mensaje: string | null;
  parametrosUsados: {
    pastura: string;
    frfa: FuenteParametro;
    fraccionRfa: FuenteParametro;
    eur: FuenteParametro;
    reingreso: FuenteParametro;
    coberturaMinima: number;
    maximoDiasSinImagen: number;
  } | null;
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
