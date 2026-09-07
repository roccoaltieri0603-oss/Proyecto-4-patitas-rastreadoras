import { requierePermisos } from '../autorizacion/membresia.js';
import { Router } from 'express';
import {
  crearUsoLote,
  modificarUsoLote,
  eliminarUsoLote,
  obtenerConsultasClima,
  obtenerEstadoLote,
  obtenerHistorialLote,
  obtenerMedicionesSatelitales,
  obtenerUsosLote,
} from '../controllers/historial.js';
import { asyncHandler } from '../http/async-handler.js';

export const historialRouter = Router({ mergeParams: true });


historialRouter.get('/:id/mediciones-satelitales', asyncHandler(obtenerMedicionesSatelitales));
historialRouter.get('/:id/clima', asyncHandler(obtenerConsultasClima));
historialRouter.post('/:id/usos', requierePermisos('registrar_usos'), asyncHandler(crearUsoLote));
historialRouter.get('/:id/usos', asyncHandler(obtenerUsosLote));
historialRouter.patch('/:id/usos/:usoId', requierePermisos('modificar_usos'), asyncHandler(modificarUsoLote));
historialRouter.delete('/:id/usos/:usoId', requierePermisos('modificar_usos'), asyncHandler(eliminarUsoLote));
historialRouter.get('/:id/estado', asyncHandler(obtenerEstadoLote));
historialRouter.get('/:id/historial', asyncHandler(obtenerHistorialLote));
