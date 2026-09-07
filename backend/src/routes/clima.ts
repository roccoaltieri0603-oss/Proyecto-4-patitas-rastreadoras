import { requierePermisos } from '../autorizacion/membresia.js';
import { Router } from 'express';
import { actualizarClimaLote, actualizarClimaLotes } from '../controllers/clima.js';
import { asyncHandler } from '../http/async-handler.js';

export const climaRouter = Router({ mergeParams: true });


climaRouter.post('/clima/actualizar', requierePermisos('actualizar_clima'), asyncHandler(actualizarClimaLotes));
climaRouter.post('/:id/clima/actualizar', requierePermisos('actualizar_clima'), asyncHandler(actualizarClimaLote));
