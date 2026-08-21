import type { RequestHandler } from 'express';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { leerToken, verificarToken } from './session.js';

export const requiereAutenticacion: RequestHandler = async (req, _res, next) => {
  const token = leerToken(req);
  const payload = token ? verificarToken(token) : null;
  if (!payload) {
    next(new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.'));
    return;
  }

  try {
    const result = await pool.query<{ id: string; username: string; onboarding_completed_at: Date | null }>(
      'SELECT id, username, onboarding_completed_at FROM usuarios WHERE id = $1',
      [payload.sub],
    );
    const row = result.rows[0];
    if (!row) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'La sesión no es válida.'));
      return;
    }
    req.usuario = { id: row.id, username: row.username, onboardingCompleted: row.onboarding_completed_at !== null };
    next();
  } catch (error) {
    next(error);
  }
};
