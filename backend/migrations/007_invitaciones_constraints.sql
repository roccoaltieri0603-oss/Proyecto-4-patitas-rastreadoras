DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invitaciones'::regclass AND conname = 'invitaciones_permisos_validos_check') THEN
    ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_permisos_validos_check CHECK (
      permisos <@ ARRAY[
        'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
        'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
        'renombrar_establecimiento','editar_limite_establecimiento','invitar_visores',
        'invitar_administradores','gestionar_visores','gestionar_administradores',
        'revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso'
      ]::text[]
      AND array_position(permisos, NULL) IS NULL
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invitaciones'::regclass AND conname = 'invitaciones_capacidades_validas_check') THEN
    ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_capacidades_validas_check CHECK (
      capacidades <@ ARRAY[
        'crear_propietarios','eliminar_propietarios','modificar_propietarios',
        'protegido','ignorar_proteccion','poderes_principal'
      ]::text[]
      AND array_position(capacidades, NULL) IS NULL
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invitaciones'::regclass AND conname = 'invitaciones_dependencia_gestion_check') THEN
    ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_dependencia_gestion_check CHECK (
      NOT permisos && ARRAY['revocar_cualquier_permiso','otorgar_cualquier_permiso']::text[]
      OR 'gestionar_administradores' = ANY(permisos)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invitaciones'::regclass AND conname = 'invitaciones_dependencia_invitacion_check') THEN
    ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_dependencia_invitacion_check CHECK (
      NOT 'crear_admin_cualquier_permiso' = ANY(permisos)
      OR 'invitar_administradores' = ANY(permisos)
    );
  END IF;
END $$;
