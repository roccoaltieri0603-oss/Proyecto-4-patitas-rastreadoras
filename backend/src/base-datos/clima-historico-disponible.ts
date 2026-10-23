import { pool } from './pool.js';

/**
 * Compatibilidad mientras la migración 016 no esté aplicada en la base que usa
 * el backend: sin la tabla, la estimación sigue con las consultas regulares y
 * el relleno histórico no hace nada. Mismo criterio que columnas-pastura.ts.
 */

const REVISAR_AUSENCIA_CADA_MS = 60_000;

let disponible = false;
let revisadoEn = 0;

export async function climaHistoricoDisponible(ahora = Date.now()): Promise<boolean> {
  if (disponible || ahora - revisadoEn < REVISAR_AUSENCIA_CADA_MS) return disponible;
  const resultado = await pool.query<{ existe: boolean }>("SELECT to_regclass('public.clima_historico_lote') IS NOT NULL AS existe");
  disponible = resultado.rows[0]?.existe === true;
  revisadoEn = ahora;
  return disponible;
}

/** Sólo para tests. */
export function reiniciarDeteccionClimaHistorico(): void {
  disponible = false;
  revisadoEn = 0;
}
