import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool } from '../src/base-datos/pool.js';
import { aplicarMigraciones, type ArchivoMigracion } from '../src/base-datos/migration-runner.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = scriptDirectory.endsWith('dist\\scripts') || scriptDirectory.endsWith('dist/scripts')
  ? '../../migrations'
  : '../migrations';
const migrationPath = resolve(scriptDirectory, migrationDirectory);

try {
  const files: ArchivoMigracion[] = await Promise.all(
    (await readdir(migrationPath)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
      .map(async (nombre) => ({ nombre, sql: await readFile(resolve(migrationPath, nombre), 'utf8') })),
  );
  if (files.length === 0) throw new Error('No se encontraron migraciones SQL.');
  const client = await pool.connect();
  try {
    const aplicadas = await aplicarMigraciones(client, files);
    if (aplicadas.length === 0) console.log('El esquema ya está actualizado y los checksums coinciden.');
    else aplicadas.forEach((nombre) => console.log(`Migración aplicada: ${nombre}`));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
