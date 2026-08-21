CREATE TABLE IF NOT EXISTS usos_lote (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  origen TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usos_lote_fecha_idx ON usos_lote (lote_id, fecha DESC);
