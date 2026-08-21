export type NodeEnvironment = 'development' | 'test' | 'production';
export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface ConfiguracionEntorno {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  authJwtSecret: string;
  copernicusClientId: string;
  copernicusClientSecret: string;
  corsOrigins: string[];
  trustProxy: false | number;
  cookieSameSite: CookieSameSite;
  cookieSecure: boolean;
}

type Variables = Record<string, string | undefined>;

function nodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value?.trim() || 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }
  return nodeEnv;
}

function port(value: string | undefined): number {
  const raw = value?.trim() || '3001';
  if (!/^\d+$/.test(raw)) throw new Error('PORT debe ser un entero entre 1 y 65535.');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('PORT debe ser un entero entre 1 y 65535.');
  return parsed;
}

function postgresUrl(value: string, variable: 'DATABASE_URL' | 'TEST_DATABASE_URL'): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(`${variable} debe ser una URL válida de PostgreSQL.`); }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${variable} debe usar el protocolo postgres:// o postgresql://.`);
  }
  return value;
}

function corsOrigins(value: string | undefined): string[] {
  const origins = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(origins.map((origin) => {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error(`CORS_ORIGINS contiene un origen inválido: ${origin}`); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin.replace(/\/$/, '')) {
      throw new Error(`CORS_ORIGINS debe contener orígenes HTTP(S) sin path: ${origin}`);
    }
    return parsed.origin;
  }))];
}

function trustProxy(value: string | undefined): false | number {
  const raw = value?.trim();
  if (!raw) return false;
  if (!/^\d+$/.test(raw)) throw new Error('TRUST_PROXY debe ser un número entero de saltos entre 1 y 10.');
  const parsed = Number(raw);
  if (parsed < 1 || parsed > 10) throw new Error('TRUST_PROXY debe ser un número entero de saltos entre 1 y 10.');
  return parsed;
}

function cookieSameSite(value: string | undefined): CookieSameSite {
  const parsed = value?.trim().toLowerCase() || 'lax';
  if (parsed !== 'lax' && parsed !== 'strict' && parsed !== 'none') throw new Error('COOKIE_SAME_SITE debe ser lax, strict o none.');
  return parsed;
}

export function parseEnv(variables: Variables): ConfiguracionEntorno {
  const environment = nodeEnvironment(variables.NODE_ENV);
  const isTest = environment === 'test';
  const rawDatabaseUrl = (isTest ? variables.TEST_DATABASE_URL : variables.DATABASE_URL)?.trim();
  if (!rawDatabaseUrl) {
    throw new Error(isTest
      ? 'Falta TEST_DATABASE_URL para ejecutar tests de integración; nunca se usa DATABASE_URL como fallback.'
      : 'Falta DATABASE_URL.');
  }
  if (isTest && variables.DATABASE_URL?.trim() && rawDatabaseUrl === variables.DATABASE_URL.trim()) {
    throw new Error('TEST_DATABASE_URL no puede ser igual a DATABASE_URL.');
  }
  const databaseUrl = postgresUrl(rawDatabaseUrl, isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL');

  const authJwtSecret = variables.AUTH_JWT_SECRET ?? '';
  if (authJwtSecret.trim().length < 32) throw new Error('Falta AUTH_JWT_SECRET o tiene menos de 32 caracteres útiles.');

  const sameSite = cookieSameSite(variables.COOKIE_SAME_SITE);
  const secure = environment === 'production';
  if (sameSite === 'none' && !secure) throw new Error('COOKIE_SAME_SITE=none requiere cookies Secure y sólo se admite con NODE_ENV=production.');

  return {
    nodeEnv: environment,
    port: port(variables.PORT),
    databaseUrl,
    authJwtSecret,
    copernicusClientId: variables.COPERNICUS_CLIENT_ID?.trim() ?? '',
    copernicusClientSecret: variables.COPERNICUS_CLIENT_SECRET?.trim() ?? '',
    corsOrigins: corsOrigins(variables.CORS_ORIGINS),
    trustProxy: trustProxy(variables.TRUST_PROXY),
    cookieSameSite: sameSite,
    cookieSecure: secure,
  };
}
