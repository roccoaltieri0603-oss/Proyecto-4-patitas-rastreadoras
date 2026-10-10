import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const confirmationFlag = '--confirmar-reconciliacion-neon';
if (!process.argv.includes(confirmationFlag)) {
  throw new Error(`Se requiere ${confirmationFlag}; este comando escribe el historial de migraciones en Neon.`);
}

const sqlPath = resolve('scripts/reconcile-migration-history-001-007.sql');
const sql = await readFile(sqlPath, 'utf8');
const migrationDirectory = resolve('../backend/migrations');
const entries = [...sql.matchAll(/\('([0-9]{3}_[^']+\.sql)', '([0-9a-f]{64})'\)/g)];
const expectedNames = [
  '001_initial_schema.sql', '002_lote_usos.sql', '003_clima_origen.sql',
  '004_lotes_favoritos.sql', '005_usuarios_email.sql',
  '006_multiusuario.sql', '007_invitaciones_constraints.sql',
];

if (entries.length !== expectedNames.length || entries.some(([_, name], index) => name !== expectedNames[index])) {
  throw new Error('El SQL no contiene exactamente el prefijo esperado 001–007. No se conectó a PostgreSQL.');
}

for (const [_, name, expectedHash] of entries) {
  const content = await readFile(resolve(migrationDirectory, name), 'utf8');
  const actualHash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`Cambió ${name} desde la preparación del SQL. No se conectó a PostgreSQL.`);
  }
}

const { pool } = await import('../src/base-datos/pool.js');
const client = await pool.connect();
try {
  const identity = (await client.query<{ database_name: string; role_name: string }>(
    'SELECT current_database() AS database_name, current_user AS role_name',
  )).rows[0];
  if (identity.database_name !== 'neondb' || identity.role_name !== 'neondb_owner') {
    throw new Error('La conexión no coincide con la identidad de base y rol revisada para esta reconciliación.');
  }

  await client.query(sql);
  console.log('Historial inicial reconciliado: 001–007. No se ejecutaron migraciones de esquema.');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* Si PostgreSQL ya cerró la transacción, liberar la conexión la revierte. */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
