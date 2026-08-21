import type { Request } from 'express';
import { env } from '../configuracion/env.js';

function redactar(value: string | undefined): string | undefined {
  if (!value) return value;
  const secretos = [
    env.databaseUrl,
    env.authJwtSecret,
    env.copernicusClientSecret,
    process.env.COPERNICUS_CLIENT_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  const oculto = secretos.reduce((resultado, secret) => resultado.replaceAll(secret, '[REDACTED]'), value);
  return oculto.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@');
}

export function registrarError(req: Request, status: number, error: unknown): void {
  const detalle = error instanceof Error
    ? { nombre: error.name, mensaje: redactar(error.message), stack: redactar(error.stack) }
    : { nombre: 'UnknownError', mensaje: 'Error no serializable.' };
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    requestId: req.requestId ?? 'sin-request-id',
    method: req.method,
    path: req.path,
    status,
    error: detalle,
  }));
}
