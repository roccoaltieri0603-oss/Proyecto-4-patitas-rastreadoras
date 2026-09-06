import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { guardarCookie, limpiarCookie, crearToken } from '../autenticacion/session.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';

function datosUsuario(row: { id: string; email: string; username: string; onboarding_completed_at: Date | null }) {
  return { id: row.id, email: row.email, username: row.username, onboardingCompleted: row.onboarding_completed_at !== null };
}

function credenciales(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON.');
  const values = body as Record<string, unknown>;
  const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'INVALID_EMAIL', 'Ingresá un email válido.');
  }
  if (typeof values.password !== 'string' || values.password.length < 8) {
    throw new ApiError(400, 'INVALID_PASSWORD', 'La contraseña debe tener al menos 8 caracteres.');
  }
  return { email, password: values.password };
}

export async function registrar(req: Request, res: Response): Promise<void> {
  const { email, password } = credenciales(req.body);
  const username = (req.body as Record<string, unknown>).username;
  if (typeof username !== 'string' || !username.trim()) {
    throw new ApiError(400, 'INVALID_USERNAME', 'El nombre de usuario es obligatorio.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query<{ id: string; email: string; username: string; onboarding_completed_at: Date | null }>(
      `INSERT INTO usuarios (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, onboarding_completed_at`,
      [email, username.trim(), passwordHash],
    );
    const user = result.rows[0];
    guardarCookie(res, crearToken(user.id));
    res.status(201).json({ user: datosUsuario(user) });
  } catch (error) {
    if (isUniqueViolation(error) && 'constraint' in error) {
      if (error.constraint === 'usuarios_email_lower_idx') throw new ApiError(409, 'EMAIL_TAKEN', 'Ese email ya está en uso.');
      if (error.constraint === 'usuarios_username_key') throw new ApiError(409, 'USERNAME_TAKEN', 'Ese nombre de usuario ya está en uso.');
    }
    throw error;
  }
}

export async function iniciarSesion(req: Request, res: Response): Promise<void> {
  const { email, password } = credenciales(req.body);
  const result = await pool.query<{ id: string; email: string; username: string; password_hash: string; onboarding_completed_at: Date | null }>(
    'SELECT id, email, username, password_hash, onboarding_completed_at FROM usuarios WHERE LOWER(email) = $1',
    [email],
  );
  const user = result.rows[0];
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'El email o la contraseña no son correctos.');
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

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
