import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../configuracion/env.js';
import type { JwtPayload } from './types.js';

export const COOKIE_NAME = 'rodeo_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function atributosCookie(maxAge: number): string {
  const sameSite = `${env.cookieSameSite[0].toUpperCase()}${env.cookieSameSite.slice(1)}`;
  const secure = env.cookieSecure ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
}

export function crearToken(userId: string): string {
  return jwt.sign({}, env.authJwtSecret, { subject: userId, expiresIn: MAX_AGE_SECONDS });
}

export function leerToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookie = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null;
}

export function verificarToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, env.authJwtSecret);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function guardarCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; ${atributosCookie(MAX_AGE_SECONDS)}`);
}

export function limpiarCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${atributosCookie(0)}`);
}
