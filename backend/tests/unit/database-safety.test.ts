import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import {
  destinoPostgres,
  validarDestinoTest,
  validarIdentidadBaseTest,
  validarMarcaDescartable,
} from '../../src/base-datos/identidad-test.js';
import {
  checksumMigracion,
  validarHistorialMigraciones,
  type ArchivoMigracion,
} from '../../src/base-datos/migration-runner.js';
import { assertTestDatabase } from '../helpers/db.js';

const marker = '9d42bf6b-96eb-4a13-9d1a-b4392cdd7f70';

describe('protección de la base PostgreSQL de tests', () => {
  test('normaliza host, puerto por defecto y nombre codificado de base', () => {
    expect(destinoPostgres('postgresql://user:pass@DB.Example./campo%20test?sslmode=require')).toEqual({
      host: 'db.example', port: 5432, database: 'campo test',
    });
  });

  test('rechaza la misma base aunque cambien usuario, protocolo, opciones o escritura del host', () => {
    expect(() => validarDestinoTest(
      'postgresql://test:one@DB.Example./rodeo?sslmode=require',
      'postgres://admin:two@db.example:5432/rodeo?application_name=api',
    )).toThrow(/mismo host y base/);
  });

  test('permite un destino diferente y requiere un UUID v4 para la marca', () => {
    expect(validarDestinoTest(
      'postgres://test@neon-test.example/rodeo_test',
      'postgres://app@neon-prod.example/rodeo',
    ).database).toBe('rodeo_test');
    expect(validarMarcaDescartable(marker)).toBe(`RODEO_DISPOSABLE_TEST:${marker}`);
    expect(() => validarMarcaDescartable(undefined)).toThrow(/TEST_DATABASE_DISPOSABLE_MARKER/);
    expect(() => validarMarcaDescartable('not-a-uuid')).toThrow(/UUID v4/);
    expect(() => validarDestinoTest('postgres://test@neon-test.example/rodeo_test', undefined))
      .toThrow(/Falta DATABASE_URL/);
  });

  test('exige comentario exacto, propiedad y permisos mínimos del rol de tests', () => {
    const destino = destinoPostgres('postgres://test@neon-test.example/rodeo_test');
    const identidad = {
      database_name: 'rodeo_test',
      database_comment: `RODEO_DISPOSABLE_TEST:${marker}`,
      owns_database: true,
      is_superuser: false,
      can_create_database: false,
      can_create_schema: true,
    };
    expect(() => validarIdentidadBaseTest(identidad, destino, identidad.database_comment!)).not.toThrow();
    expect(() => validarIdentidadBaseTest({ ...identidad, database_comment: null }, destino, identidad.database_comment!))
      .toThrow(/marca explícita/);
    expect(() => validarIdentidadBaseTest({ ...identidad, is_superuser: true }, destino, identidad.database_comment!))
      .toThrow(/superusuario/);
    expect(() => validarIdentidadBaseTest({ ...identidad, can_create_schema: false }, destino, identidad.database_comment!))
      .toThrow(/CREATE/);
  });

  test('falla antes de consultar PostgreSQL si TEST_DATABASE_URL coincide con DATABASE_URL', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      testUrl: process.env.TEST_DATABASE_URL,
      databaseUrl: process.env.DATABASE_URL,
      marker: process.env.TEST_DATABASE_DISPOSABLE_MARKER,
    };
    process.env.NODE_ENV = 'test';
    process.env.TEST_DATABASE_URL = 'postgres://test@DB.Example./rodeo?sslmode=require';
    process.env.DATABASE_URL = 'postgresql://prod@db.example:5432/rodeo?application_name=api';
    process.env.TEST_DATABASE_DISPOSABLE_MARKER = marker;
    const query = vi.fn();
    try {
      await expect(assertTestDatabase({ query } as never)).rejects.toThrow(/mismo host y base/);
      expect(query).not.toHaveBeenCalled();
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.testUrl === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = previous.testUrl;
      if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl;
      if (previous.marker === undefined) delete process.env.TEST_DATABASE_DISPOSABLE_MARKER;
      else process.env.TEST_DATABASE_DISPOSABLE_MARKER = previous.marker;
    }
  });
});

describe('registro de migraciones', () => {
  const archivos: ArchivoMigracion[] = [
    { nombre: '001_base.sql', sql: 'CREATE TABLE a (id int);' },
    { nombre: '002_notificaciones.sql', sql: 'ALTER TABLE a ADD COLUMN notice text;' },
    { nombre: '003_guard.sql', sql: 'CREATE TRIGGER guard;' },
  ];

  test('acepta sólo un prefijo aplicado y calcula checksums SHA-256 estables', () => {
    expect(validarHistorialMigraciones(archivos, [])).toBe(0);
    expect(validarHistorialMigraciones(archivos, [
      { nombre: archivos[0].nombre, checksum: checksumMigracion(archivos[0].sql) },
      { nombre: archivos[1].nombre, checksum: checksumMigracion(archivos[1].sql) },
    ])).toBe(2);
    expect(checksumMigracion(archivos[0].sql)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rechaza huecos, migraciones desconocidas y cambios en SQL ya aplicado', () => {
    expect(() => validarHistorialMigraciones(archivos, [
      { nombre: archivos[1].nombre, checksum: checksumMigracion(archivos[1].sql) },
    ])).toThrow(/prefijo continuo/);
    expect(() => validarHistorialMigraciones(archivos, [
      { nombre: '999_desconocida.sql', checksum: '0'.repeat(64) },
    ])).toThrow(/prefijo continuo/);
    expect(() => validarHistorialMigraciones(archivos, [
      { nombre: archivos[0].nombre, checksum: '0'.repeat(64) },
    ])).toThrow(/checksum/);
  });

  test('la migración 010 declara un constraint trigger diferido que rechaza entregas incompletas', async () => {
    const url = new URL('../../migrations/010_entregas_notificacion_atomicas.sql', import.meta.url);
    const sql = await readFile(url, 'utf8');
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER entregas_eventos_notificacion_completas');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('e.notificacion_id IS NULL');
    expect(sql).toContain('Hay entregas históricas sin notificación');
    expect(sql).toContain("ERRCODE = '23514'");
  });
});
