-- Notificaciones multiestablecimiento, auditoría e incidencias idempotentes.
-- Las filas históricas ambiguas conservan establecimiento_id NULL.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lotes'::regclass AND conname = 'lotes_id_establecimiento_unique') THEN
    ALTER TABLE lotes ADD CONSTRAINT lotes_id_establecimiento_unique UNIQUE (id, establecimiento_id);
  END IF;
END $$;

ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS establecimiento_id UUID REFERENCES establecimientos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS evento_id UUID,
  ADD COLUMN IF NOT EXISTS incidencia_id UUID,
  ADD COLUMN IF NOT EXISTS agrupacion_clave TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notificaciones'::regclass AND conname = 'notificaciones_lote_mismo_establecimiento_fk') THEN
    ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_lote_mismo_establecimiento_fk
      FOREIGN KEY (lote_id, establecimiento_id) REFERENCES lotes (id, establecimiento_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notificaciones_usuario_establecimiento_fecha_idx
  ON notificaciones (user_id, establecimiento_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS eventos_establecimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'limite_establecimiento_modificado', 'limite_lote_modificado',
    'permisos_modificados', 'administrador_incorporado',
    'administrador_eliminado', 'propiedad_principal_transferida',
    'lote_eliminado'
  )),
  actor_user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  afectado_user_id UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  lote_id UUID,
  ocurrido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, establecimiento_id),
  FOREIGN KEY (lote_id, establecimiento_id)
    REFERENCES lotes (id, establecimiento_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS eventos_establecimiento_fecha_idx
  ON eventos_establecimiento (establecimiento_id, ocurrido_en DESC, id DESC);
CREATE INDEX IF NOT EXISTS eventos_establecimiento_tipo_fecha_idx
  ON eventos_establecimiento (establecimiento_id, tipo, ocurrido_en DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notificaciones'::regclass AND conname = 'notificaciones_evento_fk') THEN
    ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_evento_fk
      FOREIGN KEY (evento_id, establecimiento_id) REFERENCES eventos_establecimiento(id, establecimiento_id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notificaciones'::regclass AND conname = 'notificaciones_id_establecimiento_usuario_unique') THEN
    ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_id_establecimiento_usuario_unique
      UNIQUE (id, establecimiento_id, user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS entregas_eventos_notificacion (
  evento_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  establecimiento_id UUID NOT NULL,
  notificacion_id UUID,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (evento_id, user_id),
  FOREIGN KEY (evento_id, establecimiento_id)
    REFERENCES eventos_establecimiento (id, establecimiento_id) ON DELETE RESTRICT,
  FOREIGN KEY (notificacion_id, establecimiento_id, user_id)
    REFERENCES notificaciones (id, establecimiento_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS entregas_eventos_notificacion_notificacion_idx
  ON entregas_eventos_notificacion (notificacion_id) WHERE notificacion_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_evento_destinatario_unique_idx
  ON notificaciones (evento_id, user_id) WHERE evento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_agrupacion_destinatario_unique_idx
  ON notificaciones (user_id, agrupacion_clave) WHERE agrupacion_clave IS NOT NULL;

CREATE TABLE IF NOT EXISTS incidencias_establecimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'satelite_optico_desactualizado', 'fallo_actualizacion_satelital',
    'fallo_actualizacion_climatica', 'gps_simulado_fuera_establecimiento'
  )),
  clave TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('activa', 'resuelta')),
  primera_deteccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_deteccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_en TIMESTAMPTZ,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((estado = 'activa' AND resuelta_en IS NULL) OR (estado = 'resuelta' AND resuelta_en IS NOT NULL)),
  UNIQUE (id, establecimiento_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS incidencias_activas_clave_unique_idx
  ON incidencias_establecimiento (establecimiento_id, tipo, clave) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS incidencias_establecimiento_estado_idx
  ON incidencias_establecimiento (establecimiento_id, estado, ultima_deteccion DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notificaciones'::regclass AND conname = 'notificaciones_incidencia_fk') THEN
    ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_incidencia_fk
      FOREIGN KEY (incidencia_id, establecimiento_id) REFERENCES incidencias_establecimiento(id, establecimiento_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_incidencia_destinatario_unique_idx
  ON notificaciones (incidencia_id, user_id) WHERE incidencia_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS responsable_gps_notificaciones (
  establecimiento_id UUID PRIMARY KEY REFERENCES establecimientos(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  actualizado_por UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (establecimiento_id, user_id)
    REFERENCES membresias (establecimiento_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS estado_fallos_actualizacion (
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  proveedor TEXT NOT NULL CHECK (proveedor IN ('copernicus', 'open_meteo')),
  fallos_consecutivos INTEGER NOT NULL DEFAULT 0 CHECK (fallos_consecutivos >= 0),
  ultima_ejecucion_id TEXT,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (establecimiento_id, proveedor)
);

CREATE TABLE IF NOT EXISTS ejecuciones_actualizacion_proveedor (
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  proveedor TEXT NOT NULL CHECK (proveedor IN ('copernicus', 'open_meteo')),
  ejecucion_id TEXT NOT NULL,
  fallo_tecnico BOOLEAN NOT NULL,
  ocurrida_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (establecimiento_id, proveedor, ejecucion_id)
);
