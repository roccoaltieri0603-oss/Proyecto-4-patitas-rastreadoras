import { pedir, pedirArchivo } from "./client";
import type { UsoLote } from "./historial";

/**
 * Planilla de uso de potreros: lectura del registro que ya existe en
 * `usos_lote`, con las jornadas cargadas a mano. La superficie, los días de
 * descanso y de ocupación y las cabezas por hectárea los deriva el backend; acá
 * no se calcula ni se completa nada.
 */

export interface LoteDelRegistro {
  id: string;
  numero: number;
  apodo: string | null;
  activo: boolean;
  /** `null` cuando la geometría guardada no permite calcularla. */
  hectareas: number | null;
}

export interface RegistroDeUso extends UsoLote {
  /** Último día con animales del uso anterior (su salida, o su fecha si no tiene hora). */
  fechaUsoAnterior: string | null;
  /** `null` en el primer uso registrado del potrero: no hubo descanso previo que medir. */
  diasDescanso: number | null;
  /** Suma de categorías sobre la superficie. No son equivalentes vaca. */
  cabezasPorHa: number | null;
}

export interface RegistroDeUsos {
  lotes: LoteDelRegistro[];
  registros: RegistroDeUso[];
  paginacion: { limit: number; offset: number; total: number; hayMas: boolean };
}

export interface FiltrosRegistroDeUsos {
  desde?: string;
  hasta?: string;
  loteId?: string;
  incluirInactivos?: boolean;
  limit?: number;
  offset?: number;
}

function query(filtros: FiltrosRegistroDeUsos): string {
  const parametros = new URLSearchParams();
  Object.entries(filtros).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== "") parametros.set(clave, String(valor));
  });
  const texto = parametros.toString();
  return texto ? `?${texto}` : "";
}

export function obtenerRegistroDeUsos(establecimientoId: string, filtros: FiltrosRegistroDeUsos = {}): Promise<RegistroDeUsos> {
  return pedir<RegistroDeUsos>(`/api/establecimientos/${establecimientoId}/registro-usos${query(filtros)}`);
}

/**
 * Descarga la planilla en Excel. Sale de la misma consulta que la vista, pero
 * con el período entero: `limit` y `offset` no se mandan.
 */
export async function descargarRegistroDeUsosExcel(
  establecimientoId: string,
  filtros: Omit<FiltrosRegistroDeUsos, "limit" | "offset"> = {},
): Promise<void> {
  const { blob, nombre } = await pedirArchivo(
    `/api/establecimientos/${establecimientoId}/registro-usos.xlsx${query(filtros)}`,
  );
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre ?? "registro-manejo-potreros.xlsx";
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
