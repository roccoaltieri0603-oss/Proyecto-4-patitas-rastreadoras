-- Clima diario histórico del centroide de cada lote, de la API de pronóstico
-- histórico de Open-Meteo (los mismos modelos que la consulta regular).
-- Completa los días que las consultas regulares no cubren —cada una trae sólo
-- 7 días pasados— para que la estimación de forraje cuente grados-día desde el
-- último pastoreo o desde el alta del lote, y tenga radiación en toda su
-- ventana. No es una consulta de clima: no aparece en el historial ni en el
-- estado del lote. Un día ya guardado no se reescribe.
CREATE TABLE clima_historico_lote (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  temp_min DOUBLE PRECISION,
  temp_max DOUBLE PRECISION,
  radiacion_mj_m2 DOUBLE PRECISION CHECK (radiacion_mj_m2 >= 0),
  latitud DOUBLE PRECISION NOT NULL CHECK (latitud >= -90 AND latitud <= 90),
  longitud DOUBLE PRECISION NOT NULL CHECK (longitud >= -180 AND longitud <= 180),
  proveedor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  consulted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clima_historico_lote_con_dato CHECK (temp_min IS NOT NULL OR temp_max IS NOT NULL OR radiacion_mj_m2 IS NOT NULL),
  UNIQUE (lote_id, fecha)
);
