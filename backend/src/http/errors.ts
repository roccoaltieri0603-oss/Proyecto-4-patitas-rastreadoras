export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function errorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') return { status: 400, body: { error: { code: 'INVALID_JSON', message: 'El cuerpo contiene JSON inválido.' } } };
    if (error.type === 'entity.too.large') return { status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo supera el límite permitido de 1 MB.' } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' } } };
}

