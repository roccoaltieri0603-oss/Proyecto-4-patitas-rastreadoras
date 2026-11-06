-- Índice de inundación de Durante y Di Bella (2020): NDWI1 = (B04 − B11) / (B04 + B11),
-- por píxel despejado de Sentinel-2. Se guarda su media sobre el lote y la
-- fracción de píxeles por encima de −0,2 (más de 60 % de agua según la fuente).
-- Sólo aditiva: las observaciones viejas quedan NULL, no se recalculan ni se
-- rellenan. Sentinel-1 nunca las completa.
ALTER TABLE mediciones_satelitales ADD COLUMN IF NOT EXISTS ndwi1_media DOUBLE PRECISION;
ALTER TABLE mediciones_satelitales ADD COLUMN IF NOT EXISTS fraccion_inundada DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mediciones_satelitales_ndwi1_media_check' AND conrelid = 'public.mediciones_satelitales'::regclass
  ) THEN
    ALTER TABLE mediciones_satelitales ADD CONSTRAINT mediciones_satelitales_ndwi1_media_check
      CHECK (ndwi1_media IS NULL OR (ndwi1_media >= -1 AND ndwi1_media <= 1));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mediciones_satelitales_fraccion_inundada_check' AND conrelid = 'public.mediciones_satelitales'::regclass
  ) THEN
    ALTER TABLE mediciones_satelitales ADD CONSTRAINT mediciones_satelitales_fraccion_inundada_check
      CHECK (fraccion_inundada IS NULL OR (fraccion_inundada >= 0 AND fraccion_inundada <= 1));
  END IF;
END $$;
