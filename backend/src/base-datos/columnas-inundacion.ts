import { pool } from './pool.js';

/**
 * Compatibilidad mientras la migración 022 no esté aplicada en la base que usa
 * el backend. Sin esto, guardar una observación de Sentinel-2 fallaría contra
 * una base que todavía no tiene `ndwi1_media` y `fraccion_inundada`. Sin las
 * columnas, la fracción no se guarda y se lee como NULL: no hay alerta de agua.
 * Mismo criterio que columnas-pastura.ts.
 *
 * Se puede borrar, junto con sus usos, cuando todas las bases tengan 022.
 */

const REVISAR_AUSENCIA_CADA_MS = 60_000;

let disponibles = false;
let revisadoEn = 0;

export async function columnasInundacionDisponibles(ahora = Date.now()): Promise<boolean> {
  if (disponibles || ahora - revisadoEn < REVISAR_AUSENCIA_CADA_MS) return disponibles;
  const resultado = await pool.query<{ cantidad: number }>(
    `SELECT COUNT(*)::int AS cantidad FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mediciones_satelitales' AND column_name IN ('ndwi1_media', 'fraccion_inundada')`,
  );
  disponibles = resultado.rows[0]?.cantidad === 2;
  revisadoEn = ahora;
  return disponibles;
}

/** Sólo para tests. */
export function reiniciarDeteccionInundacion(): void {
  disponibles = false;
  revisadoEn = 0;
}
