import { pedir } from "./client";

/**
 * Mediciones de altura del pasto cargadas en el campo. Son observaciones
 * reales: se guardan en cm. Los kilos los calcula la estimación al leer, con la
 * conversión de la pastura, y no se guardan.
 */

export type MomentoMedicion = "salida" | "antes-de-entrar" | "recorrida";
export type Instrumento = "plato" | "regla";

export interface MedicionAltura {
  id: string;
  loteId: string;
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  alturaPromedioCm: number;
  cantidadLecturas: number;
  desvioCm: number | null;
  usoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatosMedicion {
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  alturaPromedioCm: number;
  cantidadLecturas: number;
  desvioCm?: number | null;
  usoId?: string | null;
  /** El plato Filip's cuenta medios centímetros: el backend divide por 2, como la fuente de la conversión. */
  lecturaEnMediosCm?: boolean;
}

function ruta(establecimientoId: string, loteId: string, medicionId?: string): string {
  return `/api/establecimientos/${establecimientoId}/lotes/${loteId}/mediciones-altura${medicionId ? `/${medicionId}` : ""}`;
}

export async function obtenerMedicionesAltura(establecimientoId: string, loteId: string, opciones: { usoId?: string; limit?: number } = {}): Promise<MedicionAltura[]> {
  const consulta = new URLSearchParams();
  if (opciones.usoId) consulta.set("usoId", opciones.usoId);
  if (opciones.limit) consulta.set("limit", String(opciones.limit));
  const sufijo = consulta.toString() ? `?${consulta}` : "";
  return (await pedir<{ mediciones: MedicionAltura[] }>(`${ruta(establecimientoId, loteId)}${sufijo}`)).mediciones;
}

export async function crearMedicionAltura(establecimientoId: string, loteId: string, datos: DatosMedicion): Promise<MedicionAltura> {
  return (await pedir<{ medicion: MedicionAltura }>(ruta(establecimientoId, loteId), { method: "POST", body: JSON.stringify(datos) })).medicion;
}

export async function modificarMedicionAltura(establecimientoId: string, loteId: string, medicionId: string, datos: Partial<DatosMedicion>): Promise<MedicionAltura> {
  return (await pedir<{ medicion: MedicionAltura }>(ruta(establecimientoId, loteId, medicionId), { method: "PATCH", body: JSON.stringify(datos) })).medicion;
}

export function eliminarMedicionAltura(establecimientoId: string, loteId: string, medicionId: string): Promise<void> {
  return pedir<void>(ruta(establecimientoId, loteId, medicionId), { method: "DELETE" });
}
