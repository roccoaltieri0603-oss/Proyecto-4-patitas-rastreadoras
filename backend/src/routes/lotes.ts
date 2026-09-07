import { requierePermisos, requiereCampos } from '../autorizacion/membresia.js';
import { Router } from 'express';
import { actualizarFavoritoLote, actualizarLote, crearLote, eliminarLote, obtenerEstadoLotes, obtenerLotes } from '../controllers/lotes.js';
import { asyncHandler } from '../http/async-handler.js';
import { obtenerLecturasCompartidas } from '../controllers/lotes.js';

export const lotesRouter = Router({ mergeParams: true });


lotesRouter.get('/estado', asyncHandler(obtenerEstadoLotes));
lotesRouter.get('/lecturas', asyncHandler(obtenerLecturasCompartidas));
lotesRouter.get('/', asyncHandler(obtenerLotes));
lotesRouter.post('/', requierePermisos('crear_lotes'), asyncHandler(crearLote));
lotesRouter.patch('/:id/favorito', asyncHandler(actualizarFavoritoLote));
lotesRouter.patch('/:id', requiereCampos({apodo: 'editar_lotes', activo: 'activar_lotes', polygon: 'editar_geometria_lotes'}), asyncHandler(actualizarLote));
lotesRouter.delete('/:id', requierePermisos('eliminar_lotes'), asyncHandler(eliminarLote));
