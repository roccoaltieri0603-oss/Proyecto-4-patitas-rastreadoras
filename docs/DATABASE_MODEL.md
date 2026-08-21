# Modelo de base de datos — primera versión

Base objetivo: PostgreSQL. Neon será el proveedor remoto cuando se conecte.

En esta etapa se prioriza simplicidad, trazabilidad e historial. No se usa PostGIS todavía: las geometrías se conservan como GeoJSON en `JSONB` porque el frontend ya trabaja con ese formato y el mapa funciona correctamente.

## Relaciones principales

```text
USUARIOS
   |
   | 1:1 por ahora
   v
ESTABLECIMIENTOS
   |
   | 1:N
   v
LOTES
   |\
   | \---- 1:N MEDICIONES_SATELITALES
   |
   \------ 1:N CONSULTAS_CLIMA ---- 1:N DIAS_CLIMA

USUARIOS ---- 1:N NOTIFICACIONES
```

## 1. `usuarios`

Propósito: autenticación y estado general de onboarding.

Campos propuestos:

```text
id                      UUID PK
username                VARCHAR/TEXT UNIQUE NOT NULL
password_hash           TEXT NOT NULL
onboarding_completed_at TIMESTAMPTZ NULL
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Reglas:

- `username` único;
- jamás guardar contraseña plana;
- `onboarding_completed_at IS NULL` significa onboarding pendiente;
- una vez completado, no se vuelve automáticamente a `NULL` aunque se borren/desactiven todos los lotes.

## 2. `establecimientos`

Propósito: representar el único campo/establecimiento de un usuario en esta versión.

Campos propuestos:

```text
id          UUID PK
user_id     UUID NOT NULL FK -> usuarios(id)
nombre      TEXT NOT NULL
polygon     JSONB NOT NULL
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Restricción importante:

```text
UNIQUE(user_id)
```

Esto fuerza un único establecimiento por usuario. Si el producto permite varios más adelante, esta restricción se elimina/migra.

`polygon` contiene el GeoJSON `Feature<Polygon>` que ya usa el frontend.

## 3. `lotes`

Propósito: divisiones internas del establecimiento.

Campos propuestos:

```text
id                 UUID PK
establecimiento_id UUID NOT NULL FK -> establecimientos(id)
numero             INTEGER NOT NULL
apodo              TEXT NULL
polygon            JSONB NOT NULL
activo             BOOLEAN NOT NULL DEFAULT TRUE
deleted_at         TIMESTAMPTZ NULL
created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Restricción:

```text
UNIQUE(establecimiento_id, numero)
```

### Soft delete

Los lotes no se borran físicamente en el flujo normal.

Eliminar lote significa:

```text
deleted_at = NOW()
```

La app normal consulta `deleted_at IS NULL`.

Motivo: preservar mediciones satelitales, clima y futuro historial de uso.

### Numeración

El número es automático por establecimiento. Un lote eliminado no debería provocar que otro lote reutilice automáticamente su número si eso vuelve ambiguo el historial. Preferencia inicial: números crecientes y no reutilizados.

## 4. `mediciones_satelitales`

Propósito: conservar cada observación real de Copernicus por lote.

No almacenar sólo “el valor actual”. Cada observación es histórica.

Campos propuestos:

```text
id               UUID PK
lote_id          UUID NOT NULL FK -> lotes(id)
fuente           TEXT NOT NULL              -- sentinel-2 | sentinel-1
observed_at      DATE/TIMESTAMPTZ NOT NULL  -- fecha real de la pasada
consulted_at     TIMESTAMPTZ NOT NULL       -- cuándo RODEO consultó
cobertura_valida DOUBLE PRECISION NULL

ndvi_media       DOUBLE PRECISION NULL
ndvi_mediana     DOUBLE PRECISION NULL
ndvi_min         DOUBLE PRECISION NULL
ndvi_max         DOUBLE PRECISION NULL
ndvi_desvio      DOUBLE PRECISION NULL

ndmi_media       DOUBLE PRECISION NULL
ndmi_mediana     DOUBLE PRECISION NULL
ndmi_min         DOUBLE PRECISION NULL
ndmi_max         DOUBLE PRECISION NULL
ndmi_desvio      DOUBLE PRECISION NULL

ndwi_media       DOUBLE PRECISION NULL
ndwi_mediana     DOUBLE PRECISION NULL
ndwi_min         DOUBLE PRECISION NULL
ndwi_max         DOUBLE PRECISION NULL
ndwi_desvio      DOUBLE PRECISION NULL

evi_media        DOUBLE PRECISION NULL
evi_mediana      DOUBLE PRECISION NULL
evi_min          DOUBLE PRECISION NULL
evi_max          DOUBLE PRECISION NULL
evi_desvio       DOUBLE PRECISION NULL

rvi_media        DOUBLE PRECISION NULL
rvi_mediana      DOUBLE PRECISION NULL
rvi_min          DOUBLE PRECISION NULL
rvi_max          DOUBLE PRECISION NULL
rvi_desvio       DOUBLE PRECISION NULL

puntaje          INTEGER NULL
categoria        TEXT NULL
alertas          JSONB NULL
raw_metadata     JSONB NULL
created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### Por qué hay muchos `NULL`

Sentinel-2 y Sentinel-1 no tienen las mismas variables.

- Sentinel-2: NDVI, NDMI, NDWI, EVI, puntaje/categoría.
- Sentinel-1: RVI y señal de radar; no se inventa puntaje óptico.

Por eso los campos que no aplican quedan `NULL`.

### Evitar duplicados

Conviene impedir insertar dos veces la misma observación de un lote/fuente/fecha, por ejemplo con una restricción o índice único basado en:

```text
(lote_id, fuente, observed_at)
```

La forma exacta depende de si `observed_at` se guarda como `DATE` o timestamp. Para la primera versión puede ser `DATE`, porque las respuestas actuales se manejan por fecha de pasada.

## 5. `consultas_clima`

Propósito: guardar cada snapshot de lo que Open-Meteo devolvió para un lote.

Campos propuestos:

```text
id                     UUID PK
lote_id                UUID NOT NULL FK -> lotes(id)
consulted_at            TIMESTAMPTZ NOT NULL
lluvia_ultimos_7_dias  DOUBLE PRECISION NULL
lluvia_proximos_dias   DOUBLE PRECISION NULL
categoria              TEXT NULL
raw_metadata            JSONB NULL
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
origen                  TEXT NOT NULL CHECK (origen IN ('automatico', 'manual', 'legacy'))
```

La migración `003_clima_origen.sql` marca filas históricas cuyo origen no puede
reconstruirse como `legacy`. Las nuevas filas son `automatico` o `manual`. Una
manual siempre crea snapshot; una automática reciente se deduplica usando
`created_at` del servidor y un lock transaccional sobre el lote.

## 6. `dias_clima`

Propósito: detalle diario de una `consulta_clima`.

Campos propuestos:

```text
id                 UUID PK
consulta_clima_id  UUID NOT NULL FK -> consultas_clima(id)
fecha              DATE NOT NULL
lluvia_mm          DOUBLE PRECISION NULL
temp_min           DOUBLE PRECISION NULL
temp_max           DOUBLE PRECISION NULL
es_pronostico      BOOLEAN NOT NULL
created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Restricción recomendada:

```text
UNIQUE(consulta_clima_id, fecha)
```

Así se puede saber no sólo qué ocurrió, sino también qué pronóstico tenía RODEO en una fecha determinada.

Ejemplo:

```text
Consulta del 20/08 -> para 22/08 pronosticaba 20 mm
Consulta del 21/08 -> para 22/08 pronosticaba 7 mm
```

Ambas se conservan.

## 7. `notificaciones`

Propósito: base para campana/página de notificaciones futuras.

Campos propuestos:

```text
id          UUID PK
user_id     UUID NOT NULL FK -> usuarios(id)
lote_id     UUID NULL FK -> lotes(id)
tipo        TEXT NOT NULL
titulo      TEXT NOT NULL
mensaje     TEXT NOT NULL
read_at     TIMESTAMPTZ NULL
metadata    JSONB NULL
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

`lote_id` es opcional porque algunas notificaciones pueden ser generales.

Los tipos finales no están cerrados. No construir una lista rígida todavía.

## Integridad geométrica

## 8. `usos_lote`

Tabla histórica mínima para registrar usos manuales del lote sin implementar
jornadas, ganado ni GPS:

```text
id          UUID PK
lote_id     UUID NOT NULL FK -> lotes(id) ON DELETE RESTRICT
fecha       DATE NOT NULL
origen      TEXT NOT NULL DEFAULT 'manual'
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

La migración `002_lote_usos.sql` agrega esta tabla y su índice por lote/fecha.
El backend rechaza `fecha` posterior a la fecha calendario actual con
`FUTURE_USE_DATE`. Para no depender de la zona del host, “hoy” usa
`America/Argentina/Buenos_Aires`.
Los días de descanso se calculan en cada lectura usando la fecha más reciente;
no se persiste un contador fijo.

La base guarda GeoJSON; la validación geométrica se hace en la aplicación/backend usando el mismo criterio del frontend.

## Fechas y estado consolidado

Las columnas existentes `observed_at`,
`dias_clima.fecha` y `usos_lote.fecha` son PostgreSQL `DATE`; `consulted_at`,
`created_at` y `updated_at` son `TIMESTAMPTZ`. El backend configura el parser
de `pg` para que `DATE` llegue como string `YYYY-MM-DD`, evitando desplazamientos
por zona horaria. `/api/lotes/:id/estado` sólo compone estas tablas y no
persiste datos derivados.

Reglas mínimas:

- establecimiento debe ser un Polygon válido;
- lote debe ser Polygon válido;
- lote completamente dentro del establecimiento;
- lotes no eliminados sin superposición de área;
- edición de establecimiento rechazada si deja cualquier lote no eliminado afuera.

El backend debe volver a validar estas reglas; no se debe confiar sólo en el frontend.

## Borrados y claves foráneas

Evitar `ON DELETE CASCADE` destructivo sobre lotes e historial en los flujos normales.

El borrado visible de lotes es soft delete. El borrado físico queda reservado para tareas administrativas/migraciones explícitas.

## Datos que no entran todavía

No agregar aún tablas de:

- animales;
- dispositivos;
- posiciones GPS;
- jornadas;
- planes;
- recomendaciones definitivas;
- roles/membresías;
- ML.

Esas tablas se diseñarán cuando esa etapa esté definida.
