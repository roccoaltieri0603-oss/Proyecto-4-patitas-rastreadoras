import { pool } from './pool.js';

/**
 * Compatibilidad mientras la migración 018 no esté aplicada en la base que usa
 * el backend: sin la tabla, la estimación sigue sin pasto en pie y los
 * endpoints de mediciones responden 503. Mismo criterio que clima-historico-disponible.ts.
 */

const REVISAR_AUSENCIA_CADA_MS = 60_000;

let disponible = false;
let revisadoEn = 0;

export async function medicionesAlturaDisponibles(ahora = Date.now()): Promise<boolean> {
  if (disponible || ahora - revisadoEn < REVISAR_AUSENCIA_CADA_MS) return disponible;
  const resultado = await pool.query<{ existe: boolean }>("SELECT to_regclass('public.mediciones_altura') IS NOT NULL AS existe");
  disponible = resultado.rows[0]?.existe === true;
  revisadoEn = ahora;
  return disponible;
}

/** Sólo para tests. */
export function reiniciarDeteccionMedicionesAltura(): void {
  disponible = false;
  revisadoEn = 0;
}
