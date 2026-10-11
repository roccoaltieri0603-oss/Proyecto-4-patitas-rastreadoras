import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expectedHost = 'ep-restless-dew-ayvpt4ob.c-5.us-east-2.aws.neon.tech';
const expectedDatabase = 'rodeo_integration_tests';
const expectedRole = 'rodeo_integration_sql';

function parsePostgresUrl(value: string | undefined, name: string): URL {
  if (!value) throw new Error(`Falta ${name}; las pruebas de integración se cancelan.`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error();
    return url;
  } catch {
    throw new Error(`${name} no contiene una URL PostgreSQL válida.`);
  }
}

function requireMatchingValue(name: string, fromFile: string | undefined): void {
  if (!fromFile) throw new Error(`Falta ${name} en backend/.env.test.local; las pruebas se cancelan.`);
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess !== fromFile) {
    throw new Error(`${name} del proceso no coincide con backend/.env.test.local; se cancela para evitar un destino ambiguo.`);
  }
  process.env[name] = fromFile;
}

const mainEnvPath = resolve(backendDirectory, '.env');
const testEnvPath = resolve(backendDirectory, '.env.test.local');
let mainEnv: Record<string, string> = {};
let testEnv: Record<string, string>;
try {
  mainEnv = parse(await readFile(mainEnvPath));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('No se pudo leer backend/.env para comparar el destino principal.');
  }
}
try {
  testEnv = parse(await readFile(testEnvPath));
} catch {
  throw new Error('No se pudo leer backend/.env.test.local; las pruebas de integración se cancelan.');
}

requireMatchingValue('TEST_DATABASE_URL', testEnv.TEST_DATABASE_URL);
requireMatchingValue('TEST_DATABASE_DISPOSABLE_MARKER', testEnv.TEST_DATABASE_DISPOSABLE_MARKER);

const testUrl = parsePostgresUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
const mainDatabaseUrl = mainEnv.DATABASE_URL
  ?? (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ? process.env.DATABASE_URL : undefined);
const mainUrl = parsePostgresUrl(mainDatabaseUrl, 'DATABASE_URL principal para comparar');
// El guardarraíl del helper vuelve a comparar ambas identidades. Pasa sólo
// host, puerto y base a process.env; nunca necesita propagar credenciales.
process.env.DATABASE_URL = `postgresql://integration-identity-check@${mainUrl.hostname}${mainUrl.port ? `:${mainUrl.port}` : ''}${mainUrl.pathname}`;
const testDatabase = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
const mainDatabase = decodeURIComponent(mainUrl.pathname.replace(/^\//, ''));
const testRole = decodeURIComponent(testUrl.username);
if (testUrl.hostname.toLowerCase() !== expectedHost
  || testDatabase !== expectedDatabase
  || testRole !== expectedRole
  || testUrl.hostname.toLowerCase().includes('-pooler')) {
  throw new Error('TEST_DATABASE_URL no apunta al endpoint directo, base descartable y rol restringido esperados de test-integracion-rodeo.');
}
if (testUrl.hostname.toLowerCase() === mainUrl.hostname.toLowerCase()
  && (testUrl.port || '5432') === (mainUrl.port || '5432')
  && testDatabase === mainDatabase) {
  throw new Error('TEST_DATABASE_URL coincide con DATABASE_URL; las pruebas de integración se cancelan.');
}

const marker = process.env.TEST_DATABASE_DISPOSABLE_MARKER;
if (!marker || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker)) {
  throw new Error('TEST_DATABASE_DISPOSABLE_MARKER debe ser un UUID v4 asignado a la base descartable.');
}
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('NODE_ENV debe ser test para ejecutar pruebas de integración.');
}
process.env.NODE_ENV = 'test';
