import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { env } from '../configuracion/env.js';
import { ApiError } from '../http/errors.js';
import type { Membresia } from '../autorizacion/catalogo.js';
import { leerToken, verificarToken } from './session.js';
import { registrarNotificacionPersonal } from '../services/notificaciones-personales.js';
import { registrarEventoAdministrativo } from '../services/notificaciones.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const COOKIE_OPERATIVA = 'rodeo_operativa';
export const TTL_MINUTOS = 30;
const RENOVAR_CADA_MINUTOS = 5;

const hash = (valor: string) => createHash('sha256').update(valor).digest('hex');

function cookie(valor: string, maxAge: number): string {
  const sameSite = `${env.cookieSameSite[0].toUpperCase()}${env.cookieSameSite.slice(1)}`;
  return `${COOKIE_OPERATIVA}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${env.cookieSecure ? '; Secure' : ''}`;
}
export function guardarCookieOperativa(res: Response, token: string): void {
  res.append('Set-Cookie', cookie(token, TTL_MINUTOS * 60));
}
export function limpiarCookieOperativa(res: Response): void {
  res.append('Set-Cookie', cookie('', 0));
}
export function leerTokenOperativo(req: Request): { id: string; secreto: string } | null {
  const valor = req.headers.cookie?.split(';').map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${COOKIE_OPERATIVA}=`));
  if (!valor) return null;
  try {
    const [id, secreto] = decodeURIComponent(valor.slice(COOKIE_OPERATIVA.length + 1)).split('.');
    return UUID.test(id ?? '') && /^[a-f0-9]{64}$/.test(secreto ?? '') ? { id, secreto } : null;
  } catch { return null; }
}

interface FilaSesion {
  id: string;
  puesto_operativo_id: string;
  establecimiento_id: string;
  nombre: string;
  rol: Membresia['rol'];
  permisos: Membresia['permisos'];
  capacidades: Membresia['capacidades'];
  principal: boolean;
  ultima_actividad_en: Date;
}

export async function entrarPuesto(req: Request, res: Response): Promise<void> {
  const eid = req.params.establecimientoId;
  const puestoId = req.params.puestoId;
  if (!req.usuario || !UUID.test(eid) || !UUID.test(puestoId)) {
    throw new ApiError(404, 'OPERATION_POST_NOT_FOUND', 'Puesto no disponible.');
  }
  const forzar = req.body?.forzar === true;
  const tokenActual = leerTokenOperativo(req);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const puesto = await db.query<{ id: string; establecimiento_id: string; nombre: string; rol: Membresia['rol']; establecimiento: string; principal_user_id: string }>(
      `SELECT p.id, p.establecimiento_id, p.nombre, p.rol, e.nombre AS establecimiento, e.principal_user_id
         FROM puestos_operativos p JOIN establecimientos e ON e.id = p.establecimiento_id
        WHERE p.id = $1 AND p.establecimiento_id = $2 AND p.activo
          AND (p.propietario_user_id = $3 OR EXISTS (
            SELECT 1 FROM integrantes_puesto i WHERE i.puesto_operativo_id = p.id AND i.user_id = $3))
        FOR UPDATE OF p`, [puestoId, eid, req.usuario.id],
    );
    if (!puesto.rows[0]) throw new ApiError(404, 'OPERATION_POST_NOT_FOUND', 'Puesto no disponible.');
    const anterior = await db.query<{ id: string; user_id: string; token_hash: string; vence_en: Date }>(
      `SELECT id, user_id, token_hash, vence_en FROM sesiones_operativas
        WHERE puesto_operativo_id = $1 AND terminada_en IS NULL FOR UPDATE`, [puestoId],
    );
    if (anterior.rows[0]) {
      if (tokenActual && anterior.rows[0].id === tokenActual.id
        && anterior.rows[0].token_hash === hash(tokenActual.secreto)
        && anterior.rows[0].user_id === req.usuario.id
        && new Date(anterior.rows[0].vence_en).getTime() > Date.now()) {
        await db.query('COMMIT');
        guardarCookieOperativa(res, `${tokenActual.id}.${tokenActual.secreto}`);
        res.json({ sesion: { puestoOperativoId: puestoId, establecimientoId: eid, nombreOperativo: puesto.rows[0].nombre,
          rol: puesto.rows[0].rol, venceEn: anterior.rows[0].vence_en } });
        return;
      }
      if (new Date(anterior.rows[0].vence_en).getTime() > Date.now() && !forzar) {
        throw new ApiError(409, 'OPERATION_POST_BUSY', `La cuenta ${puesto.rows[0].nombre} de este establecimiento ya está en uso.`);
      }
      const motivo = new Date(anterior.rows[0].vence_en).getTime() > Date.now() ? 'forzado' : 'vencida';
      await db.query(
        `UPDATE sesiones_operativas SET terminada_en = NOW(), motivo_fin = $2,
           reemplazada_por = CASE WHEN $2 = 'forzado' THEN $3::uuid ELSE NULL END
         WHERE id = $1`, [anterior.rows[0].id, motivo, req.usuario.id],
      );
      if (motivo === 'forzado') {
        const auditoria = await db.query<{ id: string }>(
          `INSERT INTO auditoria_operativa
            (establecimiento_id, puesto_operativo_id, actor_user_id, accion, detalles)
           VALUES ($1,$2,$3,'ingreso_forzado',$4::jsonb) RETURNING id`,
          [eid, puestoId, req.usuario.id, JSON.stringify({ sesionAnteriorId: anterior.rows[0].id })],
        );
        const nombres = await db.query<{ actor: string; afectado: string }>(
          `SELECT (SELECT username FROM usuarios WHERE id = $1) AS actor,
                  (SELECT username FROM usuarios WHERE id = $2) AS afectado`,
          [req.usuario.id, anterior.rows[0].user_id],
        );
        const actor = nombres.rows[0]?.actor ?? 'Un usuario';
        const afectado = nombres.rows[0]?.afectado ?? 'otro usuario';
        const mensaje = `${actor} forzó el ingreso al puesto ${puesto.rows[0].nombre} y desplazó a ${afectado}.`;
        await registrarEventoAdministrativo(db, {
          establecimientoId: eid, tipo: 'administrador_incorporado', actorId: req.usuario.id,
          actorPuestoId: puestoId, afectadoId: anterior.rows[0].user_id, afectadoPuestoId: puestoId,
          titulo: 'Ingreso forzado al puesto', mensaje,
          detalles: { origen: 'ingreso_forzado', auditoriaOperativaId: auditoria.rows[0].id,
            puestoOperativoId: puestoId, usuarioDesplazadoId: anterior.rows[0].user_id },
          permisoDestinatario: 'gestionar_administradores', excluirAutor: true,
        });
        if (anterior.rows[0].user_id !== req.usuario.id) {
          await registrarNotificacionPersonal(db, { userId: anterior.rows[0].user_id, establecimientoId: eid,
            sourceId: auditoria.rows[0].id, tipo: 'ingreso_forzado',
            titulo: 'Ingreso forzado a tu puesto',
            mensaje: `${actor} forzó el ingreso al puesto ${puesto.rows[0].nombre} del establecimiento ${puesto.rows[0].establecimiento}. Tu sesión operativa fue cerrada.`,
            metadata: { puestoOperativoId: puestoId, actorUserId: req.usuario.id,
              usuarioAfectadoId: anterior.rows[0].user_id } });
        }
      }
    }
    const secreto = randomBytes(32).toString('hex');
    const creada = await db.query<{ id: string; vence_en: Date }>(
      `INSERT INTO sesiones_operativas
        (establecimiento_id, puesto_operativo_id, user_id, token_hash, vence_en)
       VALUES ($1,$2,$3,$4,NOW() + INTERVAL '30 minutes') RETURNING id, vence_en`,
      [eid, puestoId, req.usuario.id, hash(secreto)],
    );
    await db.query(
      `INSERT INTO auditoria_operativa
        (establecimiento_id, puesto_operativo_id, actor_user_id, sesion_operativa_id, accion)
       VALUES ($1,$2,$3,$4,'ingreso')`, [eid, puestoId, req.usuario.id, creada.rows[0].id],
    );
    if (tokenActual && tokenActual.id !== anterior.rows[0]?.id) {
      await db.query(
        `UPDATE sesiones_operativas SET terminada_en = NOW(), motivo_fin = 'salida'
         WHERE id = $1 AND token_hash = $2 AND user_id = $3 AND terminada_en IS NULL`,
        [tokenActual.id, hash(tokenActual.secreto), req.usuario.id],
      );
    }
    await db.query('COMMIT');
    guardarCookieOperativa(res, `${creada.rows[0].id}.${secreto}`);
    res.json({ sesion: { puestoOperativoId: puestoId, establecimientoId: eid, nombreOperativo: puesto.rows[0].nombre,
      rol: puesto.rows[0].rol, venceEn: creada.rows[0].vence_en } });
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function salirPuesto(req: Request, res: Response): Promise<void> {
  await revocarSesion(req, 'salida');
  limpiarCookieOperativa(res);
  res.status(204).send();
}

export async function revocarAlCerrarSesion(req: Request): Promise<void> {
  await revocarSesion(req, 'logout');
}

async function revocarSesion(req: Request, motivo: 'salida' | 'logout'): Promise<void> {
  const token = leerTokenOperativo(req);
  const usuarioId = req.usuario?.id ?? (motivo === 'logout' ? verificarToken(leerToken(req) ?? '')?.sub : undefined);
  if (!token || !usuarioId) return;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actual = await db.query<{ puesto_operativo_id: string }>(
      `SELECT puesto_operativo_id FROM sesiones_operativas
       WHERE id = $1 AND token_hash = $2 AND user_id = $3 AND terminada_en IS NULL`,
      [token.id, hash(token.secreto), usuarioId],
    );
    if (actual.rows[0]) {
      await db.query('SELECT id FROM puestos_operativos WHERE id = $1 FOR UPDATE', [actual.rows[0].puesto_operativo_id]);
      await db.query(
        `UPDATE sesiones_operativas SET terminada_en = NOW(), motivo_fin = $4
         WHERE id = $1 AND token_hash = $2 AND user_id = $3 AND terminada_en IS NULL`,
        [token.id, hash(token.secreto), usuarioId, motivo],
      );
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export const requiereSesionOperativa: RequestHandler = async (req, res, next) => {
  const eid = req.params.establecimientoId;
  const token = leerTokenOperativo(req);
  if (!req.usuario || !UUID.test(eid ?? '')) {
    next(new ApiError(404, 'ESTABLISHMENT_NOT_FOUND', 'Establecimiento no disponible.'));
    return;
  }
  if (!token) {
    next(new ApiError(409, 'OPERATION_SESSION_REQUIRED', 'Entrá a una cuenta operativa para continuar.'));
    return;
  }
  const gestion = /\/(?:equipo|invitaciones|transferir-principal|puestos)(?:\/|$)/.test(req.path)
    && !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const retener = !gestion;
  const db = retener ? await pool.connect().catch(next) : null;
  if (retener && !db) return;
  let retenida = false;
  try {
    if (db) await db.query('BEGIN');
    const fuente = db ?? pool;
    if (db) {
      const origen = await db.query<{ puesto_operativo_id: string }>(
        'SELECT puesto_operativo_id FROM sesiones_operativas WHERE id = $1 AND token_hash = $2',
        [token.id, hash(token.secreto)],
      );
      if (origen.rows[0]) {
        await db.query('SELECT id FROM puestos_operativos WHERE id = $1 AND establecimiento_id = $2 FOR SHARE',
          [origen.rows[0].puesto_operativo_id, eid]);
      }
    }
    const result = await fuente.query<FilaSesion>(
      `SELECT s.id, p.id AS puesto_operativo_id, p.establecimiento_id, p.nombre, p.rol,
              p.permisos, p.capacidades, e.principal_user_id = $3::uuid AS principal,
              s.ultima_actividad_en
         FROM sesiones_operativas s JOIN puestos_operativos p ON p.id = s.puesto_operativo_id
         JOIN establecimientos e ON e.id = p.establecimiento_id
        WHERE s.id = $1 AND s.token_hash = $2 AND s.user_id = $3 AND p.activo
          AND p.establecimiento_id = $4 AND s.terminada_en IS NULL
          AND s.vence_en > clock_timestamp()
          AND (p.propietario_user_id = $3 OR EXISTS (
            SELECT 1 FROM integrantes_puesto i WHERE i.puesto_operativo_id = p.id AND i.user_id = $3))`,
      [token.id, hash(token.secreto), req.usuario.id, eid],
    );
    const fila = result.rows[0];
    if (!fila) {
      const motivo = await fuente.query<{ motivo_fin: string | null; nombre: string; vencida: boolean }>(
        `SELECT s.motivo_fin, p.nombre, s.vence_en <= clock_timestamp() AS vencida FROM sesiones_operativas s
         JOIN puestos_operativos p ON p.id = s.puesto_operativo_id
         WHERE s.id = $1 AND s.token_hash = $2 AND s.user_id = $3 AND p.establecimiento_id = $4`,
        [token.id, hash(token.secreto), req.usuario.id, eid],
      );
      const anterior = motivo.rows[0];
      if (anterior?.motivo_fin === 'forzado') throw new ApiError(409, 'OPERATION_SESSION_FORCED', `Otra persona ingresó al puesto ${anterior.nombre}. Volvé a ingresar para continuar.`);
      if (anterior?.motivo_fin === 'expulsion') throw new ApiError(409, 'OPERATION_ACCESS_REMOVED', `Ya no tenés acceso al puesto ${anterior.nombre}.`);
      if (anterior?.motivo_fin === 'permiso_cambiado') throw new ApiError(409, 'OPERATION_SESSION_CHANGED', `La configuración del puesto ${anterior.nombre} cambió. Volvé a ingresar para continuar.`);
      if (anterior?.motivo_fin === 'vencida' || (anterior && anterior.vencida)) throw new ApiError(409, 'OPERATION_SESSION_EXPIRED', `Tu sesión del puesto ${anterior.nombre} venció por inactividad. Volvé a ingresar para continuar.`);
      throw new ApiError(409, 'OPERATION_SESSION_LOST', 'Esta cuenta operativa ya no está disponible. Volvé a mis establecimientos.');
    }
    req.membresia = { establecimientoId: eid, userId: req.usuario.id,
      puestoOperativoId: fila.puesto_operativo_id,
      nombreOperativo: fila.principal && fila.rol === 'PROPIETARIO' ? 'Propietario principal' : fila.nombre,
      sesionOperativaId: fila.id,
      rol: fila.rol, permisos: fila.permisos, capacidades: fila.capacidades, principal: fila.principal && fila.rol === 'PROPIETARIO' };
    const actividadReal = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('X-Rodeo-Actividad') === '1';
    if (actividadReal && Date.now() - new Date(fila.ultima_actividad_en).getTime() >= RENOVAR_CADA_MINUTOS * 60_000) {
      await fuente.query(
        `UPDATE sesiones_operativas SET ultima_actividad_en = NOW(), vence_en = NOW() + INTERVAL '30 minutes'
          WHERE id = $1 AND terminada_en IS NULL AND vence_en > clock_timestamp()`, [fila.id],
      );
      guardarCookieOperativa(res, `${token.id}.${token.secreto}`);
    }
    if (db) {
      retenida = true;
      let liberada = false;
      const liberar = () => {
        if (liberada) return;
        liberada = true;
        void db.query('COMMIT').catch(() => db.query('ROLLBACK')).finally(() => db.release());
      };
      req.finalizarBloqueoOperativo = liberar;
      res.once('finish', liberar);
      res.once('close', () => {
        if (!req.operacionAsincronaOperativa) liberar();
      });
    }
    next();
  } catch (error) {
    if (db && !retenida) { await db.query('ROLLBACK').catch(() => undefined); db.release(); }
    next(error);
  }
};
