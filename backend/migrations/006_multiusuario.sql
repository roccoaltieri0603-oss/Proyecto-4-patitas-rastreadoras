ALTER TABLE establecimientos DROP CONSTRAINT IF EXISTS establecimientos_user_id_key;
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS principal_user_id UUID;
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS principal_rol TEXT GENERATED ALWAYS AS ('PROPIETARIO'::text) STORED;
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS membresias (
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  rol TEXT NOT NULL CHECK (rol IN ('PROPIETARIO', 'ADMINISTRADOR', 'VISOR')),
  permisos TEXT[] NOT NULL DEFAULT '{}',
  capacidades TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (establecimiento_id, user_id),
  UNIQUE (establecimiento_id, user_id, rol),
  CHECK (rol = 'ADMINISTRADOR' OR cardinality(permisos) = 0),
  CHECK (rol = 'PROPIETARIO' OR cardinality(capacidades) = 0),
  CHECK (permisos <@ ARRAY['crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes','actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia','renombrar_establecimiento','editar_limite_establecimiento','invitar_visores','invitar_administradores','gestionar_visores','gestionar_administradores','revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso']::text[] AND array_position(permisos, NULL) IS NULL),
  CHECK (capacidades <@ ARRAY['crear_propietarios','eliminar_propietarios','modificar_propietarios','protegido','ignorar_proteccion','poderes_principal']::text[] AND array_position(capacidades, NULL) IS NULL),
  CHECK (NOT permisos && ARRAY['revocar_cualquier_permiso','otorgar_cualquier_permiso']::text[] OR 'gestionar_administradores' = ANY(permisos)),
  CHECK (NOT 'crear_admin_cualquier_permiso' = ANY(permisos) OR 'invitar_administradores' = ANY(permisos))
);
CREATE INDEX IF NOT EXISTS membresias_usuario_idx ON membresias (user_id, establecimiento_id);

-- Sólo convertir filas anteriores a esta migración; una repetición no reincorpora miembros expulsados.
INSERT INTO membresias (establecimiento_id, user_id, rol)
SELECT id, user_id, 'PROPIETARIO' FROM establecimientos WHERE principal_user_id IS NULL
ON CONFLICT (establecimiento_id, user_id) DO NOTHING;
UPDATE establecimientos e SET principal_user_id = e.user_id,
  onboarding_completed_at = COALESCE(u.onboarding_completed_at,
    (SELECT MIN(l.created_at) FROM lotes l WHERE l.establecimiento_id = e.id))
FROM usuarios u WHERE e.user_id = u.id AND e.principal_user_id IS NULL;
ALTER TABLE establecimientos ALTER COLUMN principal_user_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'establecimientos'::regclass AND conname = 'establecimientos_principal_fk') THEN
    ALTER TABLE establecimientos ADD CONSTRAINT establecimientos_principal_fk
      FOREIGN KEY (id, principal_user_id, principal_rol)
      REFERENCES membresias (establecimiento_id, user_id, rol)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invitaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  codigo_hash TEXT NOT NULL UNIQUE,
  rol TEXT NOT NULL CHECK (rol IN ('PROPIETARIO', 'ADMINISTRADOR', 'VISOR')),
  permisos TEXT[] NOT NULL DEFAULT '{}',
  capacidades TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((used_at IS NULL) = (used_by IS NULL)),
  CHECK (rol = 'ADMINISTRADOR' OR cardinality(permisos) = 0),
  CHECK (rol = 'PROPIETARIO' OR cardinality(capacidades) = 0)
);
CREATE INDEX IF NOT EXISTS invitaciones_establecimiento_idx ON invitaciones (establecimiento_id, expires_at);
