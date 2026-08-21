import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import {
  crearUsoLote,
  obtenerConsultasClima,
  obtenerEstadoLote,
  obtenerHistorialLote,
  obtenerMedicionesSatelitales,
  obtenerUsosLote,
} from '../controllers/historial.js';
import { asyncHandler } from '../http/async-handler.js';

export const historialRouter = Router();
historialRouter.use(requiereAutenticacion);

historialRouter.get('/:id/mediciones-satelitales', asyncHandler(obtenerMedicionesSatelitales));
historialRouter.get('/:id/clima', asyncHandler(obtenerConsultasClima));
historialRouter.post('/:id/usos', asyncHandler(crearUsoLote));
historialRouter.get('/:id/usos', asyncHandler(obtenerUsosLote));
historialRouter.get('/:id/estado', asyncHandler(obtenerEstadoLote));
historialRouter.get('/:id/historial', asyncHandler(obtenerHistorialLote));
