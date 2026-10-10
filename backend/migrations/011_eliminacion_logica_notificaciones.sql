-- Oculta notificaciones individualmente sin borrar auditoría, incidencias ni entregas.
ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notificaciones_usuario_establecimiento_visibles_fecha_idx
  ON notificaciones (user_id, establecimiento_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
