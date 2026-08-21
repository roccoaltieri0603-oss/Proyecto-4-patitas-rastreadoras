import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export function assertTestDatabase(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL no está configurada; se omiten los tests de integración para proteger la base principal.');
  if (process.env.DATABASE_URL && testUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL no puede apuntar a DATABASE_URL.');
  if (!/^postgres(?:ql)?:\/\//.test(testUrl)) throw new Error('TEST_DATABASE_URL no tiene un formato PostgreSQL válido.');
}

export async function migrateTestDatabase(pool: Pool): Promise<void> {
  assertTestDatabase();
  const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) await client.query(await readFile(resolve(migrationsDirectory, file), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resetTestDatabase(pool: Pool): Promise<void> {
  assertTestDatabase();
  await pool.query('TRUNCATE TABLE dias_clima, consultas_clima, mediciones_satelitales, usos_lote, lotes, establecimientos, notificaciones, usuarios RESTART IDENTITY CASCADE');
}
