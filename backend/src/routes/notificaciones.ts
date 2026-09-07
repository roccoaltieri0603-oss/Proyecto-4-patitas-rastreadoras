import { Router } from 'express';
import { marcarNotificacionLeida, marcarTodasLeidas, obtenerNotificaciones } from '../controllers/notificaciones.js';
import { asyncHandler } from '../http/async-handler.js';

export const notificacionesRouter = Router({ mergeParams: true });


notificacionesRouter.get('/', asyncHandler(obtenerNotificaciones));
notificacionesRouter.patch('/leidas', asyncHandler(marcarTodasLeidas));
notificacionesRouter.patch('/:id/leida', asyncHandler(marcarNotificacionLeida));
