import { describe, expect, test } from 'vitest';
import { parseEnv } from '../../src/configuracion/parse-env.js';

const SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';

describe('configuración de entorno', () => {
  test('aplica defaults seguros en desarrollo', () => {
    const config = parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3001,
      corsOrigins: [],
      trustProxy: false,
      cookieSameSite: 'lax',
      cookieSecure: false,
    });
  });

  test('parsea orígenes exactos, proxy y puerto configurables', () => {
    const config = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgresql://db/rodeo',
      AUTH_JWT_SECRET: SECRET,
      CORS_ORIGINS: 'https://rodeo.example, https://admin.rodeo.example,https://rodeo.example',
      TRUST_PROXY: '1',
      COOKIE_SAME_SITE: 'strict',
    });

    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(['https://rodeo.example', 'https://admin.rodeo.example']);
    expect(config.trustProxy).toBe(1);
    expect(config.cookieSecure).toBe(true);
    expect(config.cookieSameSite).toBe('strict');
  });

  test('rechaza variables obligatorias o formatos inválidos', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: 'corto' })).toThrow('AUTH_JWT_SECRET');
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: ' '.repeat(40) })).toThrow('AUTH_JWT_SECRET');
    expect(() => parseEnv({ DATABASE_URL: 'https://db/rodeo', AUTH_JWT_SECRET: SECRET })).toThrow('protocolo');
    expect(() => parseEnv({ NODE_ENV: 'staging', DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET })).toThrow('NODE_ENV');
    expect(() => parseEnv({ PORT: '0', DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET })).toThrow('PORT');
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET, CORS_ORIGINS: '*' })).toThrow('CORS_ORIGINS');
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET, CORS_ORIGINS: 'https://rodeo.example/api' })).toThrow('sin path');
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://db/rodeo', AUTH_JWT_SECRET: SECRET, TRUST_PROXY: '11' })).toThrow('TRUST_PROXY');
  });

  test('en test exige una base separada y nunca cae en DATABASE_URL', () => {
    expect(() => parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://db/real', AUTH_JWT_SECRET: SECRET })).toThrow('TEST_DATABASE_URL');
    expect(() => parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://db/misma',
      TEST_DATABASE_URL: 'postgresql://db/misma',
      AUTH_JWT_SECRET: SECRET,
    })).toThrow('no puede ser igual');

    const config = parseEnv({ NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://db/test', AUTH_JWT_SECRET: SECRET });
    expect(config.databaseUrl).toBe('postgresql://db/test');
  });

  test('SameSite=None sólo se admite con cookie Secure en producción', () => {
    expect(() => parseEnv({
      DATABASE_URL: 'postgresql://db/rodeo',
      AUTH_JWT_SECRET: SECRET,
      COOKIE_SAME_SITE: 'none',
    })).toThrow('NODE_ENV=production');

    const config = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db/rodeo',
      AUTH_JWT_SECRET: SECRET,
      COOKIE_SAME_SITE: 'none',
    });
    expect(config.cookieSameSite).toBe('none');
    expect(config.cookieSecure).toBe(true);
  });
});
