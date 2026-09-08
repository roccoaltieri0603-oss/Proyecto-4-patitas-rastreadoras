import { establecimientosRouter } from './routes/establecimientos.js';
import cors from 'cors';
import express from 'express';
import * as helmetModule from 'helmet';
import { env } from './configuracion/env.js';
import { ApiError, errorResponse } from './http/errors.js';
import { registrarError } from './http/logger.js';
import { asignarRequestId } from './http/request-id.js';
import { authRouter } from './routes/auth.js';
import { copernicusRouter } from './routes/copernicus.js';
import { geoRouter } from './routes/geo.js';
import { healthRouter } from './routes/health.js';

export const app = express();
const helmet = helmetModule.default;

app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');
app.use(asignarRequestId);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({
  credentials: true,
  origin: (origin, callback) => callback(null, !origin || env.corsOrigins.includes(origin)),
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRouter);
app.use('/api/copernicus', copernicusRouter);
app.use('/api/auth', authRouter);
app.use('/api/geo', geoRouter);
app.use('/api/establecimientos', establecimientosRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) { next(error); return; }
  const response = errorResponse(error);
  if (!(error instanceof ApiError) || response.status >= 500) registrarError(req, response.status, error);
  res.status(response.status).json(response.body);
});

export default app;
