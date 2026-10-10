import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { validarDestinoTest, validarIdentidadBaseTest, validarMarcaDescartable } from '../../src/base-datos/identidad-test.js';
import { aplicarMigraciones, type ArchivoMigracion } from '../../src/base-datos/migration-runner.js';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function assertTestDatabase(pool: Pick<PoolClient, 'query'>): Promise<void> {
  if (process.env.NODE_ENV !== 'test') throw new Error('Las operaciones destructivas de tests requieren NODE_ENV=test.');
  const destino = validarDestinoTest(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  const marca = validarMarcaDescartable(process.env.TEST_DATABASE_DISPOSABLE_MARKER);
  const identidad = await pool.query<{
    database_name: string;
    database_comment: string | null;
    owns_database: boolean;
    is_superuser: boolean;
    can_create_database: boolean;
    can_create_schema: boolean;
  }>(
    `SELECT d.datname AS database_name,
            shobj_description(d.oid, 'pg_database') AS database_comment,
            pg_has_role(current_user, d.datdba, 'USAGE') AS owns_database,
            r.rolsuper AS is_superuser,
            r.rolcreatedb AS can_create_database,
            has_database_privilege(current_user, d.datname, 'CREATE')
              AND has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema
       FROM pg_database d JOIN pg_roles r ON r.rolname = current_user
      WHERE d.datname = current_database()`,
  );
  if (identidad.rows.length !== 1) throw new Error('No se pudo confirmar la identidad de la base de tests.');
  validarIdentidadBaseTest(identidad.rows[0], destino, marca);
}

export async function migrateTestDatabase(pool: Pool): Promise<void> {
  const files: ArchivoMigracion[] = await Promise.all(
    (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
      .map(async (nombre) => ({ nombre, sql: await readFile(resolve(migrationsDirectory, nombre), 'utf8') })),
  );
  const client = await pool.connect();
  try {
    await assertTestDatabase(client);
    await aplicarMigraciones(client, files);
  } finally {
    client.release();
  }
}

export async function resetTestDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await assertTestDatabase(client);
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE ejecuciones_actualizacion_proveedor, estado_fallos_actualizacion, responsable_gps_notificaciones, entregas_eventos_notificacion, notificaciones, eventos_establecimiento, incidencias_establecimiento, dias_clima, consultas_clima, mediciones_satelitales, usos_lote, lotes_favoritos, lotes, invitaciones, membresias, establecimientos, usuarios RESTART IDENTITY CASCADE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
