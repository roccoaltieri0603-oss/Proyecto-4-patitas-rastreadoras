import { Router } from 'express';
import { requierePermisos } from '../autorizacion/membresia.js';
import { crearMedicionAltura, eliminarMedicionAltura, modificarMedicionAltura, obtenerMedicionesAltura } from '../controllers/mediciones-altura.js';
import { asyncHandler } from '../http/async-handler.js';

export const medicionesAlturaRouter = Router({ mergeParams: true });

// Mismos permisos que los usos: son registros de campo del lote.
medicionesAlturaRouter.get('/:id/mediciones-altura', asyncHandler(obtenerMedicionesAltura));
medicionesAlturaRouter.post('/:id/mediciones-altura', requierePermisos('registrar_usos'), asyncHandler(crearMedicionAltura));
medicionesAlturaRouter.patch('/:id/mediciones-altura/:medicionId', requierePermisos('modificar_usos'), asyncHandler(modificarMedicionAltura));
medicionesAlturaRouter.delete('/:id/mediciones-altura/:medicionId', requierePermisos('modificar_usos'), asyncHandler(eliminarMedicionAltura));
