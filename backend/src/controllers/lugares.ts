import type { Request, Response } from 'express';
import { ApiError } from '../http/errors.js';
import { geocodificacion } from '../services/geocodificacion.js';

/** Busca un lugar por nombre para llevar el mapa hasta ahí. No persiste nada. */
export async function buscarLugar(req: Request, res: Response): Promise<void> {
  const texto = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (texto.length < 3 || texto.length > 120) {
    throw new ApiError(400, 'Escribí entre 3 y 120 caracteres para buscar.', 'INVALID_PLACE_QUERY');
  }
  res.json({ lugares: await geocodificacion.buscar(texto) });
}
