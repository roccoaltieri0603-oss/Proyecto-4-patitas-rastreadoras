import { pedir } from "./client";

/**
 * Última posición del punto de GPS simulado del mapa.
 *
 * No es una posición real de ganado ni de un dispositivo: es dónde dejó el
 * usuario el marcador arrastrable de la demo. El backend guarda una sola fila
 * por establecimiento, sin historial: no hay recorrido, tramos ni jornadas.
 */
export interface PosicionGpsSimulado {
  latitud: number;
  longitud: number;
  actualizadaEn: string;
}

export async function obtenerPosicionGpsSimulado(establecimientoId: string): Promise<PosicionGpsSimulado | null> {
  const respuesta = await pedir<{ posicion: PosicionGpsSimulado | null }>(
    `/api/establecimientos/${establecimientoId}/gps-simulado`,
  );
  return respuesta.posicion;
}

export async function guardarPosicionGpsSimulado(
  establecimientoId: string,
  latitud: number,
  longitud: number,
): Promise<PosicionGpsSimulado> {
  const respuesta = await pedir<{ posicion: PosicionGpsSimulado }>(
    `/api/establecimientos/${establecimientoId}/gps-simulado`,
    { method: "PUT", body: JSON.stringify({ latitud, longitud }) },
  );
  return respuesta.posicion;
}
