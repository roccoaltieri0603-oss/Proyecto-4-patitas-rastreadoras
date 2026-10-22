import { pool } from './pool.js';

/**
 * Compatibilidad mientras la migración 015 no esté aplicada en la base que usa
 * el backend. Sin esto, listar o editar lotes falla con 500 contra una base que
 * todavía no tiene `tipo_pastura` y `fecha_siembra`, y la regla del proyecto
 * prohíbe migrar la base habitual sin validar antes en una aislada.
 *
 * Se puede borrar, junto con sus usos, cuando todas las bases tengan 015.
 */

/** Una vez que las columnas aparecen no desaparecen; la ausencia se vuelve a consultar cada tanto. */
const REVISAR_AUSENCIA_CADA_MS = 60_000;

let disponibles = false;
let revisadoEn = 0;

export async function columnasPasturaDisponibles(ahora = Date.now()): Promise<boolean> {
  if (disponibles || ahora - revisadoEn < REVISAR_AUSENCIA_CADA_MS) return disponibles;
  const resultado = await pool.query<{ cantidad: number }>(
    `SELECT COUNT(*)::int AS cantidad FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'lotes' AND column_name IN ('tipo_pastura', 'fecha_siembra')`,
  );
  disponibles = resultado.rows[0]?.cantidad === 2;
  revisadoEn = ahora;
  return disponibles;
}

/** Sólo para tests. */
export function reiniciarDeteccionPastura(): void {
  disponibles = false;
  revisadoEn = 0;
}
