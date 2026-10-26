-- GPS personales: asignación de lote, incidencias privadas y permisos operativos.
-- No reescribe historial de avisos ni crea incidencias retroactivas.

ALTER TABLE gps_simulados
  ADD COLUMN lote_asignado_id UUID;

ALTER TABLE gps_simulados
  ADD CONSTRAINT gps_simulados_lote_asignado_fk
  FOREIGN KEY (lote_asignado_id, establecimiento_id)
  REFERENCES lotes (id, establecimiento_id) ON DELETE RESTRICT;
CREATE INDEX gps_simulados_lote_asignado_idx ON gps_simulados (lote_asignado_id)
  WHERE lote_asignado_id IS NOT NULL;

ALTER TABLE incidencias_establecimiento
  DROP CONSTRAINT incidencias_establecimiento_tipo_check;
ALTER TABLE incidencias_establecimiento
  ADD CONSTRAINT incidencias_establecimiento_tipo_check CHECK (tipo IN (
    'satelite_optico_desactualizado', 'fallo_actualizacion_satelital',
    'fallo_actualizacion_climatica', 'gps_simulado_fuera_establecimiento',
    'gps_simulado_bateria_baja', 'gps_simulado_bateria_critica',
    'gps_simulado_bateria_episodio', 'gps_simulado_sin_senal', 'gps_simulado_fuera_lote_asignado'
  ));

ALTER TABLE notificaciones_personales
  DROP CONSTRAINT notificaciones_personales_tipo_check;
ALTER TABLE notificaciones_personales
  ADD CONSTRAINT notificaciones_personales_tipo_check CHECK (tipo IN (
    'ingreso_forzado', 'invitacion_aceptada', 'miembro_expulsado', 'sesion_operativa',
    'gps_simulado_bateria_baja', 'gps_simulado_bateria_critica',
    'gps_simulado_sin_senal', 'gps_simulado_fuera_establecimiento',
    'gps_simulado_cambio_lote', 'gps_simulado_fuera_lote_asignado'
  ));

ALTER TABLE membresias DROP CONSTRAINT membresias_permisos_check;
ALTER TABLE membresias ADD CONSTRAINT membresias_permisos_check CHECK (
  permisos <@ ARRAY[
    'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
    'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
    'renombrar_establecimiento','editar_limite_establecimiento','invitar_visores',
    'invitar_administradores','gestionar_visores','gestionar_administradores',
    'revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso',
    'ver_dispositivos_gps','modificar_dispositivos_gps'
  ]::text[] AND array_position(permisos, NULL) IS NULL
);
ALTER TABLE membresias ADD CONSTRAINT membresias_gps_modificar_requiere_ver_check CHECK (
  NOT 'modificar_dispositivos_gps' = ANY(permisos) OR 'ver_dispositivos_gps' = ANY(permisos)
);

ALTER TABLE invitaciones DROP CONSTRAINT invitaciones_permisos_validos_check;
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_permisos_validos_check CHECK (
  permisos <@ ARRAY[
    'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
    'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
    'renombrar_establecimiento','editar_limite_establecimiento','invitar_visores',
    'invitar_administradores','gestionar_visores','gestionar_administradores',
    'revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso',
    'ver_dispositivos_gps','modificar_dispositivos_gps'
  ]::text[] AND array_position(permisos, NULL) IS NULL
);
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_gps_modificar_requiere_ver_check CHECK (
  NOT 'modificar_dispositivos_gps' = ANY(permisos) OR 'ver_dispositivos_gps' = ANY(permisos)
);

ALTER TABLE puestos_operativos DROP CONSTRAINT puestos_operativos_permisos_check;
ALTER TABLE puestos_operativos ADD CONSTRAINT puestos_operativos_permisos_check CHECK (
  permisos <@ ARRAY[
    'crear_lotes','editar_lotes','editar_geometria_lotes','activar_lotes','eliminar_lotes',
    'actualizar_satelite','actualizar_clima','registrar_usos','modificar_usos','usar_ia',
    'renombrar_establecimiento','editar_limite_establecimiento','invitar_visores',
    'invitar_administradores','gestionar_visores','gestionar_administradores',
    'revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso',
    'ver_dispositivos_gps','modificar_dispositivos_gps'
  ]::text[] AND array_position(permisos, NULL) IS NULL
);
ALTER TABLE puestos_operativos ADD CONSTRAINT puestos_operativos_gps_modificar_requiere_ver_check CHECK (
  NOT 'modificar_dispositivos_gps' = ANY(permisos) OR 'ver_dispositivos_gps' = ANY(permisos)
);

-- Los administradores existentes ya podían operar los dos GPS antes de hacer
-- configurables estos permisos. Se preserva ese acceso y luego queda revocable.
UPDATE puestos_operativos
   SET permisos = array_append(array_append(permisos, 'ver_dispositivos_gps'), 'modificar_dispositivos_gps'),
       updated_at = NOW()
 WHERE rol = 'ADMINISTRADOR' AND activo
   AND NOT 'ver_dispositivos_gps' = ANY(permisos)
   AND NOT 'modificar_dispositivos_gps' = ANY(permisos);

UPDATE puestos_operativos
   SET permisos = array_append(permisos, 'ver_dispositivos_gps'), updated_at = NOW()
 WHERE rol = 'ADMINISTRADOR' AND activo
   AND 'modificar_dispositivos_gps' = ANY(permisos)
   AND NOT 'ver_dispositivos_gps' = ANY(permisos);
