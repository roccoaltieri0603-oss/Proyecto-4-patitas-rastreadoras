import type { Request, Response } from 'express';
import { contexto, UUID } from '../autorizacion/membresia.js';
import { pool } from '../base-datos/pool.js';
import { ApiError } from '../http/errors.js';
import { entregarIncidenciasGpsActivas } from '../services/notificaciones.js';

function exigirPropietario(req: Request) {
  const membership = contexto(req);
  if (membership.rol !== 'PROPIETARIO') throw new ApiError(403, 'OWNER_REQUIRED', 'Solo un propietario puede asignar responsables GPS.');
  return membership;
}

export async function listarResponsablesGps(req: Request, res: Response): Promise<void> {
  const m = exigirPropietario(req);
  const [gps, admins] = await Promise.all([
    pool.query(`SELECT g.id, g.user_id AS "userId", u.username, g.numero, g.apodo,
        r.puesto_operativo_id AS "puestoOperativoId"
      FROM gps_simulados g JOIN usuarios u ON u.id=g.user_id
      LEFT JOIN gps_simulados_responsables r ON r.establecimiento_id=g.establecimiento_id
        AND r.user_id=g.user_id AND r.dispositivo_id=g.id
      WHERE g.establecimiento_id=$1 ORDER BY u.username, g.numero`, [m.establecimientoId]),
    pool.query(`SELECT id, nombre FROM puestos_operativos
      WHERE establecimiento_id=$1 AND activo AND rol='ADMINISTRADOR'
        AND 'ver_dispositivos_gps'=ANY(permisos) ORDER BY nombre`, [m.establecimientoId]),
  ]);
  res.json({ dispositivos: gps.rows, administradores: admins.rows });
}

export async function asignarResponsableGps(req: Request, res: Response): Promise<void> {
  const m = exigirPropietario(req);
  const deviceId = req.params.dispositivoId;
  const puestoId = (req.body as { puestoOperativoId?: unknown } | undefined)?.puestoOperativoId;
  if (!UUID.test(deviceId) || (puestoId !== null && (typeof puestoId !== 'string' || !UUID.test(puestoId)))) {
    throw new ApiError(400, 'INVALID_GPS_RESPONSIBLE', 'La asignación de responsable no es válida.');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const device = await db.query('SELECT id FROM gps_simulados WHERE id=$1 AND establecimiento_id=$2 FOR UPDATE', [deviceId, m.establecimientoId]);
    if (!device.rows.length) throw new ApiError(404, 'GPS_SIMULATED_NOT_FOUND', 'Dispositivo no disponible.');
    if (puestoId === null) {
      await db.query('DELETE FROM gps_simulados_responsables WHERE establecimiento_id=$1 AND dispositivo_id=$2', [m.establecimientoId, deviceId]);
    } else {
      const admin = await db.query(`SELECT id FROM puestos_operativos WHERE id=$1 AND establecimiento_id=$2
        AND activo AND rol='ADMINISTRADOR' AND 'ver_dispositivos_gps'=ANY(permisos) FOR UPDATE`, [puestoId, m.establecimientoId]);
      if (!admin.rows.length) throw new ApiError(404, 'GPS_RESPONSIBLE_NOT_AVAILABLE', 'El administrador debe estar activo y tener permiso de lectura GPS.');
      await db.query(`INSERT INTO gps_simulados_responsables
          (establecimiento_id,user_id,dispositivo_id,puesto_operativo_id,actualizado_por)
        SELECT establecimiento_id,user_id,id,$3,$4 FROM gps_simulados WHERE id=$1 AND establecimiento_id=$2
        ON CONFLICT (establecimiento_id,user_id,dispositivo_id) DO UPDATE
          SET puesto_operativo_id=EXCLUDED.puesto_operativo_id,actualizado_por=EXCLUDED.actualizado_por,updated_at=NOW()`,
      [deviceId, m.establecimientoId, puestoId, m.userId]);
    }
    await entregarIncidenciasGpsActivas(db, m.establecimientoId, deviceId);
    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
