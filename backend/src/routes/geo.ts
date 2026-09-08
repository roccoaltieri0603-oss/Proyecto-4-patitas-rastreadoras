import { Router } from 'express';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { buscarLocalidades } from '../services/geocodificacion.js';

/**
 * Buscador de localidades del onboarding.
 *
 * Va detrás de sesión a propósito: sin autenticación esto sería un proxy
 * abierto contra Nominatim, y quien lo encuentre nos gasta la cuota de uso.
 * No toca la base de datos ni persiste nada; sólo traduce texto a coordenadas
 * para poder mover el mapa.
 */
export const geoRouter = Router();

geoRouter.use(requiereAutenticacion);

geoRouter.get(
  '/localidades',
  asyncHandler(async (req, res) => {
    const consulta = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ localidades: await buscarLocalidades(consulta) });
  }),
);
