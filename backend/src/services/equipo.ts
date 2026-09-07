import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { cargarMembresia, UUID } from '../autorizacion/membresia.js';
import { autorizarCambio, autorizarInvitacion, prohibido, validarConfiguracion } from '../autorizacion/reglas.js';
import { ApiError } from '../http/errors.js';

export async function transaccion<T>(accion: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const resultado = await accion(db); await db.query('COMMIT'); return resultado; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
export async function bloquearEstablecimiento(db: PoolClient, id: string): Promise<void> {
  const result = await db.query('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE', [id]);
  if (!result.rows[0]) throw new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Establecimiento no disponible.');
}
export async function cambiarMiembro(eid: string, actorId: string, objetivoId: string, body: unknown | null): Promise<void> {
  if (!UUID.test(objetivoId)) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Miembro no disponible.');
  const nueva = body === null ? null : validarConfiguracion(body);
  await transaccion(async db => {
    await bloquearEstablecimiento(db, eid);
    const actor = await cargarMembresia(eid, actorId, db);
    const objetivo = await cargarMembresia(eid, objetivoId, db);
    autorizarCambio(actor, objetivo, nueva);
    if (nueva) await db.query('UPDATE membresias SET rol = $3, permisos = $4, capacidades = $5, updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2', [eid, objetivoId, nueva.rol, nueva.permisos, nueva.capacidades]);
    else await db.query('DELETE FROM membresias WHERE establecimiento_id = $1 AND user_id = $2', [eid, objetivoId]);
  });
}
const hashCodigo = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
export async function crearInvitacion(eid: string, actorId: string, body: unknown) {
  const nueva = validarConfiguracion(body);
  return transaccion(async db => {
    await bloquearEstablecimiento(db, eid);
    autorizarInvitacion(await cargarMembresia(eid, actorId, db), nueva);
    const codigo = randomBytes(24).toString('base64url');
    const result = await db.query(`INSERT INTO invitaciones (establecimiento_id, created_by, codigo_hash, rol, permisos, capacidades)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`, [eid, actorId, hashCodigo(codigo), nueva.rol, nueva.permisos, nueva.capacidades]);
    return { id: result.rows[0].id, codigo, expiresAt: result.rows[0].expires_at };
  });
}
function codigoInvalido(): never { throw new ApiError(400, 'INVALID_INVITATION', 'El código no es válido, ya se usó o venció.'); }
export async function aceptarInvitacion(userId: string, codigo: unknown, establecimientoEsperado?: unknown): Promise<string> {
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(codigo.trim())) codigoInvalido();
  const hash = hashCodigo(codigo.trim());
  return transaccion(async db => {
    const inicial = await db.query('SELECT establecimiento_id FROM invitaciones WHERE codigo_hash = $1', [hash]);
    const eid = inicial.rows[0]?.establecimiento_id as string | undefined;
    if (!eid || (establecimientoEsperado !== undefined && establecimientoEsperado !== eid)) codigoInvalido();
    // Mismo orden de locks que gestión/transferencia: establecimiento, luego invitación.
    try { await bloquearEstablecimiento(db, eid); }
    catch (error) { if (error instanceof ApiError) codigoInvalido(); throw error; }
    const result = await db.query('SELECT *, expires_at > clock_timestamp() AS vigente FROM invitaciones WHERE codigo_hash = $1 FOR UPDATE', [hash]);
    const invitacion = result.rows[0];
    if (!invitacion || invitacion.used_at || !invitacion.vigente) codigoInvalido();
    const duplicada = await db.query('SELECT 1 FROM membresias WHERE establecimiento_id = $1 AND user_id = $2', [eid, userId]);
    if (duplicada.rows.length) throw new ApiError(409, 'ALREADY_MEMBER', 'Ya pertenecés a ese establecimiento. El código no se consumió.');
    // Una invitación pendiente no conserva privilegios que el creador ya perdió.
    try { autorizarInvitacion(await cargarMembresia(eid, invitacion.created_by, db), validarConfiguracion(invitacion)); }
    catch (error) { if (error instanceof ApiError) codigoInvalido(); throw error; }
    await db.query('INSERT INTO membresias (establecimiento_id, user_id, rol, permisos, capacidades) VALUES ($1,$2,$3,$4,$5)', [eid, userId, invitacion.rol, invitacion.permisos, invitacion.capacidades]);
    await db.query('UPDATE invitaciones SET used_at = clock_timestamp(), used_by = $2 WHERE id = $1', [invitacion.id, userId]);
    return eid;
  });
}

export async function transferirPrincipal(eid: string, actorId: string, destinoId: string): Promise<void> {
  if (!UUID.test(destinoId)) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Miembro no disponible.');
  await transaccion(async db => {
    await bloquearEstablecimiento(db, eid);
    const actor = await cargarMembresia(eid, actorId, db);
    if (!actor.principal || actorId === destinoId) prohibido();
    const destino = await cargarMembresia(eid, destinoId, db);
    if (destino.rol !== 'PROPIETARIO') throw new ApiError(400, 'OWNER_REQUIRED', 'El destinatario debe ser otro Propietario del establecimiento.');
    await db.query('UPDATE establecimientos SET principal_user_id = $2, updated_at = NOW() WHERE id = $1', [eid, destinoId]);
    await db.query("UPDATE membresias SET capacidades = '{}', updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2", [eid, actorId]);
  });
}
