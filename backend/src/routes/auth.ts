import { Router } from 'express';
import { cerrarSesion, iniciarSesion, obtenerSesion, registrar } from '../controllers/auth.js';
import { requiereAutenticacion } from '../autenticacion/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { authRateLimiter } from '../http/auth-rate-limit.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, asyncHandler(registrar));
authRouter.post('/login', authRateLimiter, asyncHandler(iniciarSesion));
authRouter.post('/logout', cerrarSesion);
authRouter.get('/me', requiereAutenticacion, obtenerSesion);
