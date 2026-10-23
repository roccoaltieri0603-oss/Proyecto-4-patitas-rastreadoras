-- Jornadas de pastoreo, destrabadas por el equipo el 22/10/2026 y cargadas a
-- mano por el usuario. Cada uso de usos_lote puede llevar la entrada y la
-- salida del ganado con hora, la cantidad de animales por categoría de la
-- planilla de campo y la altura del remanente al salir. Los usos anteriores
-- quedan con estas columnas en NULL y siguen valiendo como antes: una fecha.
ALTER TABLE usos_lote ADD COLUMN ingreso_at TIMESTAMPTZ;
ALTER TABLE usos_lote ADD COLUMN salida_at TIMESTAMPTZ;
ALTER TABLE usos_lote ADD COLUMN animales_adultos INTEGER CHECK (animales_adultos >= 0);
ALTER TABLE usos_lote ADD COLUMN animales_toretes_vaconas INTEGER CHECK (animales_toretes_vaconas >= 0);
ALTER TABLE usos_lote ADD COLUMN animales_terneros INTEGER CHECK (animales_terneros >= 0);
ALTER TABLE usos_lote ADD COLUMN altura_remanente_cm DOUBLE PRECISION CHECK (altura_remanente_cm > 0 AND altura_remanente_cm <= 300);

ALTER TABLE usos_lote ADD CONSTRAINT usos_lote_salida_despues_de_ingreso
  CHECK (salida_at IS NULL OR (ingreso_at IS NOT NULL AND salida_at > ingreso_at));
-- La altura del remanente se mide al sacar los animales.
ALTER TABLE usos_lote ADD CONSTRAINT usos_lote_remanente_al_salir
  CHECK (altura_remanente_cm IS NULL OR salida_at IS NOT NULL);

-- Una sola jornada abierta por lote: con animales adentro no se abre otra.
CREATE UNIQUE INDEX usos_lote_jornada_abierta_unique_idx
  ON usos_lote (lote_id) WHERE ingreso_at IS NOT NULL AND salida_at IS NULL;
