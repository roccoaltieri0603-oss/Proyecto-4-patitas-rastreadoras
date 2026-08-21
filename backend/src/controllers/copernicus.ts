import type { Request, Response } from 'express';
import { copernicus } from '../services/copernicus.js';

export function obtenerEstadoCopernicus(_req: Request, res: Response): void {
  res.json({ configurado: copernicus.credencialesConfiguradas() });
}
