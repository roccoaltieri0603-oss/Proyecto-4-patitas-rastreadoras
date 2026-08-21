import { Router } from 'express';
import { liveness, readiness } from '../controllers/health.js';

export const healthRouter = Router();

healthRouter.get('/', readiness);
healthRouter.get('/live', liveness);
healthRouter.get('/ready', readiness);
