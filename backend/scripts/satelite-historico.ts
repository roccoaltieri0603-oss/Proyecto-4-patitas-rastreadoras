import { pool } from '../src/base-datos/pool.js';
import { escribe, enteroPositivo, leerArgumentos, uuids } from '../src/linea-comandos.js';
import { copernicus } from '../src/services/copernicus.js';
import { DIAS_HISTORIA_POR_DEFECTO, MAXIMO_PU_POR_DEFECTO, completarSateliteHistorico } from '../src/services/satelite-historico.js';

/**
 * Baja la historia de Sentinel-2 de los lotes activos para el historial
 * satelital. Por defecto sólo muestra el plan y las PU estimadas, sin consultar
 * a Copernicus ni escribir.
 *
 *   npm run build && npm run satelite:historico
 *   npm run satelite:historico -- --escribir --lote <uuid> --dias 365
 *
 * Opciones: --dias (default 365), --lote (repetible o con comas), --max-lotes
 * (default 200), --max-pu (default 2000: frena antes de consultar si la
 * estimación lo pasa), --escribir.
 *
 * Escribe en la base de DATABASE_URL y gasta cuota de CDSE: nunca correrlo con
 * --escribir contra una base que no corresponda.
 */

const argumentos = leerArgumentos(process.argv.slice(2), { banderas: ['dry-run', 'escribir'], conValor: ['dias', 'lote', 'max-lotes', 'max-pu'] });
const escribir = escribe(argumentos);
const dias = enteroPositivo(argumentos, 'dias') ?? DIAS_HISTORIA_POR_DEFECTO;
if (dias > 3650) throw new Error('--dias no puede pasar de 3650.');

try {
  if (escribir && !copernicus.credencialesConfiguradas()) {
    console.error('Faltan COPERNICUS_CLIENT_ID y COPERNICUS_CLIENT_SECRET en backend/.env.');
    process.exitCode = 1;
  } else {
    const resumen = await completarSateliteHistorico({
      ids: uuids(argumentos, 'lote'),
      dias,
      maxLotes: enteroPositivo(argumentos, 'max-lotes'),
      maxPu: enteroPositivo(argumentos, 'max-pu') ?? MAXIMO_PU_POR_DEFECTO,
      escribir,
    });
    console.log(JSON.stringify({ evento: escribir ? 'satelite_historico' : 'satelite_historico_plan', ...resumen }, null, 2));
    console.log(`PU estimadas (cota superior): ${resumen.puEstimadas} para ${resumen.lotes.length} lotes, del ${resumen.desde} al ${resumen.hasta}. Cuota gratuita de CDSE: 10.000 PU por mes y 300 por minuto.`);
    if (!escribir) console.log('Dry-run: no se consultó Copernicus ni se escribió nada; para hacerlo, agregá --escribir.');
    if (resumen.detenido) { console.error(resumen.detenido); process.exitCode = 1; }
    if (escribir && resumen.pedidos > 0 && resumen.imagenesNuevas === 0 && resumen.errores.length > 0) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
