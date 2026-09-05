import { pedir } from "./client";

/**
 * Simulación de pastoreo: herramienta de DEMO de la ficha.
 *
 * El backend calcula la proyección de recuperación sobre observaciones reales
 * ya persistidas del lote y no escribe nada: ni una medición satelital, ni un
 * uso en `usos_lote`. Lo que vuelve vive en memoria del navegador hasta que se
 * recarga la página.
 */
export interface ProyeccionRecuperacion {
  puntajeInicial: number;
  umbralRecuperado: number;
  pendienteSemanal: number;
  dias: number;
}

export interface SimulacionPastoreo {
  loteId: string;
  esSimulacion: true;
  generadoEn: string;
  /** Fechas ópticas reales que respaldan la proyección. */
  puntosReales: number;
  /** De dónde salió la serie: del historial guardado o de una consulta que no se persiste. */
  origen: "persistido" | "copernicus";
  /** Piso real del lote: la fecha de menor NDVI de su propia serie. */
  piso: { fecha: string; ndvi: number; puntaje: number } | null;
  umbralRecuperado: number | null;
  recuperacion: ProyeccionRecuperacion | null;
  /** Por qué no se puede estimar, cuando no se puede. */
  mensaje: string | null;
}

export async function simularPastoreo(loteId: string): Promise<SimulacionPastoreo> {
  const respuesta = await pedir<{ simulacion: SimulacionPastoreo }>(
    `/api/lotes/${loteId}/simulacion-pastoreo`,
    { method: "POST" },
  );
  return respuesta.simulacion;
}
