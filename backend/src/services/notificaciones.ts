import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export type TipoNotificacion =
  | 'cambios_limites'
  | 'permisos_modificados'
  | 'administrador_incorporado'
  | 'administrador_eliminado'
  | 'propiedad_principal_transferida'
  | 'lote_eliminado'
  | 'satelite_optico_desactualizado'
  | 'fallo_actualizacion_persistente'
  | 'gps_simulado_fuera_establecimiento';

export type TipoEventoAdministrativo =
  | 'limite_establecimiento_modificado'
  | 'limite_lote_modificado'
  | 'permisos_modificados'
  | 'administrador_incorporado'
  | 'administrador_eliminado'
  | 'propiedad_principal_transferida'
  | 'lote_eliminado';

export interface EventoAdministrativo {
  /** UUID estable cuando el llamador necesita reintentar la misma operación. */
  idempotencyId?: string;
  establecimientoId: string;
  tipo: TipoEventoAdministrativo;
  actorId: string;
  afectadoId?: string | null;
  loteId?: string | null;
  detalles?: Record<string, unknown>;
  titulo: string;
  mensaje: string;
  permisoDestinatario?: string;
  incluirAfectadoAdministrador?: boolean;
  excluirAutor?: boolean;
  tituloAgrupado?: string;
}

export type TipoIncidencia =
  | 'satelite_optico_desactualizado'
  | 'fallo_actualizacion_satelital'
  | 'fallo_actualizacion_climatica'
  | 'gps_simulado_fuera_establecimiento';

export interface IncidenciaInput {
  establecimientoId: string;
  tipo: TipoIncidencia;
  clave: string;
  detalles: Record<string, unknown>;
  titulo: string;
  mensaje: string;
  permisoDestinatario?: 'actualizar_satelite' | 'actualizar_clima';
  loteId?: string | null;
  soloResponsableGps?: boolean;
  enviarNotificacion?: boolean;
  tipoNotificacion?: TipoNotificacion;
}

export async function registrarEventoAdministrativo(db: Queryable, evento: EventoAdministrativo): Promise<string> {
  const valoresEvento = [evento.establecimientoId, evento.tipo, evento.actorId, evento.afectadoId ?? null, evento.loteId ?? null, JSON.stringify(evento.detalles ?? {})];
  const resultado = evento.idempotencyId
    ? await db.query<{ id: string }>(
      `INSERT INTO eventos_establecimiento
         (id, establecimiento_id, tipo, actor_user_id, afectado_user_id, lote_id, detalles)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [evento.idempotencyId, ...valoresEvento],
    )
    : await db.query<{ id: string }>(
      `INSERT INTO eventos_establecimiento
         (establecimiento_id, tipo, actor_user_id, afectado_user_id, lote_id, detalles)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      valoresEvento,
    );
  const eventoId = resultado.rows[0]?.id ?? evento.idempotencyId;
  if (!eventoId) throw new Error('No se pudo registrar el evento administrativo.');
  if (resultado.rows.length === 0) {
    const existente = await db.query<{ id: string }>(
      `SELECT id FROM eventos_establecimiento
       WHERE id = $1 AND establecimiento_id = $2 AND tipo = $3 AND actor_user_id = $4
         AND afectado_user_id IS NOT DISTINCT FROM $5::uuid
         AND lote_id IS NOT DISTINCT FROM $6::uuid AND detalles = $7::jsonb`,
      [eventoId, ...valoresEvento],
    );
    if (existente.rows.length === 0) throw new Error('El identificador de idempotencia ya pertenece a otro evento.');
  }
  const tipoNotificacion: TipoNotificacion = evento.tipo === 'limite_establecimiento_modificado' || evento.tipo === 'limite_lote_modificado'
    ? 'cambios_limites' : evento.tipo;
  const destinatarios = await db.query<{ user_id: string }>(
    `SELECT DISTINCT m.user_id
       FROM membresias m
      WHERE m.establecimiento_id = $1
        AND (
          m.rol = 'PROPIETARIO'
          OR (m.rol = 'ADMINISTRADOR' AND $2::text IS NOT NULL AND $2 = ANY(m.permisos))
          OR (m.rol = 'ADMINISTRADOR' AND $3::uuid IS NOT NULL AND m.user_id = $3)
        )
        AND ($4::uuid IS NULL OR m.user_id <> $4)`,
    [evento.establecimientoId, evento.permisoDestinatario ?? null,
      evento.incluirAfectadoAdministrador ? evento.afectadoId ?? null : null,
      evento.excluirAutor ? evento.actorId : null],
  );
  for (const { user_id: userId } of destinatarios.rows) {
    const agrupar = evento.tipo === 'limite_lote_modificado' || evento.tipo === 'lote_eliminado';
    const agrupacionClave = agrupar
      ? `${evento.establecimientoId}:${evento.actorId}:${evento.tipo}:${Math.floor(Date.now() / 120_000)}`
      : null;
    const metadatos = agrupar
      ? { ...evento.detalles, eventos: [{ eventoId, detalles: evento.detalles ?? {} }] }
      : evento.detalles ?? {};
    const mensajeAgrupado = evento.tipo === 'lote_eliminado'
      ? `${evento.mensaje.split(' eliminó el lote ')[0]} eliminó 1 lote del establecimiento.`
      : `${evento.mensaje.split(' modificó ')[0]} modificó los límites de 1 lote.`;
    const reclamo = await db.query<{ evento_id: string }>(
      `INSERT INTO entregas_eventos_notificacion (evento_id, user_id, establecimiento_id)
       VALUES ($1, $2, $3) ON CONFLICT (evento_id, user_id) DO NOTHING RETURNING evento_id`,
      [eventoId, userId, evento.establecimientoId],
    );
    if (reclamo.rows.length === 0) continue;

    let notificacionId: string | undefined;
    if (agrupar) {
      const insertada = await db.query<{ id: string }>(
      `INSERT INTO notificaciones
        (user_id, establecimiento_id, lote_id, evento_id, agrupacion_clave, tipo, titulo, mensaje, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (user_id, agrupacion_clave) WHERE agrupacion_clave IS NOT NULL DO UPDATE
         SET titulo = EXCLUDED.titulo,
         read_at = NULL,
         created_at = NOW(),
         mensaje = CASE
           WHEN EXCLUDED.tipo = 'lote_eliminado' THEN
             split_part(notificaciones.mensaje, ' eliminó ', 1) || ' eliminó ' ||
             (jsonb_array_length(COALESCE(notificaciones.metadata->'eventos', '[]'::jsonb)) + 1)::text || ' lotes del establecimiento.'
           ELSE
             split_part(notificaciones.mensaje, ' modificó ', 1) || ' modificó los límites de ' ||
             (jsonb_array_length(COALESCE(notificaciones.metadata->'eventos', '[]'::jsonb)) + 1)::text || ' lotes.'
         END,
         metadata = jsonb_set(notificaciones.metadata, '{eventos}',
           COALESCE(notificaciones.metadata->'eventos', '[]'::jsonb) || EXCLUDED.metadata->'eventos', TRUE)
       RETURNING id`,
      [userId, evento.establecimientoId, agrupar ? null : evento.loteId ?? null,
        agrupar ? null : eventoId, agrupacionClave, tipoNotificacion,
        agrupar ? evento.tituloAgrupado ?? evento.titulo : evento.titulo,
        agrupar ? mensajeAgrupado : evento.mensaje, JSON.stringify(metadatos)],
      );
      notificacionId = insertada.rows[0]?.id;
    } else {
      const insertada = await db.query<{ id: string }>(
        `INSERT INTO notificaciones
          (user_id, establecimiento_id, lote_id, evento_id, tipo, titulo, mensaje, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (evento_id, user_id) WHERE evento_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [userId, evento.establecimientoId, evento.loteId ?? null, eventoId, tipoNotificacion,
          evento.titulo, evento.mensaje, JSON.stringify(evento.detalles ?? {})],
      );
      notificacionId = insertada.rows[0]?.id;
      if (!notificacionId) {
        const existente = await db.query<{ id: string }>(
          'SELECT id FROM notificaciones WHERE evento_id = $1 AND user_id = $2', [eventoId, userId],
        );
        notificacionId = existente.rows[0]?.id;
      }
    }
    if (!notificacionId) throw new Error('No se pudo recuperar la notificación del evento.');
    await db.query(
      `UPDATE entregas_eventos_notificacion SET notificacion_id = $4
       WHERE evento_id = $1 AND user_id = $2 AND establecimiento_id = $3`,
      [eventoId, userId, evento.establecimientoId, notificacionId],
    );
  }
  return eventoId;
}

async function resolverDestinatariosIncidencia(db: Queryable, input: IncidenciaInput): Promise<string[]> {
  if (input.soloResponsableGps) {
    const result = await db.query<{ user_id: string }>(
      `SELECT r.user_id FROM responsable_gps_notificaciones r
       JOIN membresias m ON m.establecimiento_id = r.establecimiento_id AND m.user_id = r.user_id
       WHERE r.establecimiento_id = $1 AND m.rol = 'ADMINISTRADOR'`,
      [input.establecimientoId],
    );
    return result.rows.map((row) => row.user_id);
  }
  const result = await db.query<{ user_id: string }>(
    `SELECT DISTINCT m.user_id FROM membresias m
     WHERE m.establecimiento_id = $1 AND
       (m.rol = 'PROPIETARIO' OR
        (m.rol = 'ADMINISTRADOR' AND $2::text IS NOT NULL AND $2 = ANY(m.permisos)))`,
    [input.establecimientoId, input.permisoDestinatario ?? null],
  );
  return result.rows.map((row) => row.user_id);
}

async function entregarIncidencia(db: Queryable, input: IncidenciaInput, incidenciaId: string): Promise<void> {
  const userIds = await resolverDestinatariosIncidencia(db, input);
  const tipoNotificacion = input.tipo;
  for (const userId of userIds) {
    await db.query(
      `INSERT INTO notificaciones
        (user_id, establecimiento_id, lote_id, incidencia_id, tipo, titulo, mensaje, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (incidencia_id, user_id) WHERE incidencia_id IS NOT NULL DO NOTHING`,
      [userId, input.establecimientoId, input.loteId ?? null, incidenciaId,
        input.tipoNotificacion ?? tipoNotificacion, input.titulo, input.mensaje, JSON.stringify(input.detalles)],
    );
  }
}

/** Abre (o actualiza) un episodio; el índice parcial es la autoridad contra carreras. */
export async function mantenerIncidenciaActiva(db: Queryable, input: IncidenciaInput): Promise<string> {
  await db.query(
    `UPDATE incidencias_establecimiento
       SET ultima_deteccion = NOW(), detalles = $4::jsonb
     WHERE establecimiento_id = $1 AND tipo = $2 AND clave = $3 AND estado = 'activa'`,
    [input.establecimientoId, input.tipo, input.clave, JSON.stringify(input.detalles)],
  );
  const activa = await db.query<{ id: string }>(
    `SELECT id FROM incidencias_establecimiento
     WHERE establecimiento_id = $1 AND tipo = $2 AND clave = $3 AND estado = 'activa'`,
    [input.establecimientoId, input.tipo, input.clave],
  );
  let incidenciaId = activa.rows[0]?.id;
  if (!incidenciaId) {
    const creada = await db.query<{ id: string }>(
      `INSERT INTO incidencias_establecimiento (establecimiento_id, tipo, clave, estado, detalles)
       VALUES ($1, $2, $3, 'activa', $4::jsonb)
       ON CONFLICT (establecimiento_id, tipo, clave) WHERE estado = 'activa' DO NOTHING
       RETURNING id`,
      [input.establecimientoId, input.tipo, input.clave, JSON.stringify(input.detalles)],
    );
    incidenciaId = creada.rows[0]?.id;
  }
  if (!incidenciaId) {
    const carrera = await db.query<{ id: string }>(
      `SELECT id FROM incidencias_establecimiento
       WHERE establecimiento_id = $1 AND tipo = $2 AND clave = $3 AND estado = 'activa'`,
      [input.establecimientoId, input.tipo, input.clave],
    );
    incidenciaId = carrera.rows[0]?.id;
  }
  if (!incidenciaId) throw new Error('No se pudo recuperar la incidencia activa tras el upsert.');
  if (input.enviarNotificacion !== false) await entregarIncidencia(db, input, incidenciaId);
  return incidenciaId;
}

export async function resolverIncidencia(
  db: Queryable,
  establecimientoId: string,
  tipo: TipoIncidencia,
  clave: string,
): Promise<void> {
  await db.query(
    `UPDATE incidencias_establecimiento SET estado = 'resuelta', resuelta_en = NOW(), ultima_deteccion = NOW()
     WHERE establecimiento_id = $1 AND tipo = $2 AND clave = $3 AND estado = 'activa'`,
    [establecimientoId, tipo, clave],
  );
}

/** Entrega una incidencia GPS vigente al administrador recién designado, sin reabrir el episodio. */
export async function notificarResponsableGpsSiHayIncidencia(db: Queryable, establecimientoId: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO notificaciones (user_id, establecimiento_id, incidencia_id, tipo, titulo, mensaje, metadata)
       SELECT $2, i.establecimiento_id, i.id, 'gps_simulado_fuera_establecimiento',
       'Punto GPS simulado fuera del establecimiento',
       'El punto GPS simulado está fuera de los límites del establecimiento.', i.detalles
     FROM incidencias_establecimiento i
     JOIN responsable_gps_notificaciones r ON r.establecimiento_id = i.establecimiento_id AND r.user_id = $2
     JOIN membresias m ON m.establecimiento_id = r.establecimiento_id AND m.user_id = r.user_id AND m.rol = 'ADMINISTRADOR'
     WHERE i.establecimiento_id = $1 AND i.tipo = 'gps_simulado_fuera_establecimiento' AND i.estado = 'activa'
     ON CONFLICT (incidencia_id, user_id) WHERE incidencia_id IS NOT NULL DO NOTHING`,
    [establecimientoId, userId],
  );
}
