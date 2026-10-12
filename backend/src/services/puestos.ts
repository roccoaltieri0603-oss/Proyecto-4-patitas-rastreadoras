import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import type { Membresia, Rol } from '../autorizacion/catalogo.js';
import { CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN, nombreAutorOperativo } from '../autorizacion/catalogo.js';
import { autorizarCambio, autorizarInvitacion, prohibido, validarConfiguracion } from '../autorizacion/reglas.js';
import { ApiError } from '../http/errors.js';
import { transaccion } from './equipo.js';
import { notificarResponsableGpsSiHayIncidencia, registrarEventoAdministrativo } from './notificaciones.js';

interface Puesto {
  id: string; establecimiento_id: string; nombre: string; rol: Rol;
  permisos: Membresia['permisos']; capacidades: Membresia['capacidades'];
  propietario_user_id: string | null; legacy_user_id: string | null;
  predeterminado: boolean; activo: boolean;
}
const codigoHash = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
const rolVisible = (rol: Rol) => rol === 'PROPIETARIO' ? 'Propietario' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor';
function descripcionCambios(
  actor: Membresia, puesto: Puesto,
  agregados: Membresia['permisos'], retirados: Membresia['permisos'],
  capacidadesAgregadas: Membresia['capacidades'], capacidadesRetiradas: Membresia['capacidades'],
): string {
  const permiso = (p: Membresia['permisos'][number]) => PERMISOS_ADMIN[p][1].toLocaleLowerCase('es-AR');
  const capacidad = (p: Membresia['capacidades'][number]) => `la capacidad de ${CAPACIDADES_PROPIETARIO[p].toLocaleLowerCase('es-AR')}`;
  const suma = [...agregados.map(permiso), ...capacidadesAgregadas.map(capacidad)];
  const resta = [...retirados.map(permiso), ...capacidadesRetiradas.map(capacidad)];
  const autor = nombreAutorOperativo(actor);
  if (suma.length === 1 && resta.length === 0) return `${autor} le otorgó al puesto ${puesto.nombre} ${suma[0].startsWith('la capacidad') ? suma[0] : `el permiso de ${suma[0]}`}.`;
  if (resta.length === 1 && suma.length === 0) return `${autor} le quitó al puesto ${puesto.nombre} ${resta[0].startsWith('la capacidad') ? resta[0] : `el permiso de ${resta[0]}`}.`;
  const partes = [suma.length ? `agregó ${suma.join(', ')}` : '', resta.length ? `retiró ${resta.join(', ')}` : ''].filter(Boolean);
  return `${autor} modificó los permisos de ${puesto.nombre}: ${partes.join(' y ')}.`;
}
async function bloquearGestion(db: PoolClient, eid: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rodeo:equipo:${eid}`]);
}

async function puestoBloqueado(db: PoolClient, eid: string, puestoId: string): Promise<Puesto> {
  const result = await db.query<Puesto>(
    'SELECT * FROM puestos_operativos WHERE id = $1 AND establecimiento_id = $2 AND activo FOR UPDATE', [puestoId, eid],
  );
  if (!result.rows[0]) throw new ApiError(404, 'OPERATION_POST_NOT_FOUND', 'Puesto no disponible.');
  return result.rows[0];
}

async function actorActual(db: PoolClient, actor: Membresia): Promise<Membresia> {
  if (!actor.puestoOperativoId) prohibido();
  const puesto = await puestoBloqueado(db, actor.establecimientoId, actor.puestoOperativoId);
  const sesion = await db.query(
    `SELECT 1 FROM sesiones_operativas WHERE id = $1 AND puesto_operativo_id = $2
       AND user_id = $3 AND terminada_en IS NULL AND vence_en > clock_timestamp()`,
    [actor.sesionOperativaId, puesto.id, actor.userId],
  );
  if (!sesion.rows.length) throw new ApiError(409, 'OPERATION_SESSION_LOST', 'Esta cuenta operativa ya no está disponible.');
  const acceso = puesto.propietario_user_id === actor.userId || (await db.query(
    'SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2',
    [puesto.id, actor.userId],
  )).rows.length > 0;
  if (!acceso) prohibido();
  const principal = puesto.rol === 'PROPIETARIO' && (await db.query<{ principal_user_id: string }>(
    'SELECT principal_user_id FROM establecimientos WHERE id = $1', [actor.establecimientoId],
  )).rows[0]?.principal_user_id === actor.userId;
  return { establecimientoId: actor.establecimientoId, userId: actor.userId,
    puestoOperativoId: puesto.id, nombreOperativo: puesto.nombre, rol: puesto.rol,
    permisos: puesto.permisos, capacidades: puesto.capacidades, principal };
}

function comoMiembro(puesto: Puesto, userId: string, principal = false): Membresia {
  return { establecimientoId: puesto.establecimiento_id, userId, puestoOperativoId: puesto.id,
    nombreOperativo: puesto.nombre, rol: puesto.rol, permisos: puesto.permisos,
    capacidades: puesto.capacidades, principal };
}

export async function listarEquipoOperativo(eid: string, incluirActividad = false): Promise<{ puestos: Array<Puesto & { integrantes: Array<{ userId: string; username: string; ultimaActividadEn?: Date | null; enLinea?: boolean }> }>; responsableGpsPuestoId: string | null }> {
  const [puestos, miembros, gps, actividad] = await Promise.all([
    pool.query<Puesto>('SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND activo ORDER BY rol, predeterminado DESC, nombre', [eid]),
    pool.query<{ puesto_operativo_id: string; user_id: string; username: string }>(
      `SELECT i.puesto_operativo_id, i.user_id, u.username FROM integrantes_puesto i
       JOIN usuarios u ON u.id = i.user_id WHERE i.establecimiento_id = $1
       UNION ALL SELECT p.id, p.propietario_user_id, u.username FROM puestos_operativos p
       JOIN usuarios u ON u.id = p.propietario_user_id
       WHERE p.establecimiento_id = $1 AND p.activo AND p.rol = 'PROPIETARIO'`, [eid],
    ),
    pool.query<{ puesto_operativo_id: string }>(
      'SELECT puesto_operativo_id FROM responsable_gps_notificaciones WHERE establecimiento_id = $1', [eid],
    ),
    incluirActividad ? pool.query<{ user_id: string; ultima_actividad_en: Date; en_linea: boolean }>(
      `SELECT DISTINCT ON (s.user_id) s.user_id, s.ultima_actividad_en,
         (s.terminada_en IS NULL AND s.vence_en > clock_timestamp()) AS en_linea
       FROM sesiones_operativas s WHERE s.establecimiento_id = $1
       ORDER BY s.user_id, s.ultima_actividad_en DESC, s.id DESC`, [eid],
    ) : Promise.resolve({ rows: [] as Array<{ user_id: string; ultima_actividad_en: Date; en_linea: boolean }> }),
  ]);
  const porUsuario = new Map(actividad.rows.map((fila) => [fila.user_id, fila]));
  return { puestos: puestos.rows.map((p) => ({ ...p, integrantes: miembros.rows
    .filter((m) => m.puesto_operativo_id === p.id).map((m) => {
      const ultimo = porUsuario.get(m.user_id);
      return { userId: m.user_id, username: m.username,
        ...(incluirActividad ? { ultimaActividadEn: ultimo?.ultima_actividad_en ?? null, enLinea: ultimo?.en_linea ?? false } : {}) };
    }) })),
    responsableGpsPuestoId: gps.rows[0]?.puesto_operativo_id ?? null };
}

export async function crearPuestoAdministrador(actor: Membresia, body: unknown): Promise<string> {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'INVALID_POST', 'El puesto no es válido.');
  const datos = body as Record<string, unknown>;
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  const config = validarConfiguracion({ rol: 'ADMINISTRADOR', permisos: datos.permisos ?? [], capacidades: [] });
  if (!nombre || nombre.length > 80) throw new ApiError(400, 'INVALID_POST', 'El nombre del puesto debe tener entre 1 y 80 caracteres.');
  return transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    if (actual.rol !== 'PROPIETARIO') prohibido();
    const result = await db.query<{ id: string }>(
      `INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, permisos)
       VALUES ($1,$2,'ADMINISTRADOR',$3) RETURNING id`, [actor.establecimientoId, nombre, config.permisos],
    );
    return result.rows[0].id;
  });
}

export async function cambiarPermisosPuesto(actor: Membresia, puestoId: string, body: unknown): Promise<void> {
  const config = validarConfiguracion(body);
  await transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    const puesto = await puestoBloqueado(db, actor.establecimientoId, puestoId);
    if (actual.puestoOperativoId === puesto.id || puesto.rol !== config.rol) prohibido();
    const principalObjetivo = puesto.rol === 'PROPIETARIO' && (await db.query<{ principal_user_id: string }>(
      'SELECT principal_user_id FROM establecimientos WHERE id = $1', [actor.establecimientoId],
    )).rows[0]?.principal_user_id === puesto.propietario_user_id;
    const objetivo = comoMiembro(puesto, puesto.propietario_user_id ?? puesto.id, principalObjetivo);
    autorizarCambio(actual, objetivo, config);
    const anteriores = { permisos: puesto.permisos, capacidades: puesto.capacidades };
    if (JSON.stringify([...puesto.permisos].sort()) === JSON.stringify([...config.permisos].sort())
      && JSON.stringify([...puesto.capacidades].sort()) === JSON.stringify([...config.capacidades].sort())) return;
    await db.query('UPDATE puestos_operativos SET permisos = $2, capacidades = $3, updated_at = NOW() WHERE id = $1',
      [puesto.id, config.permisos, config.capacidades]);
    if (puesto.rol === 'PROPIETARIO') {
      await db.query('UPDATE membresias SET capacidades = $3, updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2',
        [actor.establecimientoId, puesto.propietario_user_id, config.capacidades]);
    }
    const agregados = config.permisos.filter((p) => !puesto.permisos.includes(p));
    const retirados = puesto.permisos.filter((p) => !config.permisos.includes(p));
    const capacidadesAgregadas = config.capacidades.filter((p) => !puesto.capacidades.includes(p));
    const capacidadesRetiradas = puesto.capacidades.filter((p) => !config.capacidades.includes(p));
    await registrarEventoAdministrativo(db, {
      establecimientoId: actor.establecimientoId, tipo: 'permisos_modificados', actorId: actual.userId,
      actorPuestoId: actual.puestoOperativoId, afectadoPuestoId: puesto.id,
      afectadoId: puesto.propietario_user_id,
      titulo: 'Permisos del equipo actualizados',
      mensaje: descripcionCambios(actual, puesto, agregados, retirados, capacidadesAgregadas, capacidadesRetiradas),
      detalles: { puestoOperativoId: puesto.id, anteriores, nuevos: config,
        permisosAgregados: agregados, permisosRetirados: retirados,
        capacidadesAgregadas, capacidadesRetiradas },
      permisoDestinatario: 'gestionar_administradores', incluirAfectadoAdministrador: puesto.rol === 'ADMINISTRADOR',
      excluirAutor: true,
    });
  });
}

export async function expulsarIntegrante(actor: Membresia, puestoId: string, userId: string): Promise<void> {
  await transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    const puesto = await puestoBloqueado(db, actor.establecimientoId, puestoId);
    const existe = puesto.propietario_user_id === userId || (await db.query(
      'SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2', [puesto.id, userId],
    )).rows.length > 0;
    if (!existe) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Integrante no disponible.');
    const objetivo = comoMiembro(puesto, userId, puesto.rol === 'PROPIETARIO' &&
      (await db.query<{ principal_user_id: string }>('SELECT principal_user_id FROM establecimientos WHERE id = $1',
        [actor.establecimientoId])).rows[0]?.principal_user_id === userId);
    autorizarCambio(actual, objetivo, null);
    await db.query(
      `UPDATE sesiones_operativas SET terminada_en = NOW(), motivo_fin = 'expulsion'
       WHERE puesto_operativo_id = $1 AND user_id = $2 AND terminada_en IS NULL`, [puesto.id, userId],
    );
    if (puesto.rol === 'PROPIETARIO') {
      await db.query('UPDATE puestos_operativos SET activo = FALSE, updated_at = NOW() WHERE id = $1', [puesto.id]);
      await db.query('DELETE FROM membresias WHERE establecimiento_id = $1 AND user_id = $2', [actor.establecimientoId, userId]);
    } else {
      await db.query('DELETE FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2', [puesto.id, userId]);
      await db.query(`DELETE FROM membresias m WHERE m.establecimiento_id = $1 AND m.user_id = $2
        AND NOT EXISTS (SELECT 1 FROM puestos_operativos p WHERE p.establecimiento_id = $1
          AND p.activo AND p.propietario_user_id = $2)`, [actor.establecimientoId, userId]);
    }
    await registrarEventoAdministrativo(db, {
      establecimientoId: actor.establecimientoId,
      tipo: puesto.rol === 'ADMINISTRADOR' ? 'administrador_eliminado' : 'permisos_modificados',
      actorId: actual.userId, actorPuestoId: actual.puestoOperativoId, afectadoId: userId,
      afectadoPuestoId: puesto.id, titulo: 'Miembro expulsado',
      mensaje: `${nombreAutorOperativo(actual)} expulsó a un ${rolVisible(puesto.rol).toLocaleLowerCase('es-AR')} del establecimiento.`,
      detalles: { puestoOperativoId: puesto.id, rolAnterior: puesto.rol, rolNuevo: null,
        permisosAnteriores: puesto.permisos, capacidadesAnteriores: puesto.capacidades },
      permisoDestinatario: 'gestionar_administradores', excluirAutor: true,
    });
  });
}

export async function cambiarRolIntegrante(actor: Membresia, origenId: string, userId: string, nuevoRol: Rol): Promise<string> {
  if (!['PROPIETARIO', 'ADMINISTRADOR', 'VISOR'].includes(nuevoRol)) {
    throw new ApiError(400, 'INVALID_MEMBERSHIP', 'El rol no es válido.');
  }
  return transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    const origen = await puestoBloqueado(db, actor.establecimientoId, origenId);
    if (origen.rol === nuevoRol) throw new ApiError(400, 'UNCHANGED_ROLE', 'El rol no cambió.');
    const miembro = origen.propietario_user_id === userId || (await db.query(
      'SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2', [origen.id, userId],
    )).rows.length > 0;
    if (!miembro) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Integrante no disponible.');
    const principal = origen.rol === 'PROPIETARIO' && (await db.query<{ principal_user_id: string }>(
      'SELECT principal_user_id FROM establecimientos WHERE id = $1', [actor.establecimientoId],
    )).rows[0]?.principal_user_id === userId;
    let destino: Puesto | null = null;
    if (nuevoRol !== 'PROPIETARIO') {
      destino = (await db.query<Puesto>(
        `SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND rol = $2
         AND predeterminado AND activo FOR UPDATE`, [actor.establecimientoId, nuevoRol],
      )).rows[0] ?? null;
      if (!destino) throw new ApiError(409, 'DEFAULT_POST_MISSING', 'Falta el puesto predeterminado.');
      const duplicada = await db.query('SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2',
        [destino.id, userId]);
      if (duplicada.rows.length) throw new ApiError(409, 'ALREADY_MEMBER', 'Ya pertenecés a ese puesto.');
    }
    autorizarCambio(actual, comoMiembro(origen, userId, principal),
      validarConfiguracion(destino ?? { rol: 'PROPIETARIO', permisos: [], capacidades: [] }));
    await db.query(
      `UPDATE sesiones_operativas SET terminada_en = NOW(), motivo_fin = 'permiso_cambiado'
       WHERE puesto_operativo_id = $1 AND user_id = $2 AND terminada_en IS NULL`, [origen.id, userId],
    );
    if (origen.rol === 'PROPIETARIO') {
      await db.query('UPDATE puestos_operativos SET activo = FALSE, updated_at = NOW() WHERE id = $1', [origen.id]);
      await db.query('DELETE FROM membresias WHERE establecimiento_id = $1 AND user_id = $2', [actor.establecimientoId, userId]);
    } else {
      await db.query('DELETE FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2', [origen.id, userId]);
      await db.query('DELETE FROM membresias WHERE establecimiento_id = $1 AND user_id = $2 AND rol <> \'PROPIETARIO\'',
        [actor.establecimientoId, userId]);
    }
    if (nuevoRol === 'PROPIETARIO') {
      destino = (await db.query<Puesto>(
        `INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, propietario_user_id)
         VALUES ($1,'Propietario','PROPIETARIO',$2) RETURNING *`, [actor.establecimientoId, userId],
      )).rows[0];
      await db.query("INSERT INTO membresias (establecimiento_id, user_id, rol) VALUES ($1,$2,'PROPIETARIO') ON CONFLICT (establecimiento_id,user_id) DO UPDATE SET rol = 'PROPIETARIO', permisos = '{}', capacidades = '{}'",
        [actor.establecimientoId, userId]);
    } else {
      await db.query('INSERT INTO integrantes_puesto (establecimiento_id, puesto_operativo_id, user_id) VALUES ($1,$2,$3)',
        [actor.establecimientoId, destino!.id, userId]);
    }
    const rango: Record<Rol, number> = { VISOR: 0, ADMINISTRADOR: 1, PROPIETARIO: 2 };
    const verbo = rango[nuevoRol] > rango[origen.rol] ? 'ascendió' : 'cambió el rol de';
    const mensaje = verbo === 'ascendió'
      ? `${nombreAutorOperativo(actual)} ascendió a un miembro de ${rolVisible(origen.rol)} a ${rolVisible(nuevoRol)}.`
      : `${nombreAutorOperativo(actual)} cambió el rol de un miembro de ${rolVisible(origen.rol)} a ${rolVisible(nuevoRol)}.`;
    await registrarEventoAdministrativo(db, {
      establecimientoId: actor.establecimientoId, actorId: actor.userId,
      actorPuestoId: actual.puestoOperativoId, afectadoId: userId, afectadoPuestoId: destino!.id,
      tipo: origen.rol === 'ADMINISTRADOR' ? 'administrador_eliminado'
        : nuevoRol === 'ADMINISTRADOR' ? 'administrador_incorporado' : 'permisos_modificados',
      titulo: 'Cambio de rol en el equipo', mensaje,
      detalles: { puestoAnteriorId: origen.id, puestoNuevoId: destino!.id,
        rolAnterior: origen.rol, rolNuevo: nuevoRol,
        permisosAnteriores: origen.permisos, permisosNuevos: destino!.permisos,
        capacidadesAnteriores: origen.capacidades, capacidadesNuevas: destino!.capacidades },
      permisoDestinatario: 'gestionar_administradores', excluirAutor: true,
    });
    return destino!.id;
  });
}

export async function generarInvitacionPuesto(actor: Membresia, body: unknown): Promise<{ id: string; codigo: string; expiresAt: Date }> {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'INVALID_INVITATION', 'Elegí un rol o puesto.');
  const datos = body as Record<string, unknown>;
  return transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    let puesto: Puesto | null = null;
    if (typeof datos.puestoOperativoId === 'string') {
      puesto = await puestoBloqueado(db, actor.establecimientoId, datos.puestoOperativoId);
      if (puesto.rol === 'PROPIETARIO') prohibido();
    } else if (datos.rol === 'PROPIETARIO') {
      puesto = null;
    } else if (datos.rol === 'ADMINISTRADOR' || datos.rol === 'VISOR') {
      const predeterminado = await db.query<Puesto>(
        'SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND rol = $2 AND predeterminado AND activo FOR UPDATE',
        [actor.establecimientoId, datos.rol],
      );
      puesto = predeterminado.rows[0] ?? null;
      if (!puesto) throw new ApiError(409, 'DEFAULT_POST_MISSING', 'Falta el puesto predeterminado.');
    } else throw new ApiError(400, 'INVALID_INVITATION', 'Elegí un rol o puesto.');
    const config = validarConfiguracion(puesto ?? { rol: 'PROPIETARIO', capacidades: datos.capacidades ?? [], permisos: [] });
    autorizarInvitacion(actual, config);
    const codigo = randomBytes(24).toString('base64url');
    const result = await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO invitaciones
        (establecimiento_id, created_by, creador_puesto_operativo_id, codigo_hash,
         puesto_operativo_id, rol, permisos, capacidades)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, expires_at`,
      [actor.establecimientoId, actor.userId, actual.puestoOperativoId, codigoHash(codigo),
        puesto?.id ?? null, config.rol, config.permisos, config.capacidades],
    );
    return { id: result.rows[0].id, codigo, expiresAt: result.rows[0].expires_at };
  });
}

function codigoInvalido(): never { throw new ApiError(400, 'INVALID_INVITATION', 'El código no es válido, ya se usó o venció.'); }
export async function aceptarInvitacionPuesto(userId: string, codigo: unknown, establecimientoEsperado?: unknown): Promise<{ establecimientoId: string; puestoOperativoId: string }> {
  // El código tiene alta entropía y un alfabeto cerrado; quitar sólo espacios
  // permite pegarlo con saltos de línea sin aceptar caracteres adicionales.
  const codigoNormalizado = typeof codigo === 'string' ? codigo.replace(/\s/gu, '') : '';
  if (!/^[A-Za-z0-9_-]{32}$/.test(codigoNormalizado)) codigoInvalido();
  return transaccion(async (db) => {
    const inicial = await db.query<{ establecimiento_id: string }>(
      'SELECT establecimiento_id FROM invitaciones WHERE codigo_hash = $1', [codigoHash(codigoNormalizado)],
    );
    const eid = inicial.rows[0]?.establecimiento_id;
    if (!eid || (establecimientoEsperado !== undefined && establecimientoEsperado !== eid)) codigoInvalido();
    await bloquearGestion(db, eid);
    const result = await db.query(
      `SELECT *, expires_at > clock_timestamp() AS vigente FROM invitaciones
       WHERE codigo_hash = $1 FOR UPDATE`, [codigoHash(codigoNormalizado)],
    );
    const invitacion = result.rows[0];
    if (!invitacion || !invitacion.vigente || invitacion.used_at) codigoInvalido();
    let puesto: Puesto | null = null;
    if (invitacion.puesto_operativo_id) {
      puesto = await puestoBloqueado(db, eid, invitacion.puesto_operativo_id);
      const actual = validarConfiguracion(puesto);
      if (actual.rol !== invitacion.rol ||
        JSON.stringify([...actual.permisos].sort()) !== JSON.stringify([...invitacion.permisos].sort()) ||
        JSON.stringify([...actual.capacidades].sort()) !== JSON.stringify([...invitacion.capacidades].sort())) codigoInvalido();
    }
    const config = validarConfiguracion(invitacion);
    const creadorPuesto = invitacion.creador_puesto_operativo_id
      ? await puestoBloqueado(db, eid, invitacion.creador_puesto_operativo_id)
      : (await db.query<Puesto>(
        `SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND activo
           AND (propietario_user_id = $2 OR legacy_user_id = $2) LIMIT 1 FOR UPDATE`,
        [eid, invitacion.created_by],
      )).rows[0];
    if (!creadorPuesto) codigoInvalido();
    const creadorSigue = creadorPuesto.propietario_user_id === invitacion.created_by ||
      (await db.query('SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2',
        [creadorPuesto.id, invitacion.created_by])).rows.length > 0;
    if (!creadorSigue) codigoInvalido();
    const creadorEsPrincipal = (await db.query<{ principal_user_id: string }>(
      'SELECT principal_user_id FROM establecimientos WHERE id = $1', [eid],
    )).rows[0]?.principal_user_id === invitacion.created_by;
    try { autorizarInvitacion(comoMiembro(creadorPuesto, invitacion.created_by, creadorEsPrincipal), config); }
    catch { codigoInvalido(); }
    if (!puesto) {
      if (config.rol === 'PROPIETARIO') {
        const existente = await db.query('SELECT 1 FROM puestos_operativos WHERE establecimiento_id = $1 AND propietario_user_id = $2 AND activo', [eid, userId]);
        if (existente.rows.length) throw new ApiError(409, 'ALREADY_MEMBER', 'Ya pertenecés a ese puesto.');
        const creado = await db.query<Puesto>(
          `INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, capacidades, propietario_user_id)
           VALUES ($1,'Propietario','PROPIETARIO',$2,$3) RETURNING *`, [eid, config.capacidades, userId],
        );
        puesto = creado.rows[0];
        await db.query(`INSERT INTO membresias (establecimiento_id, user_id, rol, capacidades)
          VALUES ($1,$2,'PROPIETARIO',$3) ON CONFLICT (establecimiento_id,user_id)
          DO UPDATE SET rol = 'PROPIETARIO', permisos = '{}', capacidades = EXCLUDED.capacidades`,
        [eid, userId, config.capacidades]);
      } else if (config.rol === 'VISOR') {
        puesto = (await db.query<Puesto>(
          `SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND rol = 'VISOR'
           AND predeterminado AND activo FOR UPDATE`, [eid],
        )).rows[0] ?? null;
        if (!puesto) throw new ApiError(409, 'DEFAULT_POST_MISSING', 'Falta el puesto Visor predeterminado.');
      } else {
        // Un código anterior a 012 conserva sus permisos exactos en un puesto heredado individual.
        const creado = await db.query<Puesto>(
          `INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, permisos, legacy_user_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [eid, `${rolVisible(config.rol)} heredado`, config.rol, config.permisos, userId],
        );
        puesto = creado.rows[0];
      }
    }
    const duplicada = await db.query('SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2', [puesto.id, userId]);
    if (puesto.rol !== 'PROPIETARIO' && duplicada.rows.length) throw new ApiError(409, 'ALREADY_MEMBER', 'Ya pertenecés a ese puesto.');
    if (puesto.rol !== 'PROPIETARIO') {
      await db.query('INSERT INTO integrantes_puesto (establecimiento_id, puesto_operativo_id, user_id) VALUES ($1,$2,$3)',
        [eid, puesto.id, userId]);
    }
    await db.query('UPDATE invitaciones SET used_at = clock_timestamp(), used_by = $2 WHERE id = $1', [invitacion.id, userId]);
    const datosAceptacion = await db.query<{ incorporado: string; establecimiento: string }>(
      `SELECT (SELECT username FROM usuarios WHERE id = $1) incorporado,
              (SELECT nombre FROM establecimientos WHERE id = $2) establecimiento`,
      [userId, eid],
    );
    await registrarEventoAdministrativo(db, {
      establecimientoId: eid, tipo: 'administrador_incorporado', actorId: userId,
      actorPuestoId: puesto.id, afectadoId: userId, afectadoPuestoId: puesto.id,
      titulo: 'Invitación aceptada',
      mensaje: `${datosAceptacion.rows[0]?.incorporado ?? 'Una persona'} aceptó la invitación y se incorporó al puesto ${puesto.nombre} del establecimiento ${datosAceptacion.rows[0]?.establecimiento ?? ''}.`,
      detalles: { puestoOperativoId: puesto.id, origen: 'invitacion_aceptada', rol: puesto.rol },
      permisoDestinatario: 'gestionar_administradores', excluirAutor: true,
    });
    return { establecimientoId: eid, puestoOperativoId: puesto.id };
  });
}

export async function designarResponsableGpsPuesto(actor: Membresia, puestoId: string | null): Promise<void> {
  await transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    if (actual.rol !== 'PROPIETARIO') prohibido();
    if (puestoId === null) {
      await db.query('DELETE FROM responsable_gps_notificaciones WHERE establecimiento_id = $1', [actor.establecimientoId]);
      return;
    }
    const puesto = await puestoBloqueado(db, actor.establecimientoId, puestoId);
    if (puesto.rol !== 'ADMINISTRADOR') throw new ApiError(400, 'GPS_ADMIN_REQUIRED', 'El responsable debe ser un puesto Administrador.');
    await db.query(
      `INSERT INTO responsable_gps_notificaciones
        (establecimiento_id, puesto_operativo_id, actualizado_por)
       VALUES ($1,$2,$3) ON CONFLICT (establecimiento_id) DO UPDATE
       SET user_id = NULL, puesto_operativo_id = EXCLUDED.puesto_operativo_id,
           actualizado_por = EXCLUDED.actualizado_por, updated_at = NOW()`,
      [actor.establecimientoId, puesto.id, actor.userId],
    );
    await notificarResponsableGpsSiHayIncidencia(db, actor.establecimientoId, puesto.id);
  });
}

export async function transferirPrincipalPuesto(actor: Membresia, destinoId: string): Promise<void> {
  await transaccion(async (db) => {
    await bloquearGestion(db, actor.establecimientoId);
    const actual = await actorActual(db, actor);
    if (!actual.principal || actor.userId === destinoId) prohibido();
    const destino = await db.query<Puesto>(
      `SELECT * FROM puestos_operativos WHERE establecimiento_id = $1 AND propietario_user_id = $2
       AND rol = 'PROPIETARIO' AND activo FOR UPDATE`, [actor.establecimientoId, destinoId],
    );
    if (!destino.rows[0]) throw new ApiError(400, 'OWNER_REQUIRED', 'El destino debe ser otro Propietario.');
    await db.query('UPDATE establecimientos SET principal_user_id = $2, updated_at = NOW() WHERE id = $1',
      [actor.establecimientoId, destinoId]);
    await db.query("UPDATE membresias SET capacidades = '{}', updated_at = NOW() WHERE establecimiento_id = $1 AND user_id = $2",
      [actor.establecimientoId, actor.userId]);
    await db.query("UPDATE puestos_operativos SET capacidades = '{}', updated_at = NOW() WHERE id = $1", [actual.puestoOperativoId]);
    await registrarEventoAdministrativo(db, {
      establecimientoId: actor.establecimientoId, tipo: 'propiedad_principal_transferida', actorId: actor.userId,
      actorPuestoId: actual.puestoOperativoId, afectadoId: destinoId, afectadoPuestoId: destino.rows[0].id,
      titulo: 'Transferencia de propiedad principal',
      mensaje: 'La propiedad principal del establecimiento fue transferida a otro Propietario.',
      detalles: { propietarioAnteriorId: actor.userId, propietarioNuevoId: destinoId },
    });
  });
}
