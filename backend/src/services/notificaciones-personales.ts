import type { PoolClient } from 'pg';

type TipoPersonal = 'ingreso_forzado';

export async function registrarNotificacionPersonal(
  db: Pick<PoolClient, 'query'>,
  input: { userId: string; establecimientoId: string; sourceId: string; tipo: TipoPersonal;
    titulo: string; mensaje: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO notificaciones_personales
       (user_id, establecimiento_id, source_id, tipo, titulo, mensaje, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (user_id, source_id) DO NOTHING`,
    [input.userId, input.establecimientoId, input.sourceId, input.tipo, input.titulo,
      input.mensaje, JSON.stringify(input.metadata ?? {})],
  );
}
