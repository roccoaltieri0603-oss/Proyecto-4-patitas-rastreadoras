import { pool } from '../src/base-datos/pool.js';
import { escribe, enteroPositivo, fecha, leerArgumentos, uuids } from '../src/linea-comandos.js';
import { completarClimaHistorico, planificarClimaHistorico, type OpcionesClimaHistorico } from '../src/services/clima-historico.js';

/**
 * Completa de una vez el clima histórico que les falta a los lotes para la
 * estimación de forraje, sin consultar satélite ni el clima regular. La
 * actualización programada hace lo mismo de a 40 lotes por día; esto sirve
 * para la primera carga.
 *
 *   npm run build && npm run clima:historico                  muestra qué haría, sin consultar ni escribir
 *   npm run clima:historico -- --escribir                     consulta Open-Meteo y guarda
 *   npm run clima:historico -- --lote <uuid> --desde 2026-01-01 --max-lotes 20
 *
 * Opcional por entorno:
 *   HISTORICO_TANDA      lotes por consulta (default 5)
 *   HISTORICO_PAUSA_MS   pausa entre consultas (default 3000), por el límite de Open-Meteo
 *
 * Escribe en la base de DATABASE_URL: nunca correrlo con --escribir contra una
 * base que no corresponda.
 */

function enteroDeEntorno(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre]?.trim();
  if (!crudo) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error(`${nombre} debe ser un entero positivo.`);
  return valor;
}

const argumentos = leerArgumentos(process.argv.slice(2), { banderas: ['dry-run', 'escribir'], conValor: ['desde', 'lote', 'max-lotes'] });
const opciones: OpcionesClimaHistorico = {
  ids: uuids(argumentos, 'lote'),
  desde: fecha(argumentos, 'desde'),
  maxLotes: enteroPositivo(argumentos, 'max-lotes') ?? 200,
  tamanoTanda: enteroDeEntorno('HISTORICO_TANDA', 5),
  pausaMs: enteroDeEntorno('HISTORICO_PAUSA_MS', 3_000),
};

try {
  if (!escribe(argumentos)) {
    const plan = await planificarClimaHistorico(opciones);
    console.log(JSON.stringify({ evento: 'clima_historico_plan', ...plan }, null, 2));
    if (!plan.disponible) {
      console.error('La base no tiene la migración 016 (clima_historico_lote).');
      process.exitCode = 1;
    } else {
      console.log(`Dry-run: ${plan.lotes.length} lotes, ${plan.diasFaltantes} días faltantes, ~${plan.llamadasEstimadas} llamadas a Open-Meteo (límite gratuito: 10.000 por día). No se consultó ni se escribió nada; para guardar, agregá --escribir.`);
    }
  } else {
    const resumen = await completarClimaHistorico(opciones);
    console.log(JSON.stringify({ evento: 'clima_historico', ...resumen }));
    if (!resumen.disponible) {
      console.error('La base no tiene la migración 016 (clima_historico_lote).');
      process.exitCode = 1;
    } else if (resumen.consultados > 0 && resumen.lotesCompletados === 0) {
      console.error('Ninguna consulta terminó bien: revisá red o límite de consultas de Open-Meteo.');
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
