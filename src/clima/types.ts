/** Un día del registro: pasado (observado por el modelo) o pronóstico. */
export interface DiaClima {
  /** ISO, YYYY-MM-DD. */
  fecha: string;
  lluviaMm: number | null;
  tempMin: number | null;
  tempMax: number | null;
  /** false = ya pasó (dato modelado, no una promesa); true = pronóstico (incluye "hoy"). */
  esPronostico: boolean;
}

/** Clima de un punto (el centroide de un lote). */
export interface Clima {
  consultadoEn: number;
  dias: DiaClima[];
  /** Suma de `lluviaMm` de los días ya pasados (no incluye hoy ni pronóstico). */
  lluviaUltimos7Dias: number | null;
  /** Suma de `lluviaMm` de "hoy" + los días de pronóstico. */
  lluviaProximosDias: number | null;
  hoy: DiaClima | null;
}

export type CategoriaLluvia = "seco" | "normal" | "lluvia" | "piso-pesado";

export type ResultadoClimaLote =
  | { estado: "ok"; loteId: string; clima: Clima; categoria: CategoriaLluvia | null; persistencia?: { consultaId: string; guardado: boolean; omitido?: "reciente" } }
  | { estado: "error"; loteId: string; mensaje: string };
