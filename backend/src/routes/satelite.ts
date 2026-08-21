import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { actualizarSateliteLote, actualizarSateliteLotes } from '../controllers/satelite.js';
import { asyncHandler } from '../http/async-handler.js';

export const sateliteRouter = Router();
sateliteRouter.use(requiereAutenticacion);

sateliteRouter.post('/satelite/actualizar', asyncHandler(actualizarSateliteLotes));
sateliteRouter.post('/:id/satelite/actualizar', asyncHandler(actualizarSateliteLote));
