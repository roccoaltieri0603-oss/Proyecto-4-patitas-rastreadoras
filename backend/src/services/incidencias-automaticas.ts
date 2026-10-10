import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { mantenerIncidenciaActiva, resolverIncidencia, type TipoIncidencia } from './notificaciones.js';

export const DIAS_SIN_OBSERVACION_OPTICA = 14;
export const DIAS_GRACIA_SIN_PRIMERA_OBSERVACION = 14;
export const FALLOS_CONSECUTIVOS_PARA_ALERTAR = 3;

async function transaccion<T>(accion: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await accion(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function evaluarDatosOpticosDesactualizados(ahora = new Date()): Promise<void> {
  const resumen = await pool.query<{ establecimiento_id: string; total: number; vencidos: number }>(
    `SELECT l.establecimiento_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE
              (optica.ultima_observacion IS NOT NULL AND optica.ultima_observacion <= $1::date - $2::int)
              OR (optica.ultima_observacion IS NULL AND l.created_at <= $3::timestamptz - ($4::text || ' days')::interval)
            )::int AS vencidos
       FROM lotes l
       LEFT JOIN LATERAL (
         SELECT MAX(m.observed_at) AS ultima_observacion
           FROM mediciones_satelitales m
          WHERE m.lote_id = l.id AND m.fuente = 'sentinel-2'
       ) optica ON TRUE
      WHERE l.activo = TRUE AND l.deleted_at IS NULL
      GROUP BY l.establecimiento_id`,
    [ahora.toISOString().slice(0, 10), DIAS_SIN_OBSERVACION_OPTICA, ahora, DIAS_GRACIA_SIN_PRIMERA_OBSERVACION],
  );
  const establecimientosConLotes = new Set(resumen.rows.map((row) => row.establecimiento_id));
  const existentes = await pool.query<{ id: string }>(
    `SELECT establecimiento_id AS id FROM incidencias_establecimiento
     WHERE tipo = 'satelite_optico_desactualizado' AND estado = 'activa'`,
  );
  for (const row of resumen.rows) {
    const total = Number(row.total);
    const vencidos = Number(row.vencidos);
    const minimo = total <= 5 ? 1 : Math.max(2, Math.ceil(total * 0.1));
    await transaccion(async (db) => {
      if (vencidos < minimo) {
        await resolverIncidencia(db, row.establecimiento_id, 'satelite_optico_desactualizado', 'todos');
        return;
      }
      const fallaTecnica = await db.query(
        `SELECT 1 FROM incidencias_establecimiento
         WHERE establecimiento_id = $1 AND tipo = 'fallo_actualizacion_satelital' AND estado = 'activa' LIMIT 1`,
        [row.establecimiento_id],
      );
      await mantenerIncidenciaActiva(db, {
        establecimientoId: row.establecimiento_id,
        tipo: 'satelite_optico_desactualizado', clave: 'todos',
        detalles: { lotesAfectados: vencidos, lotesActivos: total, umbralMinimo: minimo, diasSinObservacion: DIAS_SIN_OBSERVACION_OPTICA },
        titulo: 'Datos satelitales ópticos desactualizados',
        mensaje: `${vencidos} ${vencidos === 1 ? 'lote del establecimiento lleva' : 'lotes del establecimiento llevan'} más tiempo del esperado sin datos satelitales ópticos válidos.`,
        permisoDestinatario: 'actualizar_satelite',
        enviarNotificacion: fallaTecnica.rows.length === 0,
      });
    });
  }
  for (const row of existentes.rows) {
    if (!establecimientosConLotes.has(row.id)) {
      await transaccion((db) => resolverIncidencia(db, row.id, 'satelite_optico_desactualizado', 'todos'));
    }
  }
}

export type ProveedorActualizacion = 'copernicus' | 'open_meteo';

/** Registra una corrida que sí intentó consultar; runId vuelve idempotente el job de Actions. */
export async function registrarResultadoProveedor(
  establecimientoId: string,
  proveedor: ProveedorActualizacion,
  runId: string,
  falloTecnico: boolean,
): Promise<void> {
  await transaccion(async (db) => {
    const registrada = await db.query(
      `INSERT INTO ejecuciones_actualizacion_proveedor (establecimiento_id, proveedor, ejecucion_id, fallo_tecnico)
       VALUES ($1, $2, $3, $4) ON CONFLICT (establecimiento_id, proveedor, ejecucion_id) DO NOTHING RETURNING ejecucion_id`,
      [establecimientoId, proveedor, runId, falloTecnico],
    );
    if (registrada.rows.length === 0) return;
    await db.query(
      `INSERT INTO estado_fallos_actualizacion (establecimiento_id, proveedor)
       VALUES ($1, $2) ON CONFLICT (establecimiento_id, proveedor) DO NOTHING`, [establecimientoId, proveedor],
    );
    const estado = await db.query<{ fallos_consecutivos: number }>(
      `SELECT fallos_consecutivos FROM estado_fallos_actualizacion
       WHERE establecimiento_id = $1 AND proveedor = $2 FOR UPDATE`, [establecimientoId, proveedor],
    );
    const fallos = falloTecnico ? Number(estado.rows[0].fallos_consecutivos) + 1 : 0;
    await db.query(
      `UPDATE estado_fallos_actualizacion SET fallos_consecutivos = $3, ultima_ejecucion_id = $4, actualizado_en = NOW()
       WHERE establecimiento_id = $1 AND proveedor = $2`, [establecimientoId, proveedor, fallos, runId],
    );
    const tipo: TipoIncidencia = proveedor === 'copernicus' ? 'fallo_actualizacion_satelital' : 'fallo_actualizacion_climatica';
    if (fallos >= FALLOS_CONSECUTIVOS_PARA_ALERTAR) {
      await mantenerIncidenciaActiva(db, {
        establecimientoId, tipo, clave: proveedor,
        tipoNotificacion: 'fallo_actualizacion_persistente',
        detalles: { proveedor, fallosConsecutivos: fallos, criterio: FALLOS_CONSECUTIVOS_PARA_ALERTAR },
        titulo: proveedor === 'copernicus' ? 'Fallos persistentes en actualización satelital' : 'Fallos persistentes en actualización climática',
        mensaje: proveedor === 'copernicus'
          ? 'RODEO no pudo completar varias actualizaciones satelitales consecutivas.'
          : 'RODEO detectó fallos persistentes al consultar la información climática.',
        permisoDestinatario: proveedor === 'copernicus' ? 'actualizar_satelite' : 'actualizar_clima',
      });
    } else if (!falloTecnico) {
      await resolverIncidencia(db, establecimientoId, tipo, proveedor);
    }
  });
}

export function idEjecucionProgramada(): string {
  const run = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  return run ? `github:${run}:${attempt ?? '1'}` : `local:${randomUUID()}`;
}
