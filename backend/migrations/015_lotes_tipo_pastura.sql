-- Tipo de pastura y fecha de siembra del lote, para la estimación de forraje.
-- Los lotes existentes quedan NULL: no se asume una pastura por defecto.
-- Que la fecha de siembra no sea futura se valida en el backend con el
-- calendario de Buenos Aires, igual que la fecha de los usos; un CHECK contra
-- CURRENT_DATE dependería de la zona horaria de la sesión.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS tipo_pastura TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fecha_siembra DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lotes_tipo_pastura_check' AND conrelid = 'public.lotes'::regclass
  ) THEN
    ALTER TABLE lotes ADD CONSTRAINT lotes_tipo_pastura_check CHECK (tipo_pastura IN (
      'alfalfa', 'festuca_alta', 'mezcla_alfalfa_gramineas', 'raigras_anual', 'raigras_perenne',
      'agropiro_alargado', 'pasto_ovillo', 'cebadilla_criolla', 'avena', 'pastizal_natural'
    ));
  END IF;
END $$;
