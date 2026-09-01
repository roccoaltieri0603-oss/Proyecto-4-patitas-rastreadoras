import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { obtenerEstadoIa, sugerirLotes } from '../controllers/ia.js';
import { asyncHandler } from '../http/async-handler.js';

export const iaRouter = Router();
iaRouter.use(requiereAutenticacion);

iaRouter.get('/estado', obtenerEstadoIa);
iaRouter.post('/sugerir-lotes', asyncHandler(sugerirLotes));
