import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { contexto } from '../autorizacion/membresia.js';
import { aceptarInvitacion, cambiarMiembro, crearInvitacion, transferirPrincipal } from '../services/equipo.js';
import { ApiError } from '../http/errors.js';

export async function obtenerEquipo(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  const result = await pool.query(`SELECT m.user_id AS "userId", m.establecimiento_id AS "establecimientoId", u.username,
    m.rol, m.permisos, m.capacidades, e.principal_user_id = m.user_id AS principal
    FROM membresias m JOIN usuarios u ON u.id = m.user_id JOIN establecimientos e ON e.id = m.establecimiento_id
    WHERE m.establecimiento_id = $1 ORDER BY principal DESC, u.username`, [actor.establecimientoId]);
  res.json({ miembros: result.rows });
}
export async function modificarMiembro(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  await cambiarMiembro(actor.establecimientoId, actor.userId, req.params.userId, req.body);
  res.status(204).send();
}
export async function expulsarMiembro(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  await cambiarMiembro(actor.establecimientoId, actor.userId, req.params.userId, null);
  res.status(204).send();
}
export async function generarInvitacion(req: Request, res: Response): Promise<void> {
  const actor = contexto(req);
  res.status(201).json({ invitacion: await crearInvitacion(actor.establecimientoId, actor.userId, req.body) });
}
export async function unirse(req: Request, res: Response): Promise<void> {
  const establecimientoId = await aceptarInvitacion(req.usuario!.id, req.body?.codigo, req.body?.establecimientoId);
  res.status(201).json({ establecimientoId });
}
export async function transferir(req: Request, res: Response): Promise<void> {
  if (req.body?.confirmacion !== 'TRANSFERIR') throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirmá la transferencia escribiendo TRANSFERIR.');
  const actor = contexto(req);
  await transferirPrincipal(actor.establecimientoId, actor.userId, String(req.body?.userId ?? ''));
  res.status(204).send();
}
