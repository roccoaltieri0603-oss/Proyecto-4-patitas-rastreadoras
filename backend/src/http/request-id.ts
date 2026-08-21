import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function esRequestIdValido(value: string): boolean {
  return REQUEST_ID_VALIDO.test(value);
}

export const asignarRequestId: RequestHandler = (req, res, next) => {
  const recibido = req.get(REQUEST_ID_HEADER)?.trim();
  const requestId = recibido && esRequestIdValido(recibido) ? recibido : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};

