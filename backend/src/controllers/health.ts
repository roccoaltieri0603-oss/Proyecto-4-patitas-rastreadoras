import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';

export async function readiness(_req: Request, res: Response): Promise<void> {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
}

export function liveness(_req: Request, res: Response): void {
  res.json({ status: 'ok' });
}
