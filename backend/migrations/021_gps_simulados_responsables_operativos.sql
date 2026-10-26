-- Responsabilidad por GPS personal y nuevos episodios operativos.
-- No reescribe ni elimina registros históricos.

CREATE TABLE gps_simulados_responsables (
  establecimiento_id UUID NOT NULL,
  user_id UUID NOT NULL,
  dispositivo_id UUID NOT NULL,
  puesto_operativo_id UUID NOT NULL,
  actualizado_por UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (establecimiento_id, user_id, dispositivo_id),
  FOREIGN KEY (dispositivo_id, establecimiento_id, user_id)
    REFERENCES gps_simulados(id, establecimiento_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (puesto_operativo_id, establecimiento_id)
    REFERENCES puestos_operativos(id, establecimiento_id) ON DELETE CASCADE
);
CREATE INDEX gps_simulados_responsables_puesto_idx
  ON gps_simulados_responsables (establecimiento_id, puesto_operativo_id);

ALTER TABLE incidencias_establecimiento
  DROP CONSTRAINT incidencias_establecimiento_tipo_check;
ALTER TABLE incidencias_establecimiento
  ADD CONSTRAINT incidencias_establecimiento_tipo_check CHECK (tipo IN (
    'satelite_optico_desactualizado', 'fallo_actualizacion_satelital',
    'fallo_actualizacion_climatica', 'gps_simulado_fuera_establecimiento',
    'gps_simulado_bateria_baja', 'gps_simulado_bateria_critica',
    'gps_simulado_bateria_episodio', 'gps_simulado_sin_senal',
    'gps_simulado_fuera_lote_asignado', 'gps_simulado_bateria_agotada',
    'gps_simulado_cambio_lote'
  ));
