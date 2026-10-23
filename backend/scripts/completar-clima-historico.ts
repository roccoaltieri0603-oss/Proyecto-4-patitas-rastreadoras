import { pool } from '../src/base-datos/pool.js';
import { completarClimaHistorico } from '../src/services/clima-historico.js';

/**
 * Completa de una vez el clima histórico que les falta a los lotes para la
 * estimación de forraje, sin consultar satélite ni el clima regular. La
 * actualización programada hace lo mismo de a 40 lotes por día; esto sirve
 * para la primera carga.
 *
 *   npm run build && npm run clima:historico
 *
 * Opcional por entorno:
 *   HISTORICO_MAX_LOTES  techo de lotes (default 200)
 *   HISTORICO_TANDA      lotes por consulta (default 5)
 *   HISTORICO_PAUSA_MS   pausa entre consultas (default 3000), por el límite de Open-Meteo
 */

function entero(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre]?.trim();
  if (!crudo) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error(`${nombre} debe ser un entero positivo.`);
  return valor;
}

try {
  const resumen = await completarClimaHistorico({
    maxLotes: entero('HISTORICO_MAX_LOTES', 200),
    tamanoTanda: entero('HISTORICO_TANDA', 5),
    pausaMs: entero('HISTORICO_PAUSA_MS', 3_000),
  });
  console.log(JSON.stringify({ evento: 'clima_historico', ...resumen }));
  if (!resumen.disponible) {
    console.error('La base no tiene la migración 016 (clima_historico_lote).');
    process.exitCode = 1;
  } else if (resumen.consultados > 0 && resumen.lotesCompletados === 0) {
    console.error('Ninguna consulta terminó bien: revisá red o límite de consultas de Open-Meteo.');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
