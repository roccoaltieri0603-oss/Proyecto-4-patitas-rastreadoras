import { pedir } from "./client";

export interface LugarEncontrado {
  nombre: string;
  latitud: number;
  longitud: number;
  /** [sur, oeste, norte, este] */
  limites: [number, number, number, number];
}

/** Busca un lugar por nombre. Sólo sirve para mover el mapa: no se guarda nada. */
export async function buscarLugar(texto: string): Promise<LugarEncontrado[]> {
  const { lugares } = await pedir<{ lugares: LugarEncontrado[] }>(
    `/api/establecimientos/buscar-lugar?q=${encodeURIComponent(texto)}`,
  );
  return lugares;
}
