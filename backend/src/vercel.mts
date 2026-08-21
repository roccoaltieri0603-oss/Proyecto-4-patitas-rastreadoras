import type { Express } from 'express';
import app from './app.js';

// .mts conserva inequívocamente ESM en el handler generado por Vercel; la app
// compartida no abre un puerto y server.ts mantiene el arranque local.
const vercelApp: Express = app;

export default vercelApp;
