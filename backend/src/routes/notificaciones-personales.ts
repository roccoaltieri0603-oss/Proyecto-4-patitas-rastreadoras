import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { eliminarNotificacionPersonalLeida, listarNotificacionesPersonales, marcarNotificacionPersonalLeida, marcarTodasPersonalesLeidas } from '../controllers/notificaciones-personales.js';

export const notificacionesPersonalesRouter = Router();
notificacionesPersonalesRouter.use(requiereAutenticacion);
notificacionesPersonalesRouter.get('/', asyncHandler(listarNotificacionesPersonales));
notificacionesPersonalesRouter.patch('/leidas', asyncHandler(marcarTodasPersonalesLeidas));
notificacionesPersonalesRouter.patch('/:id/leida', asyncHandler(marcarNotificacionPersonalLeida));
notificacionesPersonalesRouter.delete('/:id', asyncHandler(eliminarNotificacionPersonalLeida));
