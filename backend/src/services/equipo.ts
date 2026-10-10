import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { cargarMembresia, UUID } from '../autorizacion/membresia.js';
import { autorizarCambio, autorizarInvitacion, prohibido, validarConfiguracion } from '../autorizacion/reglas.js';
import { ApiError } from '../http/errors.js';
import { CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN } from '../autorizacion/catalogo.js';
import { notificarResponsableGpsSiHayIncidencia, registrarEventoAdministrativo } from './notificaciones.js';

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
    const antes = { rol: objetivo.rol, permisos: [...objetivo.permisos].sort(), capacidades: [...objetivo.capacidades].sort() };
    const despues = nueva && { rol: nueva.rol, permisos: [...nueva.permisos].sort(), capacidades: [...nueva.capacidades].sort() };
    const cambioEfectivo = !despues || antes.rol !== despues.rol || JSON.stringify(antes.permisos) !== JSON.stringify(despues.permisos) || JSON.stringify(antes.capacidades) !== JSON.stringify(despues.capacidades);
    if (!cambioEfectivo) return;
    const nombres = await db.query<{ actor: string; afectado: string }>(
      `SELECT (SELECT username FROM usuarios WHERE id = $1) AS actor,
              (SELECT username FROM usuarios WHERE id = $2) AS afectado`, [actorId, objetivoId],
    );
    const nombreActor = nombres.rows[0]?.actor ?? 'Un miembro';
    const nombreAfectado = nombres.rows[0]?.afectado ?? 'otro miembro';
    const agregado = (nueva?.permisos ?? []).filter((p) => !objetivo.permisos.includes(p));
    const retirado = objetivo.permisos.filter((p) => !(nueva?.permisos ?? []).includes(p));
    const capacidadesAgregadas = (nueva?.capacidades ?? []).filter((p) => !objetivo.capacidades.includes(p));
    const capacidadesRetiradas = objetivo.capacidades.filter((p) => !(nueva?.capacidades ?? []).includes(p));
    const nombresPermisos = (permisos: string[]) => permisos.map((p) => PERMISOS_ADMIN[p as keyof typeof PERMISOS_ADMIN]?.[1] ?? p);
    const nombresCapacidades = (capacidades: string[]) => capacidades.map((p) => CAPACIDADES_PROPIETARIO[p as keyof typeof CAPACIDADES_PROPIETARIO] ?? p);
    const resumenCambios = [
      ...nombresPermisos(agregado).map((p) => `se agregó ${p}`),
      ...nombresPermisos(retirado).map((p) => `se retiró ${p}`),
      ...nombresCapacidades(capacidadesAgregadas).map((p) => `se agregó la capacidad de ${p.toLocaleLowerCase('es-AR')}`),
      ...nombresCapacidades(capacidadesRetiradas).map((p) => `se retiró la capacidad de ${p.toLocaleLowerCase('es-AR')}`),
    ];
    let tipo: 'permisos_modificados' | 'administrador_incorporado' | 'administrador_eliminado' | null = null;
    let mensaje = '';
    if (objetivo.rol === 'ADMINISTRADOR' && (!nueva || nueva.rol !== 'ADMINISTRADOR')) {
      tipo = 'administrador_eliminado';
      mensaje = nueva
        ? `${nombreActor} cambió el rol de ${nombreAfectado} de Administrador a ${nueva.rol === 'VISOR' ? 'Visor' : 'Propietario'}.${resumenCambios.length ? ` Cambios: ${resumenCambios.join('; ')}.` : ''}`
        : `${nombreActor} eliminó a ${nombreAfectado} del establecimiento.${resumenCambios.length ? ` Se retiraron: ${resumenCambios.join('; ')}.` : ''}`;
    } else if (nueva?.rol === 'ADMINISTRADOR' && objetivo.rol !== 'ADMINISTRADOR') {
      tipo = 'administrador_incorporado';
      mensaje = `${nombreAfectado} se incorporó al establecimiento como administrador.${resumenCambios.length ? ` Configuración: ${resumenCambios.join('; ')}.` : ''}`;
    } else {
      tipo = 'permisos_modificados';
      mensaje = `${nombreActor} modificó los permisos de ${nombreAfectado}: ${resumenCambios.join('; ') || 'cambió su rol'}.`;
    }
    const detalles = {
      rolAnterior: objetivo.rol, rolNuevo: nueva?.rol ?? null,
      permisosAgregados: agregado, permisosRetirados: retirado,
      capacidadesAgregadas, capacidadesRetiradas,
    };
    if (nueva) await db.query('UPDATE membresias SET rol = $3, permisos = $4, capacidades = $5, updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2', [eid, objetivoId, nueva.rol, nueva.permisos, nueva.capacidades]);
    else await db.query('DELETE FROM membresias WHERE establecimiento_id = $1 AND user_id = $2', [eid, objetivoId]);
    if (nueva?.rol !== 'ADMINISTRADOR') {
      await db.query('DELETE FROM responsable_gps_notificaciones WHERE establecimiento_id = $1 AND user_id = $2', [eid, objetivoId]);
    }
    await registrarEventoAdministrativo(db, {
      establecimientoId: eid, tipo, actorId, afectadoId: objetivoId, detalles,
      titulo: tipo === 'permisos_modificados' ? 'Cambios en permisos del equipo' : tipo === 'administrador_incorporado' ? 'Nuevo administrador' : 'Cambio en el equipo',
      mensaje,
      permisoDestinatario: 'gestionar_administradores',
      incluirAfectadoAdministrador: tipo === 'permisos_modificados' && nueva?.rol === 'ADMINISTRADOR',
      excluirAutor: true,
    });
  });
}

export async function designarResponsableGps(eid: string, actorId: string, objetivoId: unknown): Promise<void> {
  if (objetivoId !== null && (typeof objetivoId !== 'string' || !UUID.test(objetivoId))) {
    throw new ApiError(400, 'INVALID_GPS_ADMIN', 'El ID del administrador responsable no es válido.');
  }
  await transaccion(async (db) => {
    await bloquearEstablecimiento(db, eid);
    const actor = await cargarMembresia(eid, actorId, db);
    if (actor.rol !== 'PROPIETARIO') prohibido();
    if (objetivoId === null) {
      await db.query('DELETE FROM responsable_gps_notificaciones WHERE establecimiento_id = $1', [eid]);
      return;
    }
    const destino = await cargarMembresia(eid, objetivoId, db);
    if (destino.rol !== 'ADMINISTRADOR') {
      throw new ApiError(400, 'GPS_ADMIN_REQUIRED', 'El destinatario debe ser Administrador del establecimiento.');
    }
    await db.query(
      `INSERT INTO responsable_gps_notificaciones (establecimiento_id, user_id, actualizado_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (establecimiento_id) DO UPDATE SET user_id = EXCLUDED.user_id,
         actualizado_por = EXCLUDED.actualizado_por, updated_at = NOW()`, [eid, objetivoId, actorId],
    );
    await notificarResponsableGpsSiHayIncidencia(db, eid, objetivoId);
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
    if (invitacion.rol === 'ADMINISTRADOR') {
      const nombre = await db.query<{ username: string }>('SELECT username FROM usuarios WHERE id = $1', [userId]);
      const username = nombre.rows[0]?.username ?? 'Una persona';
      await registrarEventoAdministrativo(db, {
        establecimientoId: eid, tipo: 'administrador_incorporado', actorId: userId, afectadoId: userId,
        titulo: 'Nuevo administrador', mensaje: `${username} se incorporó al establecimiento como administrador.`,
        detalles: { origen: 'invitacion_aceptada', rol: 'ADMINISTRADOR' },
        permisoDestinatario: 'gestionar_administradores', excluirAutor: true,
      });
    }
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
    const nombres = await db.query<{ anterior: string; nuevo: string }>(
      `SELECT (SELECT username FROM usuarios WHERE id = $1) AS anterior,
              (SELECT username FROM usuarios WHERE id = $2) AS nuevo`, [actorId, destinoId],
    );
    await db.query('UPDATE establecimientos SET principal_user_id = $2, updated_at = NOW() WHERE id = $1', [eid, destinoId]);
    await db.query("UPDATE membresias SET capacidades = '{}', updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2", [eid, actorId]);
    await registrarEventoAdministrativo(db, {
      establecimientoId: eid, tipo: 'propiedad_principal_transferida', actorId, afectadoId: destinoId,
      titulo: 'Transferencia de propiedad principal',
      mensaje: `La propiedad principal del establecimiento fue transferida de ${nombres.rows[0]?.anterior ?? 'el propietario anterior'} a ${nombres.rows[0]?.nuevo ?? 'el nuevo propietario'}.`,
      detalles: { propietarioAnteriorId: actorId, propietarioNuevoId: destinoId },
    });
  });
}
