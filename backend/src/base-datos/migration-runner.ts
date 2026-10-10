import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface ArchivoMigracion {
  nombre: string;
  sql: string;
}

export interface MigracionAplicada {
  nombre: string;
  checksum: string;
}

export function checksumMigracion(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function validarHistorialMigraciones(
  archivos: ArchivoMigracion[],
  aplicadas: MigracionAplicada[],
): number {
  const ordenados = [...archivos].sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (new Set(ordenados.map(({ nombre }) => nombre)).size !== ordenados.length) {
    throw new Error('Hay nombres de migración duplicados en el directorio.');
  }
  const esperadas = aplicadas.map(({ nombre }) => nombre);
  const prefijo = ordenados.slice(0, aplicadas.length).map(({ nombre }) => nombre);
  if (esperadas.some((nombre, index) => nombre !== prefijo[index])) {
    throw new Error('El historial aplicado no es un prefijo continuo de las migraciones disponibles; requiere reconciliación manual.');
  }
  for (let index = 0; index < aplicadas.length; index += 1) {
    if (aplicadas[index].checksum !== checksumMigracion(ordenados[index].sql)) {
      throw new Error(`El checksum de ${aplicadas[index].nombre} cambió; requiere revisión manual.`);
    }
  }
  return aplicadas.length;
}

async function asegurarRegistro(client: PoolClient): Promise<void> {
  const existe = await client.query<{ existe: boolean }>(
    "SELECT to_regclass('public.rodeo_schema_migrations') IS NOT NULL AS existe",
  );
  if (existe.rows[0]?.existe) return;

  const objetos = await client.query<{ cantidad: string }>(
    `SELECT COUNT(*)::text AS cantidad
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
  );
  if (Number(objetos.rows[0]?.cantidad ?? 0) > 0) {
    throw new Error('La base ya contiene objetos pero no tiene schema_migrations; no se asumirá el estado de migración. Requiere reconciliación manual aprobada.');
  }
  await client.query(`CREATE TABLE public.rodeo_schema_migrations (
    nombre TEXT PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function historial(client: PoolClient): Promise<MigracionAplicada[]> {
  const result = await client.query<MigracionAplicada>(
    'SELECT nombre, checksum FROM public.rodeo_schema_migrations ORDER BY nombre',
  );
  return result.rows;
}

export async function aplicarMigraciones(client: PoolClient, archivos: ArchivoMigracion[]): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1::bigint)', ['721834920119']);
  const aplicadasAhora: string[] = [];
  try {
    await client.query('BEGIN');
    await asegurarRegistro(client);
    const aplicadas = await historial(client);
    const siguiente = validarHistorialMigraciones(archivos, aplicadas);
    await client.query('COMMIT');

    const ordenados = [...archivos].sort((a, b) => a.nombre.localeCompare(b.nombre));
    for (const migracion of ordenados.slice(siguiente)) {
      await client.query('BEGIN');
      try {
        await client.query(migracion.sql);
        await client.query(
          'INSERT INTO public.rodeo_schema_migrations (nombre, checksum) VALUES ($1, $2)',
          [migracion.nombre, checksumMigracion(migracion.sql)],
        );
        await client.query('COMMIT');
        aplicadasAhora.push(migracion.nombre);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return aplicadasAhora;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* La transacción puede no estar abierta. */ }
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', ['721834920119']);
  }
}

export async function verificarRegistroMigraciones(client: PoolClient, archivos: ArchivoMigracion[]): Promise<void> {
  const existe = await client.query<{ existe: boolean }>(
    "SELECT to_regclass('public.rodeo_schema_migrations') IS NOT NULL AS existe",
  );
  if (!existe.rows[0]?.existe) throw new Error('Falta rodeo_schema_migrations; no se puede verificar el historial sin reconciliarlo.');
  const aplicadas = await historial(client);
  const siguiente = validarHistorialMigraciones(archivos, aplicadas);
  if (siguiente !== archivos.length) throw new Error(`Faltan ${archivos.length - siguiente} migraciones por aplicar.`);
}
