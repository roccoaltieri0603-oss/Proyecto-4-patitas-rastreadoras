import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { actualizarEstablecimiento, crearEstablecimiento, obtenerEstablecimiento } from '../controllers/establecimiento.js';
import { asyncHandler } from '../http/async-handler.js';

export const establecimientoRouter = Router();
establecimientoRouter.use(requiereAutenticacion);

establecimientoRouter.get('/', asyncHandler(obtenerEstablecimiento));
establecimientoRouter.post('/', asyncHandler(crearEstablecimiento));
establecimientoRouter.patch('/', asyncHandler(actualizarEstablecimiento));
