CREATE TABLE gps_simulados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  numero SMALLINT NOT NULL CHECK (numero IN (1, 2)),
  apodo TEXT NOT NULL CHECK (length(trim(apodo)) BETWEEN 1 AND 60),
  latitud DOUBLE PRECISION NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud DOUBLE PRECISION NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  bateria_porcentaje SMALLINT NOT NULL CHECK (bateria_porcentaje BETWEEN 0 AND 100),
  conexion TEXT NOT NULL DEFAULT 'en-linea' CHECK (conexion IN ('en-linea', 'sin-senal')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (establecimiento_id, user_id, numero),
  UNIQUE (id, establecimiento_id, user_id)
);
CREATE INDEX gps_simulados_propietario_idx ON gps_simulados (user_id, establecimiento_id);
