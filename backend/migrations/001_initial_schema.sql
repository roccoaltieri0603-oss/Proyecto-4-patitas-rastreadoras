CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS establecimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  polygon JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID NOT NULL REFERENCES establecimientos(id) ON DELETE RESTRICT,
  numero INTEGER NOT NULL,
  apodo TEXT,
  polygon JSONB NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (establecimiento_id, numero)
);

CREATE TABLE IF NOT EXISTS mediciones_satelitales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  fuente TEXT NOT NULL CHECK (fuente IN ('sentinel-1', 'sentinel-2')),
  observed_at DATE NOT NULL,
  consulted_at TIMESTAMPTZ NOT NULL,
  cobertura_valida DOUBLE PRECISION,
  ndvi_media DOUBLE PRECISION, ndvi_mediana DOUBLE PRECISION, ndvi_min DOUBLE PRECISION, ndvi_max DOUBLE PRECISION, ndvi_desvio DOUBLE PRECISION,
  ndmi_media DOUBLE PRECISION, ndmi_mediana DOUBLE PRECISION, ndmi_min DOUBLE PRECISION, ndmi_max DOUBLE PRECISION, ndmi_desvio DOUBLE PRECISION,
  ndwi_media DOUBLE PRECISION, ndwi_mediana DOUBLE PRECISION, ndwi_min DOUBLE PRECISION, ndwi_max DOUBLE PRECISION, ndwi_desvio DOUBLE PRECISION,
  evi_media DOUBLE PRECISION, evi_mediana DOUBLE PRECISION, evi_min DOUBLE PRECISION, evi_max DOUBLE PRECISION, evi_desvio DOUBLE PRECISION,
  rvi_media DOUBLE PRECISION, rvi_mediana DOUBLE PRECISION, rvi_min DOUBLE PRECISION, rvi_max DOUBLE PRECISION, rvi_desvio DOUBLE PRECISION,
  puntaje INTEGER, categoria TEXT, alertas JSONB, raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lote_id, fuente, observed_at)
);

CREATE TABLE IF NOT EXISTS consultas_clima (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  consulted_at TIMESTAMPTZ NOT NULL,
  lluvia_ultimos_7_dias DOUBLE PRECISION,
  lluvia_proximos_dias DOUBLE PRECISION,
  categoria TEXT,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dias_clima (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_clima_id UUID NOT NULL REFERENCES consultas_clima(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  lluvia_mm DOUBLE PRECISION,
  temp_min DOUBLE PRECISION,
  temp_max DOUBLE PRECISION,
  es_pronostico BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consulta_clima_id, fecha)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  lote_id UUID REFERENCES lotes(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lotes_establecimiento_idx ON lotes (establecimiento_id);
CREATE INDEX IF NOT EXISTS mediciones_lote_fecha_idx ON mediciones_satelitales (lote_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS consultas_clima_lote_fecha_idx ON consultas_clima (lote_id, consulted_at DESC);
CREATE INDEX IF NOT EXISTS dias_clima_consulta_fecha_idx ON dias_clima (consulta_clima_id, fecha);
CREATE INDEX IF NOT EXISTS notificaciones_usuario_fecha_idx ON notificaciones (user_id, created_at DESC);
