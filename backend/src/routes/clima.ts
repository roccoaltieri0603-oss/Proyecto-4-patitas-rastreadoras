import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { actualizarClimaLote, actualizarClimaLotes } from '../controllers/clima.js';
import { asyncHandler } from '../http/async-handler.js';

export const climaRouter = Router();
climaRouter.use(requiereAutenticacion);

climaRouter.post('/clima/actualizar', asyncHandler(actualizarClimaLotes));
climaRouter.post('/:id/clima/actualizar', asyncHandler(actualizarClimaLote));
