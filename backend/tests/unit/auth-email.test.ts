import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: db }));
vi.mock('../../src/configuracion/env.js', () => ({ env: {
  authJwtSecret: 'secreto-de-pruebas-unitarias-email-rodeo', cookieSameSite: 'lax', cookieSecure: false,
} }));
import { authRouter } from '../../src/routes/auth.js';
import { errorResponse } from '../../src/http/errors.js';
import { reiniciarRateLimitAuth } from '../../src/http/auth-rate-limit.js';
import { evaluarSchema, columnasEsperadas, constraintsEsperados, indicesEsperados, tablasEsperadas } from '../../src/base-datos/schema-verifier.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const response = errorResponse(error); res.status(response.status).json(response.body);
});
const password = 'password-prueba-2026';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'rocco@example.test', username: 'Rocco', onboarding_completed_at: null };
let hash: string;
beforeAll(async () => { hash = await bcrypt.hash(password, 12); });
beforeEach(async () => { vi.restoreAllMocks(); db.query.mockReset(); await reiniciarRateLimitAuth(); });

describe('autenticación por email sin DB real', () => {
  test('registra email normalizado y username trimmeado con bcrypt costo 12 y JWT por ID', async () => {
    db.query.mockResolvedValue({ rows: [user] });
    const hashSpy = vi.spyOn(bcrypt, 'hash');
    const response = await request(app).post('/api/auth/register').send({ email: '  Rocco@EXAMPLE.TEST  ', username: ' Rocco ', password });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ user: { id: user.id, email: user.email, username: 'Rocco', onboardingCompleted: false } });
    expect(hashSpy).toHaveBeenCalledWith(password, 12);
    const values = db.query.mock.calls[0][1];
    expect(values.slice(0, 2)).toEqual([user.email, 'Rocco']);
    expect(await bcrypt.compare(password, values[2])).toBe(true);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('rodeo_session='); expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Max-Age=604800');
    const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    const payload = jwt.verify(token, 'secreto-de-pruebas-unitarias-email-rodeo') as jwt.JwtPayload;
    expect(payload.sub).toBe(user.id); expect(payload.exp! - payload.iat!).toBe(604800);
    expect(payload).not.toHaveProperty('email');
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  test.each(['', 'sin-arroba', 'a@', '@example.test', 'a@@example.test', 'a b@example.test', 'a@example', null, 12])('rechaza email inválido %j', async (email) => {
    const response = await request(app).post('/api/auth/register').send({ email, username: 'Rocco', password });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_EMAIL'); expect(db.query).not.toHaveBeenCalled();
  });
  test.each(['', '  ', null, 12])('rechaza username inválido %j', async (username) => {
    const response = await request(app).post('/api/auth/register').send({ email: user.email, username, password });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_USERNAME'); expect(db.query).not.toHaveBeenCalled();
  });
  test('conserva mínimo de contraseña', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: user.email, username: 'Rocco', password: '1234567' });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_PASSWORD'); expect(db.query).not.toHaveBeenCalled();
  });
  test.each([['usuarios_email_lower_idx', 'EMAIL_TAKEN'], ['usuarios_username_key', 'USERNAME_TAKEN']])('distingue UNIQUE %s', async (constraint, code) => {
    vi.spyOn(bcrypt, 'hash').mockImplementation(async () => hash);
    db.query.mockRejectedValue({ code: '23505', constraint, detail: 'detalle privado' });
    const response = await request(app).post('/api/auth/register').send({ email: 'ROCCO@EXAMPLE.TEST', username: 'Rocco', password });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe(code); expect(JSON.stringify(response.body)).not.toContain('detalle privado');
  });
  test('login por email normalizado, /me consulta por ID y logout borra la cookie', async () => {
    db.query.mockResolvedValue({ rows: [{ ...user, password_hash: hash }] });
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/login').send({ email: ' ROCCO@EXAMPLE.TEST ', password });
    expect(response.status).toBe(200); expect(response.body.user.email).toBe(user.email);
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE LOWER(email) = $1'), [user.email]);
    expect(JSON.stringify(response.body)).not.toContain('password');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200); expect(me.body).toEqual(response.body);
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('FROM usuarios WHERE id = $1'), [user.id]);
    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(204); expect(logout.headers['set-cookie'][0]).toContain('Max-Age=0');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
  test('no acepta username en lugar de email', async () => {
    const response = await request(app).post('/api/auth/login').send({ username: 'Rocco', password });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_EMAIL'); expect(db.query).not.toHaveBeenCalled();
  });
  test('email inexistente y contraseña incorrecta devuelven el mismo error', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...user, password_hash: hash }] });
    const ausente = await request(app).post('/api/auth/login').send({ email: 'ausente@example.test', password });
    const incorrecta = await request(app).post('/api/auth/login').send({ email: user.email, password: 'incorrecta' });
    expect(ausente.status).toBe(401); expect(incorrecta.status).toBe(401);
    expect(ausente.body).toEqual(incorrecta.body); expect(ausente.body.error.code).toBe('INVALID_CREDENTIALS');
  });
  test('schema exige email no nullable e índice UNIQUE sobre LOWER(email)', () => {
    const snapshot = {
      tablas: [...tablasEsperadas],
      columnas: columnasEsperadas.map(c => ({ table_name: c.tabla, column_name: c.nombre, udt_name: c.tipo, is_nullable: (c.nullable ? 'YES' : 'NO') as 'YES' | 'NO' })),
      constraints: constraintsEsperados.map(c => ({ table_name: c.tabla, contype: c.tipo, definition: c.contiene.join(' ') })),
      indices: indicesEsperados.map(i => ({ tablename: i.tabla, indexname: i.nombre, indexdef: i.contiene.join(' ') })),
    };
    expect(evaluarSchema(snapshot)).toEqual([]);
    snapshot.columnas.find(c => c.table_name === 'usuarios' && c.column_name === 'email')!.is_nullable = 'YES';
    snapshot.indices.find(i => i.indexname === 'usuarios_email_lower_idx')!.indexdef = 'index (email)';
    expect(evaluarSchema(snapshot)).toEqual(expect.arrayContaining([
      'usuarios.email tiene nullable=true; se esperaba false.', 'Falta o no coincide el índice usuarios_email_lower_idx.',
    ]));
  });
});
