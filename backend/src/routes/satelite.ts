import { requierePermisos } from '../autorizacion/membresia.js';
import { Router } from 'express';
import { actualizarSateliteLote, actualizarSateliteLotes } from '../controllers/satelite.js';
import { asyncHandler } from '../http/async-handler.js';

export const sateliteRouter = Router({ mergeParams: true });


sateliteRouter.post('/satelite/actualizar', requierePermisos('actualizar_satelite'), asyncHandler(actualizarSateliteLotes));
sateliteRouter.post('/:id/satelite/actualizar', requierePermisos('actualizar_satelite'), asyncHandler(actualizarSateliteLote));
