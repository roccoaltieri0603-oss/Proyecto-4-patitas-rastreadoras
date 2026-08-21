import { MemoryStore, rateLimit } from 'express-rate-limit';

const store = new MemoryStore();

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'AUTH_RATE_LIMITED', message: 'Demasiados intentos de autenticación. Esperá unos minutos y volvé a intentar.' } });
  },
});

export async function reiniciarRateLimitAuth(): Promise<void> {
  await store.resetAll();
}

