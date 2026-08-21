import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool } from '../src/base-datos/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = scriptDirectory.endsWith('dist\\scripts') || scriptDirectory.endsWith('dist/scripts')
  ? '../../migrations'
  : '../migrations';
const migrationPath = resolve(scriptDirectory, migrationDirectory);

try {
  const files = (await readdir(migrationPath))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  if (files.length === 0) throw new Error('No se encontraron migraciones SQL.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      await client.query(await readFile(resolve(migrationPath, file), 'utf8'));
      console.log(`Migración aplicada: ${file}`);
    }
    await client.query('COMMIT');
    console.log('Migraciones aplicadas correctamente.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
