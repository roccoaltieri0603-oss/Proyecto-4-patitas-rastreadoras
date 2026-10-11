import type { RequestHandler } from 'express';

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    req.operacionAsincronaOperativa = true;
    Promise.resolve().then(() => handler(req, res, next)).then(
      () => {
        req.operacionAsincronaOperativa = false;
        if (res.destroyed) req.finalizarBloqueoOperativo?.();
      },
      error => {
        req.operacionAsincronaOperativa = false;
        if (res.destroyed) req.finalizarBloqueoOperativo?.();
        next(error);
      },
    );
  };
}
