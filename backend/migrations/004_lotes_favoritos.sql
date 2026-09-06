CREATE TABLE IF NOT EXISTS lotes_favoritos (
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lote_id)
);

CREATE INDEX IF NOT EXISTS lotes_favoritos_lote_idx ON lotes_favoritos (lote_id);
