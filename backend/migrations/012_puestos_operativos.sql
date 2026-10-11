-- Migración aditiva: conserva membresías, invitaciones, avisos y entregas históricos.
CREATE TABLE puestos_operativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  rol TEXT NOT NULL CHECK (rol IN ('PROPIETARIO', 'ADMINISTRADOR', 'VISOR')),
  permisos TEXT[] NOT NULL DEFAULT '{}',
  capacidades TEXT[] NOT NULL DEFAULT '{}',
  propietario_user_id UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  legacy_user_id UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  predeterminado BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, establecimiento_id),
  CHECK ((rol = 'PROPIETARIO') = (propietario_user_id IS NOT NULL)),
  CHECK (rol <> 'PROPIETARIO' OR (legacy_user_id IS NULL AND cardinality(permisos) = 0 AND NOT predeterminado)),
  CHECK (rol = 'ADMINISTRADOR' OR cardinality(permisos) = 0),
  CHECK (rol = 'PROPIETARIO' OR cardinality(capacidades) = 0),
  CHECK (NOT predeterminado OR (rol IN ('ADMINISTRADOR', 'VISOR') AND legacy_user_id IS NULL)),
  CHECK (permisos <@ ARRAY[
    'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
    'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
    'renombrar_establecimiento','editar_limite_establecimiento','invitar_visores',
    'invitar_administradores','gestionar_visores','gestionar_administradores',
    'revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso'
  ]::text[] AND array_position(permisos, NULL) IS NULL),
  CHECK (capacidades <@ ARRAY[
    'crear_propietarios','eliminar_propietarios','modificar_propietarios',
    'protegido','ignorar_proteccion','poderes_principal'
  ]::text[] AND array_position(capacidades, NULL) IS NULL),
  CHECK (NOT permisos && ARRAY['revocar_cualquier_permiso','otorgar_cualquier_permiso']::text[]
         OR 'gestionar_administradores' = ANY(permisos)),
  CHECK (NOT 'crear_admin_cualquier_permiso' = ANY(permisos)
         OR 'invitar_administradores' = ANY(permisos))
);
CREATE UNIQUE INDEX puestos_propietario_unique_idx
  ON puestos_operativos (establecimiento_id, propietario_user_id)
  WHERE propietario_user_id IS NOT NULL AND activo;
CREATE UNIQUE INDEX puestos_legacy_unique_idx
  ON puestos_operativos (establecimiento_id, legacy_user_id) WHERE legacy_user_id IS NOT NULL;
CREATE UNIQUE INDEX puestos_predeterminado_unique_idx
  ON puestos_operativos (establecimiento_id, rol) WHERE predeterminado;
CREATE INDEX puestos_establecimiento_idx ON puestos_operativos (establecimiento_id, rol, nombre);

CREATE TABLE integrantes_puesto (
  establecimiento_id UUID NOT NULL,
  puesto_operativo_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (puesto_operativo_id, user_id),
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
    REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT
);
CREATE INDEX integrantes_puesto_usuario_idx ON integrantes_puesto (user_id, establecimiento_id);

-- El preset sólo incluye trabajo de campo; no concede gobierno de personas.
INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, permisos, predeterminado)
SELECT id, 'Administrador', 'ADMINISTRADOR', ARRAY[
  'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
  'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
  'renombrar_establecimiento','editar_limite_establecimiento'
]::text[], TRUE FROM establecimientos;
INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, predeterminado)
SELECT id, 'Visor', 'VISOR', TRUE FROM establecimientos;

INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, capacidades, propietario_user_id)
SELECT establecimiento_id, 'Propietario', rol, capacidades, user_id
  FROM membresias WHERE rol = 'PROPIETARIO';

-- Cada administrador histórico conserva exactamente sus permisos, sin fusión automática.
INSERT INTO puestos_operativos (establecimiento_id, nombre, rol, permisos, legacy_user_id)
SELECT establecimiento_id,
       'Administrador heredado ' || row_number() OVER (PARTITION BY establecimiento_id ORDER BY user_id),
       rol, permisos, user_id
  FROM membresias WHERE rol = 'ADMINISTRADOR';
INSERT INTO integrantes_puesto (establecimiento_id, puesto_operativo_id, user_id)
SELECT p.establecimiento_id, p.id, p.legacy_user_id
  FROM puestos_operativos p WHERE p.legacy_user_id IS NOT NULL;
INSERT INTO integrantes_puesto (establecimiento_id, puesto_operativo_id, user_id)
SELECT m.establecimiento_id, p.id, m.user_id
  FROM membresias m JOIN puestos_operativos p
    ON p.establecimiento_id = m.establecimiento_id AND p.rol = 'VISOR' AND p.predeterminado
 WHERE m.rol = 'VISOR';

CREATE TABLE sesiones_operativas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL,
  puesto_operativo_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  iniciada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_en TIMESTAMPTZ NOT NULL,
  terminada_en TIMESTAMPTZ,
  motivo_fin TEXT CHECK (motivo_fin IN ('salida','logout','forzado','vencida','expulsion','permiso_cambiado')),
  reemplazada_por UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
    REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT,
  CHECK ((terminada_en IS NULL) = (motivo_fin IS NULL)),
  CHECK (vence_en > iniciada_en)
);
CREATE UNIQUE INDEX sesiones_operativas_activa_unique_idx
  ON sesiones_operativas (puesto_operativo_id) WHERE terminada_en IS NULL;
CREATE INDEX sesiones_operativas_usuario_idx ON sesiones_operativas (user_id, terminada_en);

CREATE TABLE auditoria_operativa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL,
  puesto_operativo_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  sesion_operativa_id UUID REFERENCES sesiones_operativas(id) ON DELETE RESTRICT,
  accion TEXT NOT NULL,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  ocurrida_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
    REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT
);
CREATE INDEX auditoria_operativa_fecha_idx ON auditoria_operativa (establecimiento_id, ocurrida_en DESC);

ALTER TABLE eventos_establecimiento ADD COLUMN actor_puesto_operativo_id UUID;
ALTER TABLE eventos_establecimiento ADD CONSTRAINT eventos_actor_puesto_fk
  FOREIGN KEY (actor_puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;

ALTER TABLE invitaciones ADD COLUMN puesto_operativo_id UUID;
ALTER TABLE invitaciones ADD COLUMN creador_puesto_operativo_id UUID;
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_puesto_fk
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_creador_puesto_fk
  FOREIGN KEY (creador_puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;

ALTER TABLE notificaciones ADD COLUMN puesto_operativo_id UUID;
ALTER TABLE notificaciones ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_destinatario_unico_check
  CHECK ((user_id IS NULL) <> (puesto_operativo_id IS NULL));
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_puesto_fk
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_id_establecimiento_puesto_unique
  UNIQUE (id, establecimiento_id, puesto_operativo_id);
CREATE INDEX notificaciones_puesto_visibles_fecha_idx
  ON notificaciones (puesto_operativo_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX notificaciones_evento_puesto_unique_idx
  ON notificaciones (evento_id, puesto_operativo_id) WHERE evento_id IS NOT NULL AND puesto_operativo_id IS NOT NULL;
CREATE UNIQUE INDEX notificaciones_incidencia_puesto_unique_idx
  ON notificaciones (incidencia_id, puesto_operativo_id) WHERE incidencia_id IS NOT NULL AND puesto_operativo_id IS NOT NULL;
CREATE UNIQUE INDEX notificaciones_agrupacion_puesto_unique_idx
  ON notificaciones (puesto_operativo_id, agrupacion_clave) WHERE agrupacion_clave IS NOT NULL AND puesto_operativo_id IS NOT NULL;

ALTER TABLE entregas_eventos_notificacion ADD COLUMN id UUID DEFAULT gen_random_uuid();
ALTER TABLE entregas_eventos_notificacion ADD COLUMN puesto_operativo_id UUID;
ALTER TABLE entregas_eventos_notificacion ALTER COLUMN id SET NOT NULL;
ALTER TABLE entregas_eventos_notificacion DROP CONSTRAINT entregas_eventos_notificacion_pkey;
ALTER TABLE entregas_eventos_notificacion ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE entregas_eventos_notificacion ADD PRIMARY KEY (id);
ALTER TABLE entregas_eventos_notificacion ADD CONSTRAINT entregas_destinatario_unico_check
  CHECK ((user_id IS NULL) <> (puesto_operativo_id IS NULL));
ALTER TABLE entregas_eventos_notificacion ADD CONSTRAINT entregas_puesto_fk
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;
ALTER TABLE entregas_eventos_notificacion ADD CONSTRAINT entregas_notificacion_puesto_fk
  FOREIGN KEY (notificacion_id, establecimiento_id, puesto_operativo_id)
  REFERENCES notificaciones (id, establecimiento_id, puesto_operativo_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX entregas_evento_usuario_unique_idx
  ON entregas_eventos_notificacion (evento_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX entregas_evento_puesto_unique_idx
  ON entregas_eventos_notificacion (evento_id, puesto_operativo_id) WHERE puesto_operativo_id IS NOT NULL;

-- La versión 010 comprobaba la clave personal; ahora comprueba la fila de entrega.
CREATE OR REPLACE FUNCTION public.exigir_entrega_con_notificacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.entregas_eventos_notificacion e
              WHERE e.id = NEW.id AND e.notificacion_id IS NULL) THEN
    RAISE EXCEPTION 'La entrega del evento debe vincularse a una notificacion antes del COMMIT.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

ALTER TABLE responsable_gps_notificaciones ADD COLUMN puesto_operativo_id UUID;
ALTER TABLE responsable_gps_notificaciones ALTER COLUMN user_id DROP NOT NULL;
UPDATE responsable_gps_notificaciones r SET puesto_operativo_id = p.id, user_id = NULL
  FROM puestos_operativos p
 WHERE p.establecimiento_id = r.establecimiento_id AND p.legacy_user_id = r.user_id AND p.rol = 'ADMINISTRADOR';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM responsable_gps_notificaciones WHERE puesto_operativo_id IS NULL) THEN
    RAISE EXCEPTION 'Hay responsables GPS sin puesto administrador equivalente.';
  END IF;
END $$;
ALTER TABLE responsable_gps_notificaciones ADD CONSTRAINT responsable_gps_destinatario_unico_check
  CHECK ((user_id IS NULL) <> (puesto_operativo_id IS NULL));
ALTER TABLE responsable_gps_notificaciones ADD CONSTRAINT responsable_gps_puesto_fk
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
  REFERENCES puestos_operativos (id, establecimiento_id) ON DELETE RESTRICT;
