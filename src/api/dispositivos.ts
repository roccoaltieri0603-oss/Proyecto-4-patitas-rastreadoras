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
  numero?: 1 | 2;
  /** Identificador interno estable del simulador. */
  identificadorEquipo: string;
  /** Nombre que le pone el productor. null si nadie lo bautizó. */
  apodo: string | null;
  actualizadaEn?: string;
  conexion: EstadoConexion;
  bateriaPorcentaje: number | null;
  latitud?: number;
  longitud?: number;
  ultimaSenal: string | null;
  ubicacion: UbicacionDispositivo | null;
  loteId: string | null;
  numeroLote: number | null;
  animalId: string | null;
  condicionBateria?: "normal" | "baja" | "critica";
  dentroEstablecimiento?: boolean;
  loteActual?: { id: string; numero: number; apodo: string | null } | null;
  loteAsignado?: { id: string; numero: number; apodo: string | null } | null;
  incidenciasActivas?: string[];
}

export interface MuestraBateria { momento: string; porcentaje: number }
export interface ResponsableGpsDisponible { id: string; nombre: string }
export interface DispositivoResponsableGps { id: string; userId: string; username: string; numero: 1 | 2; apodo: string; puestoOperativoId: string | null }

export async function obtenerResponsablesGps(establecimientoId: string): Promise<{ dispositivos: DispositivoResponsableGps[]; administradores: ResponsableGpsDisponible[] }> {
  return pedir(`/api/establecimientos/${establecimientoId}/dispositivos-simulados/responsables`);
}

export async function asignarResponsableGps(establecimientoId: string, dispositivoId: string, puestoOperativoId: string | null): Promise<void> {
  await pedir(`/api/establecimientos/${establecimientoId}/dispositivos-simulados/${dispositivoId}/responsable`, {
    method: "PATCH", body: JSON.stringify({ puestoOperativoId }),
  });
}

export async function obtenerDispositivos(establecimientoId: string): Promise<Dispositivo[]> {
  const respuesta = await pedir<{ dispositivos: Dispositivo[] }>(`/api/establecimientos/${establecimientoId}/dispositivos-simulados`);
  return respuesta.dispositivos;
}

export async function actualizarDispositivo(establecimientoId: string, id: string, cambios: { apodo?: string; bateriaPorcentaje?: number; conexion?: EstadoConexion; latitud?: number; longitud?: number; loteAsignadoId?: string | null }): Promise<Dispositivo> {
  return (await pedir<{ dispositivo: Dispositivo }>(`/api/establecimientos/${establecimientoId}/dispositivos-simulados/${id}`, { method: "PATCH", body: JSON.stringify(cambios) })).dispositivo;
}
