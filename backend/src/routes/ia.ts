import { requierePermisos } from '../autorizacion/membresia.js';
import { Router } from 'express';
import { obtenerEstadoIa, sugerirLotes } from '../controllers/ia.js';
import { asyncHandler } from '../http/async-handler.js';

export const iaRouter = Router({ mergeParams: true });


iaRouter.get('/estado', obtenerEstadoIa);
iaRouter.post('/sugerir-lotes', requierePermisos('usar_ia'), asyncHandler(sugerirLotes));
