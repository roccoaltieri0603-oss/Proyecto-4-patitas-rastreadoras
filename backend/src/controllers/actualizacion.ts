import type { Request, Response } from 'express';
import { contexto } from '../autorizacion/membresia.js';
import { ApiError } from '../http/errors.js';
import { actualizarAlAbrir } from '../services/actualizacion-al-abrir.js';

/**
 * Refresca el satélite y el clima vencidos del establecimiento que se está
 * abriendo.
 *
 * Deliberadamente **no** exige `actualizar_clima` ni `actualizar_satelite`: no es
 * una acción del usuario sino una tarea del sistema, igual que la rutina diaria.
 * Pedir esos permisos haría que un Visor nunca viera datos frescos, que es
 * justamente el problema que esto viene a resolver. El establecimiento sale del
 * contexto de membresía de la URL, nunca de un ID del cuerpo.
 */
export async function actualizarPendientes(req: Request, res: Response): Promise<void> {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  const { establecimientoId } = contexto(req);
  const resultado = await actualizarAlAbrir(establecimientoId);
  res.json(resultado);
}
