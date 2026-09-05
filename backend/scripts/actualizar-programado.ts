import { pool } from '../src/base-datos/pool.js';
import { actualizarLotesPendientes } from '../src/services/actualizacion-programada.js';

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
 *   ACTUALIZAR_TANDA           lotes por tanda (default 5)
 *   ACTUALIZAR_PAUSA_MS        pausa entre tandas (default 2000)
 *
 * Sale con código 1 si no pudo persistir nada de lo que intentó, para que el
 * planificador lo marque como fallido en vez de fallar en silencio.
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
    tamanoTanda: entero('ACTUALIZAR_TANDA'),
    pausaMs: entero('ACTUALIZAR_PAUSA_MS'),
  });

  console.log(JSON.stringify({ evento: 'actualizacion_programada', ...resumen }));
  const intentado = resumen.satelite.consultados + resumen.clima.consultados;
  const logrado = resumen.satelite.persistidos + resumen.satelite.sinDatos + resumen.clima.persistidos + resumen.clima.sinDatos;
  if (intentado > 0 && logrado === 0) {
    console.error('Ninguna consulta terminó bien: revisá credenciales, red o límite de consultas.');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
