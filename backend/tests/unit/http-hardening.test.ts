import request from 'supertest';
import express, { type Request, type Response } from 'express';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { reiniciarRateLimitAuth } from '../../src/http/auth-rate-limit.js';

let app: Express;
let pool: Pool;
let guardarCookie: (res: Response, token: string) => void;
let registrarError: (req: Request, status: number, error: unknown) => void;

describe('hardening HTTP', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/rodeo_unit_sin_conexion';
    process.env.AUTH_JWT_SECRET = 'secreto-unitario-con-mas-de-32-caracteres';
    process.env.CORS_ORIGINS = 'https://app.rodeo.test';
    delete process.env.TRUST_PROXY;
    delete process.env.COOKIE_SAME_SITE;

    const modules = await Promise.all([
      import('../../src/app.js'),
      import('../../src/base-datos/pool.js'),
      import('../../src/autenticacion/session.js'),
      import('../../src/http/logger.js'),
    ]);
    app = modules[0].app;
    pool = modules[1].pool;
    guardarCookie = modules[2].guardarCookie;
    registrarError = modules[3].registrarError;
  });

  beforeEach(async () => { await reiniciarRateLimitAuth(); });
  afterAll(async () => { await pool.end(); });

  test('liveness no necesita conectarse a PostgreSQL', async () => {
    const response = await request(app).get('/api/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('readiness devuelve 503 cuando PostgreSQL no está disponible', async () => {
    const query = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB no disponible'));
    try {
      const response = await request(app).get('/api/health/ready');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ status: 'degraded', database: 'unavailable' });
    } finally {
      query.mockRestore();
    }
  });

  test('agrega headers de seguridad y oculta Express', async () => {
    const response = await request(app).get('/api/health/live');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBeTruthy();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  test('acepta request ID seguro y reemplaza uno inválido', async () => {
    const accepted = await request(app).get('/api/health/live').set('X-Request-Id', 'frontend-req_2026');
    expect(accepted.headers['x-request-id']).toBe('frontend-req_2026');

    const replaced = await request(app).get('/api/health/live').set('X-Request-Id', 'valor con espacios');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(replaced.headers['x-request-id']).not.toBe('valor con espacios');
  });

  test('devuelve 400 controlado para JSON malformado y registra su request ID', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Request-Id', 'json-invalido-1')
        .set('Content-Type', 'application/json')
        .send('{"password":"secreto-no-loguear",');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: 'INVALID_JSON', message: 'El cuerpo contiene JSON inválido.' } });
      expect(response.headers['x-request-id']).toBe('json-invalido-1');
      expect(consoleError).toHaveBeenCalled();
      const logs = consoleError.mock.calls.map(([line]) => String(line)).join('\n');
      expect(logs).toContain('"requestId":"json-invalido-1"');
      expect(logs).not.toContain('secreto-no-loguear');
    } finally {
      consoleError.mockRestore();
    }
  });

  test('los logs estructurados redactan secretos de configuración', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      registrarError(
        { requestId: 'redaccion-1', method: 'GET', path: '/error' } as Request,
        500,
        new Error(`falló ${process.env.DATABASE_URL} ${process.env.AUTH_JWT_SECRET}`),
      );
      const logs = consoleError.mock.calls.map(([line]) => String(line)).join('\n');
      expect(logs).toContain('"requestId":"redaccion-1"');
      expect(logs).toContain('[REDACTED]');
      expect(logs).not.toContain(process.env.DATABASE_URL);
      expect(logs).not.toContain(process.env.AUTH_JWT_SECRET);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('rechaza cuerpos mayores a 1 MB con 413 controlado', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: 'x'.repeat(1024 * 1024 + 1) }));

      expect(response.status).toBe(413);
      expect(response.body).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo supera el límite permitido de 1 MB.' } });
    } finally {
      consoleError.mockRestore();
    }
  });

  test('limita login y registro por IP sin afectar health', async () => {
    for (let index = 0; index < 15; index += 1) {
      const response = await request(app).post('/api/auth/login').send({});
      expect(response.status).toBe(400);
    }

    const limited = await request(app).post('/api/auth/register').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('AUTH_RATE_LIMITED');
    expect((await request(app).get('/api/health/live')).status).toBe(200);
  });

  test('la cookie de desarrollo conserva HttpOnly, Lax y no agrega Secure', async () => {
    const cookieApp = express();
    cookieApp.get('/', (_req, res) => {
      guardarCookie(res, 'token-de-prueba');
      res.status(204).send();
    });

    const response = await request(cookieApp).get('/');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  test('CORS permite sólo el origen configurado con credenciales', async () => {
    const allowed = await request(app).get('/api/health/live').set('Origin', 'https://app.rodeo.test');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.rodeo.test');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const preflight = await request(app)
      .options('/api/auth/me')
      .set('Origin', 'https://app.rodeo.test')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://app.rodeo.test');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app).get('/api/health/live').set('Origin', 'https://otro.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
