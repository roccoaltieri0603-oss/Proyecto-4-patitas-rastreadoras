import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { obtenerEstadoCopernicus } from '../controllers/copernicus.js';

export const copernicusRouter = Router();
copernicusRouter.use(requiereAutenticacion);
copernicusRouter.get('/estado', obtenerEstadoCopernicus);
