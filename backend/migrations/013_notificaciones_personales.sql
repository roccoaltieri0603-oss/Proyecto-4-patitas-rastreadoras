-- Bandeja privada independiente de las notificaciones compartidas por puesto.
-- source_id identifica de forma idempotente una auditoría, invitación u operación.
CREATE TABLE notificaciones_personales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'ingreso_forzado', 'invitacion_aceptada', 'miembro_expulsado', 'sesion_operativa'
  )),
  titulo TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  mensaje TEXT NOT NULL CHECK (length(btrim(mensaje)) BETWEEN 1 AND 1000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, source_id)
);

CREATE INDEX notificaciones_personales_bandeja_idx
  ON notificaciones_personales (user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX notificaciones_personales_establecimiento_idx
  ON notificaciones_personales (establecimiento_id, user_id, created_at DESC);
