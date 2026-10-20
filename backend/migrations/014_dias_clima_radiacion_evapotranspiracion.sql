-- Migración aditiva: suma radiación solar y evapotranspiración de referencia
-- a cada día climático. Las filas anteriores quedan NULL porque esas variables
-- no se pidieron a Open-Meteo en su momento; no se reconstruyen.
ALTER TABLE dias_clima
  ADD COLUMN radiacion_mj_m2 DOUBLE PRECISION CHECK (radiacion_mj_m2 >= 0),
  ADD COLUMN evapotranspiracion_mm DOUBLE PRECISION CHECK (evapotranspiracion_mm >= 0);
