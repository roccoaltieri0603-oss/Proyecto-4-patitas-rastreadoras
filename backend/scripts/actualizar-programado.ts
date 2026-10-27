import { pool } from '../src/base-datos/pool.js';
import { actualizarLotesPendientes, actualizacionNecesitaReintento } from '../src/services/actualizacion-programada.js';

/**
 * Actualización programada de satélite y clima, para correr desde un
 * planificador (cron, Task Scheduler, GitHub Actions).
 *
 *   npm run build && npm run actualizar
 *
 * Se puede ajustar por entorno, todo opcional:
 *   ACTUALIZAR_HORAS_SATELITE  antigüedad mínima para reconsultar (default 24)
 *   ACTUALIZAR_HORAS_CLIMA     ídem clima (default 6)
 *   ACTUALIZAR_MAX_LOTES       techo de lotes por corrida (default 40)
 *   ACTUALIZAR_MAX_LOTES_CLIMA techo de lotes para clima e histórico (default 160)
 *   ACTUALIZAR_TANDA           lotes por tanda (default 5)
 *   ACTUALIZAR_PAUSA_MS        pausa entre tandas (default 2000)
 *
 * Sale con código 1 si hubo errores técnicos o cortes, aunque otras consultas
 * hayan sido exitosas, para que el planificador lo muestre como fallido.
 */

function entero(nombre: string): number | undefined {
  const crudo = process.env[nombre]?.trim();
  if (!crudo) return undefined;
  const valor = Number(crudo);
  if (!Number.isFinite(valor) || valor < 0) throw new Error(`${nombre} debe ser un número positivo.`);
  return valor;
}

try {
  const resumen = await actualizarLotesPendientes({
    horasSatelite: entero('ACTUALIZAR_HORAS_SATELITE'),
    horasClima: entero('ACTUALIZAR_HORAS_CLIMA'),
    maxLotes: entero('ACTUALIZAR_MAX_LOTES'),
    maxLotesClima: entero('ACTUALIZAR_MAX_LOTES_CLIMA'),
    tamanoTanda: entero('ACTUALIZAR_TANDA'),
    pausaMs: entero('ACTUALIZAR_PAUSA_MS'),
  });

  console.log(JSON.stringify({ evento: 'actualizacion_programada', ...resumen }));
  if (actualizacionNecesitaReintento(resumen)) {
    console.error('La actualización tuvo errores o quedó cortada; revisá el resumen y los eventos registrados.');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
