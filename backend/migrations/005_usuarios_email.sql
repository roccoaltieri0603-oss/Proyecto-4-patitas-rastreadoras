-- Requiere usuarios vacíos o emails reales completos antes de aplicar NOT NULL.
-- Si quedan usuarios antiguos sin email, falla sin inventar ni borrar datos.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE usuarios ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_idx ON usuarios (LOWER(email));
