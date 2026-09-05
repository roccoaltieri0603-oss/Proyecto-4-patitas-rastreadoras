import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { simularPastoreo } from '../controllers/simulacion.js';
import { asyncHandler } from '../http/async-handler.js';

export const simulacionRouter = Router();
simulacionRouter.use(requiereAutenticacion);

// Preview de demo: es POST porque expresa una intención puntual del usuario,
// no porque escriba algo. No persiste nada.
simulacionRouter.post('/:id/simulacion-pastoreo', asyncHandler(simularPastoreo));
