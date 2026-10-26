-- Mediciones de altura del pasto cargadas por el usuario: al sacar los
-- animales, antes de entrar o en una recorrida cualquiera. Son observaciones
-- reales de campo y se guardan como tales; los kilos que salen de ellas se
-- calculan al leer y no se persisten. La fecha de salida del pastoreo no se
-- agrega acá: ya existe como usos_lote.salida_at, con hora, desde la 017.
-- Idempotente: se puede volver a correr sin error.

-- Para que una medición asociada a un uso no pueda apuntar a un uso de otro lote.
CREATE UNIQUE INDEX IF NOT EXISTS usos_lote_id_lote_unique_idx ON usos_lote (id, lote_id);

CREATE TABLE IF NOT EXISTS mediciones_altura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  momento TEXT NOT NULL CHECK (momento IN ('salida', 'antes-de-entrar', 'recorrida')),
  instrumento TEXT NOT NULL CHECK (instrumento IN ('plato', 'regla')),
  -- Promedio de las lecturas, ya en cm (la lectura del plato Filip's se divide por 2 antes de guardar).
  altura_promedio_cm DOUBLE PRECISION NOT NULL CHECK (altura_promedio_cm > 0 AND altura_promedio_cm <= 150),
  cantidad_lecturas INTEGER NOT NULL CHECK (cantidad_lecturas > 0 AND cantidad_lecturas <= 1000),
  desvio_cm DOUBLE PRECISION CHECK (desvio_cm IS NULL OR (desvio_cm >= 0 AND desvio_cm <= 150)),
  uso_id UUID,
  created_by UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mediciones_altura_uso_del_mismo_lote FOREIGN KEY (uso_id, lote_id) REFERENCES usos_lote (id, lote_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS mediciones_altura_lote_fecha_idx ON mediciones_altura (lote_id, fecha DESC);
