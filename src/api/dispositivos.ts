// Contrato tentativo de los dispositivos GPS (collares) de un establecimiento.
//
// IMPORTANTE: todavía no existe backend para esto. GPS/dispositivos sigue
// pausado según CLAUDE.md y docs/OPEN_QUESTIONS.md. Este archivo es la
// especificación que el backend puede implementar: mientras no exista,
// la pantalla se alimenta de src/demo/dispositivosSimulados.ts y avisa en
// pantalla que los datos son simulados.
//
// Regla del proyecto: nunca inventar un dato. Todo lo que el dispositivo no
// reportó viaja como null y la interfaz lo muestra como "Sin datos".

import { pedir } from "./client";

/** Cómo está el vínculo entre el collar y el servidor, decidido por el backend. */
export type EstadoConexion =
  | "en-linea"          // reportó dentro de la ventana que defina producto
  | "sin-senal"         // ya reportó alguna vez, pero hace demasiado que no
  | "nunca-conectado";  // dado de alta y todavía sin ninguna señal

export interface UbicacionDispositivo {
  latitud: number;
  longitud: number;
  /** Precisión declarada por el GPS, en metros. null si el equipo no la informa. */
  precisionMetros: number | null;
}

export interface Dispositivo {
  /** Identificador interno del registro en nuestra base. */
  id: string;
  /** Identificador grabado en el equipo (IMEI, serie o lo que use el proveedor). */
  identificadorEquipo: string;
  /** Nombre que le pone el productor. null si nadie lo bautizó. */
  apodo: string | null;
  conexion: EstadoConexion;
  /** Batería 0-100. null cuando el equipo no la reporta: nunca asumir 0. */
  bateriaPorcentaje: number | null;
  /** Instante ISO (TIMESTAMPTZ) de la última señal recibida. null si nunca hubo. */
  ultimaSenal: string | null;
  /** Última posición conocida. null si nunca reportó uno. */
  ubicacion: UbicacionDispositivo | null;
  /** Lote donde cayó la última posición, resuelto por el backend. null si está fuera de todos. */
  loteId: string | null;
  numeroLote: number | null;
  /** Animal al que está puesto el collar. null mientras no exista el módulo de ganado. */
  animalId: string | null;
}

export async function obtenerDispositivos(establecimientoId: string): Promise<Dispositivo[]> {
  const respuesta = await pedir<{ dispositivos: Dispositivo[] }>(
    `/api/establecimientos/${establecimientoId}/dispositivos`,
  );
  return respuesta.dispositivos;
}

export async function obtenerDispositivo(
  establecimientoId: string,
  dispositivoId: string,
): Promise<Dispositivo> {
  const respuesta = await pedir<{ dispositivo: Dispositivo }>(
    `/api/establecimientos/${establecimientoId}/dispositivos/${dispositivoId}`,
  );
  return respuesta.dispositivo;
}

/** Una lectura de batería en el tiempo, para dibujar cómo viene bajando. */
export interface MuestraBateria {
  /** Instante ISO en que el equipo reportó ese nivel. */
  momento: string;
  porcentaje: number;
}

export async function obtenerHistorialBateria(
  establecimientoId: string,
  dispositivoId: string,
): Promise<MuestraBateria[]> {
  const respuesta = await pedir<{ muestras: MuestraBateria[] }>(
    `/api/establecimientos/${establecimientoId}/dispositivos/${dispositivoId}/bateria`,
  );
  return respuesta.muestras;
}
