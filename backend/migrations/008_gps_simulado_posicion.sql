-- Última posición del punto de GPS simulado del mapa, una sola fila por
-- establecimiento. No es una posición real de ganado ni de un dispositivo: es
-- dónde dejó el usuario el marcador arrastrable de la demo, para que al volver
-- a entrar aparezca donde lo dejó en vez de saltar al centroide.
--
-- Deliberadamente SIN historial: no hay tramos, jornadas ni recorrido. Guardar
-- una serie de posiciones sería el GPS real, que sigue pausado.
CREATE TABLE IF NOT EXISTS gps_simulado_posicion (
  establecimiento_id UUID PRIMARY KEY REFERENCES establecimientos(id) ON DELETE RESTRICT,
  latitud DOUBLE PRECISION NOT NULL CHECK (latitud >= -90 AND latitud <= 90),
  longitud DOUBLE PRECISION NOT NULL CHECK (longitud >= -180 AND longitud <= 180),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT
);
