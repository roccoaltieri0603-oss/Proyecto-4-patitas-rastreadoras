ALTER TABLE consultas_clima
  ADD COLUMN IF NOT EXISTS origen TEXT;

-- Las filas anteriores a esta migracion no permiten reconstruir su origen real.
UPDATE consultas_clima
SET origen = 'legacy'
WHERE origen IS NULL;

ALTER TABLE consultas_clima
  ALTER COLUMN origen SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'consultas_clima_origen_check'
      AND conrelid = 'consultas_clima'::regclass
  ) THEN
    ALTER TABLE consultas_clima
      ADD CONSTRAINT consultas_clima_origen_check
      CHECK (origen IN ('automatico', 'manual', 'legacy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS consultas_clima_automatico_reciente_idx
  ON consultas_clima (lote_id, created_at DESC)
  WHERE origen = 'automatico';
