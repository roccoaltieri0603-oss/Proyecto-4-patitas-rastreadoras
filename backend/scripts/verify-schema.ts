import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/base-datos/pool.js';
import { verificarRegistroMigraciones, type ArchivoMigracion } from '../src/base-datos/migration-runner.js';
import { evaluarSchema, obtenerSnapshotSchema, tablasEsperadas } from '../src/base-datos/schema-verifier.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = scriptDirectory.endsWith('dist\\scripts') || scriptDirectory.endsWith('dist/scripts')
  ? '../../migrations'
  : '../migrations';
const migrationPath = resolve(scriptDirectory, migrationDirectory);

try {
  const archivos: ArchivoMigracion[] = await Promise.all(
    (await readdir(migrationPath)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
      .map(async (nombre) => ({ nombre, sql: await readFile(resolve(migrationPath, nombre), 'utf8') })),
  );
  const snapshot = await obtenerSnapshotSchema(pool);
  const errores = evaluarSchema(snapshot);
  const extras = snapshot.tablas.filter((tabla) => !tablasEsperadas.includes(tabla as typeof tablasEsperadas[number]));
  const client = await pool.connect();
  try {
    await verificarRegistroMigraciones(client, archivos);
    const trigger = await client.query<{ deferrable: boolean; initially_deferred: boolean }>(
      `SELECT tgdeferrable AS deferrable, tginitdeferred AS initially_deferred
         FROM pg_trigger
        WHERE tgname = 'entregas_eventos_notificacion_completas'
          AND tgrelid = 'public.entregas_eventos_notificacion'::regclass
          AND NOT tgisinternal`,
    );
    if (trigger.rows.length !== 1 || !trigger.rows[0].deferrable || !trigger.rows[0].initially_deferred) {
      errores.push('Falta el constraint trigger diferido que exige vincular cada entrega con su notificación.');
    }
  } catch (error) {
    errores.push(error instanceof Error ? error.message : 'No se pudo verificar el historial de migraciones.');
  } finally {
    client.release();
  }

  if (errores.length > 0) {
    console.error('Verificación de schema e historial fallida:');
    errores.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Schema e historial verificados: ${tablasEsperadas.length} tablas de dominio, restricciones, índices, ${archivos.length} migraciones con checksum y trigger diferido de entregas.`);
    if (extras.length > 0) console.log(`Tablas técnicas/adicionales detectadas: ${extras.join(', ')}.`);
  }
} finally {
  await pool.end();
}
