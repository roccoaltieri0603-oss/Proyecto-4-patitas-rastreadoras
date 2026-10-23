import { Router } from 'express';
import { obtenerEstimacion, obtenerEstimaciones } from '../controllers/estimacion.js';
import { asyncHandler } from '../http/async-handler.js';

export const estimacionRouter = Router({ mergeParams: true });

// Cualquier miembro lee: no escribe nada ni llama a servicios externos.
estimacionRouter.get('/estimacion', asyncHandler(obtenerEstimaciones));
estimacionRouter.get('/:id/estimacion', asyncHandler(obtenerEstimacion));
