import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { actualizarFavoritoLote, actualizarLote, crearLote, eliminarLote, obtenerEstadoLotes, obtenerLotes } from '../controllers/lotes.js';
import { asyncHandler } from '../http/async-handler.js';

export const lotesRouter = Router();
lotesRouter.use(requiereAutenticacion);

lotesRouter.get('/estado', asyncHandler(obtenerEstadoLotes));
lotesRouter.get('/', asyncHandler(obtenerLotes));
lotesRouter.post('/', asyncHandler(crearLote));
lotesRouter.patch('/:id/favorito', asyncHandler(actualizarFavoritoLote));
lotesRouter.patch('/:id', asyncHandler(actualizarLote));
lotesRouter.delete('/:id', asyncHandler(eliminarLote));
