import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { guardarCookie, limpiarCookie, crearToken } from '../autenticacion/session.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';

function datosUsuario(row: { id: string; username: string; onboarding_completed_at: Date | null }) {
  return { id: row.id, username: row.username, onboardingCompleted: row.onboarding_completed_at !== null };
}

function credenciales(body: unknown): { username: string; password: string } {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON.');
  const values = body as Record<string, unknown>;
  if (typeof values.username !== 'string' || !values.username.trim()) {
    throw new ApiError(400, 'INVALID_USERNAME', 'El nombre de usuario es obligatorio.');
  }
  if (typeof values.password !== 'string' || values.password.length < 8) {
    throw new ApiError(400, 'INVALID_PASSWORD', 'La contraseña debe tener al menos 8 caracteres.');
  }
  return { username: values.username.trim(), password: values.password };
}

export async function registrar(req: Request, res: Response): Promise<void> {
  const { username, password } = credenciales(req.body);
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query<{ id: string; username: string; onboarding_completed_at: Date | null }>(
      `INSERT INTO usuarios (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, onboarding_completed_at`,
      [username, passwordHash],
    );
    const user = result.rows[0];
    guardarCookie(res, crearToken(user.id));
    res.status(201).json({ user: datosUsuario(user) });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'USERNAME_TAKEN', 'Ese nombre de usuario ya está en uso.');
    throw error;
  }
}

export async function iniciarSesion(req: Request, res: Response): Promise<void> {
  const { username, password } = credenciales(req.body);
  const result = await pool.query<{ id: string; username: string; password_hash: string; onboarding_completed_at: Date | null }>(
    'SELECT id, username, password_hash, onboarding_completed_at FROM usuarios WHERE username = $1',
    [username],
  );
  const user = result.rows[0];
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'El usuario o la contraseña no son correctos.');
  guardarCookie(res, crearToken(user.id));
  res.json({ user: datosUsuario(user) });
}

export function cerrarSesion(_req: Request, res: Response): void {
  limpiarCookie(res);
  res.status(204).send();
}

export function obtenerSesion(req: Request, res: Response): void {
  res.json({ user: req.usuario });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
