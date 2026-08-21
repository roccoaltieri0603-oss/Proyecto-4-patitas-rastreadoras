import type { Usuario } from '../autenticacion/types.js';

declare global {
  namespace Express {
    interface Request {
      usuario?: Usuario;
      requestId?: string;
    }
  }
}

export {};
