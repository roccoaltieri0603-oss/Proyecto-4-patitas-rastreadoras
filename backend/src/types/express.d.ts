import type { Usuario } from '../autenticacion/types.js';
import type { Membresia } from '../autorizacion/catalogo.js';

declare global {
  namespace Express {
    interface Request {
      usuario?: Usuario;
      membresia?: Membresia;
      requestId?: string;
    }
  }
}

export {};
