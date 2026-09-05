# Contratos iniciales de API

Este documento define la forma esperada de la API para que frontend y backend puedan evolucionar sin acoplarse a `localStorage`.

Las rutas son una propuesta inicial. Si durante implementación se cambia una, actualizar este archivo en el mismo commit.

## Convenciones

- prefijo: `/api`;
- JSON para requests/responses;
- endpoints privados requieren sesión autenticada;
- nunca aceptar `user_id` como autoridad enviada por el frontend: el backend obtiene el usuario desde la sesión;
- errores con status HTTP correcto + mensaje legible;
- no devolver `password_hash`.
- cada respuesta incluye `X-Request-Id`; un identificador entrante válido se conserva y uno inválido se reemplaza;
- el body JSON tiene un límite de 1 MB;
- login y registro comparten un rate limit por IP.

## Salud operativa

- `GET /api/health/live`: liveness del proceso, sin consultar PostgreSQL;
- `GET /api/health/ready`: readiness con consulta mínima a PostgreSQL;
- `GET /api/health`: alias compatible de readiness.

Readiness devuelve `503` y `{ "status": "degraded", "database":
"unavailable" }` si PostgreSQL no está disponible.

## Auth

### `POST /api/auth/register`

Request:

```json
{
  "username": "rocco",
  "password": "..."
}
```

Respuesta `201`:

```json
{
  "user": {
    "id": "uuid",
    "username": "rocco",
    "onboardingCompleted": false
  }
}
```

Errores esperables:

- `400`: datos inválidos;
- `409`: username ocupado.

### `POST /api/auth/login`

Request igual al registro.

Respuesta `200`:

```json
{
  "user": {
    "id": "uuid",
    "username": "rocco",
    "onboardingCompleted": true
  }
}
```

### `POST /api/auth/logout`

Invalida la sesión.

### `GET /api/auth/me`

Devuelve usuario actual y estado de onboarding.

## Establecimiento

### `GET /api/establecimiento`

Devuelve el establecimiento del usuario o `null` si todavía no existe.

```json
{
  "establecimiento": {
    "id": "uuid",
    "nombre": "Campo Altieri",
    "polygon": { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [] }, "properties": {} },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `POST /api/establecimiento`

Crea el único establecimiento del usuario.

Request:

```json
{
  "nombre": "Campo Altieri",
  "polygon": { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [] }, "properties": {} }
}
```

Debe fallar si el usuario ya tiene uno.

### `PATCH /api/establecimiento`

Permite cambiar nombre y/o polígono.

Si cambia el polígono, el backend valida que todos los lotes no eliminados sigan contenidos. Si alguno queda afuera, responde error y no guarda la nueva geometría.

## Lotes

### `GET /api/lotes`

Por defecto devuelve lotes no eliminados. Puede incluir activos e inactivos.

### `POST /api/lotes`

Request:

```json
{
  "apodo": "Molino",
  "polygon": { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [] }, "properties": {} }
}
```

El backend asigna `numero` automáticamente.

Validaciones:

- usuario debe tener establecimiento;
- lote completamente dentro del establecimiento;
- no superponer área con lote no eliminado;
- si es el primer lote y el onboarding estaba pendiente, completar `onboarding_completed_at`.

### `PATCH /api/lotes/:id`

Permite como mínimo:

- cambiar apodo;
- activar/desactivar;
- cambiar geometría; el backend vuelve a validar contención y no solapamiento.

La geometría vuelve a validarse.

### `DELETE /api/lotes/:id`

No hace hard delete.

Implementación:

```text
deleted_at = NOW()
```

Respuesta puede ser `204`.

## Satélite

La opción backend-owned ya está implementada. Los endpoints de actualización
son `POST /api/lotes/:id/satelite/actualizar` y
`POST /api/lotes/satelite/actualizar`; el navegador no puede insertar
mediciones históricas crudas.

### `GET /api/lotes/:id/mediciones-satelitales`

Devuelve historial paginado, con filtros por fecha y fuente.

## Clima

### `POST /api/lotes/clima/actualizar`

Recibe `{ "loteIds": [...], "origen": "automatico" | "manual" }`, valida
ownership de todos y conserva una única consulta multi-coordenada a Open-Meteo.

### `POST /api/lotes/:id/clima/actualizar`

Recibe sólo `{ "origen": "automatico" | "manual" }`. El backend carga el
polígono, consulta, interpreta y persiste; no acepta valores meteorológicos del
cliente.

Debe persistir:

- una fila en `consultas_clima` por lote;
- sus filas asociadas en `dias_clima`.

### `GET /api/lotes/:id/clima`

Devuelve historial paginado de snapshots con días y origen.

## Notificaciones

### `GET /api/notificaciones`

Devuelve notificaciones del usuario ordenadas por fecha descendente.

### `PATCH /api/notificaciones/:id/leida`

Marca `read_at`.

### `PATCH /api/notificaciones/leidas`

Opcional: marcar todas como leídas.

Los tipos exactos de notificación siguen abiertos.

### Contrato implementado de notificaciones

`GET /api/notificaciones` ordena por `created_at DESC, id DESC`, acepta
`limit` (default 20, mÃ¡ximo 100), `offset` y
`soloNoLeidas=true|false`. Devuelve la colecciÃ³n, `noLeidas` global y
`paginacion` con `total` y `hayMas`.

`PATCH /api/notificaciones/:id/leida` es idempotente y devuelve el DTO
actualizado. `PATCH /api/notificaciones/leidas` devuelve
`{ "actualizadas": N }` y conserva los timestamps previos. Todos los endpoints
usan el usuario de sesiÃ³n; no existe endpoint HTTP de creaciÃ³n.

## Respuesta de errores

Formato recomendado:

```json
{
  "error": {
    "code": "LOT_OUTSIDE_ESTABLISHMENT",
    "message": "El lote debe quedar completamente dentro del establecimiento."
  }
}
```

Códigos legibles ayudan al frontend a decidir cómo mostrar el error sin depender sólo del texto.

La infraestructura agrega, entre otros:

- `INVALID_JSON` con `400` si el body no es JSON válido;
- `PAYLOAD_TOO_LARGE` con `413` si supera 1 MB;
- `AUTH_RATE_LIMITED` con `429` al exceder intentos de login/registro.

Los errores inesperados se registran con el mismo request ID de la respuesta,
sin incluir body, cookies, headers de autorización ni secretos.

## Estado de implementación

Auth, Establecimiento, Lotes, historial y actualizaciones backend-owned de
satélite/clima, además de notificaciones base, ya están implementados. La sesión usa la
cookie HttpOnly `rodeo_session` y los errores usan `{ "error": { "code",
"message" } }`.

## Compatibilidad frontend

## Historial implementado

El backend expone, siempre con sesión autenticada y validando pertenencia del
lote:

- `GET /api/lotes/:id/mediciones-satelitales`;
- `GET /api/lotes/:id/clima`;
- `POST/GET /api/lotes/:id/usos`;
- `GET /api/lotes/:id/historial`.

Las mediciones satelitales usan upsert por `(lote_id, fuente, observed_at)`.
Sentinel-1 y Sentinel-2 se guardan en filas separadas y los campos que no
corresponden quedan `NULL`. Sólo se persisten resultados exitosos. Las
consultas de clima y sus días se insertan en una transacción desde los
endpoints `/clima/actualizar`. Los antiguos POST históricos de satélite y clima
fueron retirados porque aceptaban observaciones generadas por el cliente.

## Estado real de integración

El estado actual ya conecta estos contratos al mapa: establecimiento y lotes
se cargan desde Neon y las mutaciones esperan el DTO devuelto por el backend.
`localStorage` no se usa como fallback y sus datos antiguos no se importan.

El frontend ya está conectado a `auth/me`, registro, login y logout. En cambio,
el mapa obtiene establecimiento y lotes desde estos contratos privados de API;
`localStorage` no participa en esa carga.

Los DTOs deberían mantener nombres y estructuras cercanas a los tipos existentes (`Establecimiento`, `Lote`, `ResultadoLote`, `ResultadoClimaLote`) para minimizar cambios en componentes de mapa y paneles.

## Consumo desde la ficha del lote

## Copernicus y actualización satelital

`GET /api/copernicus/estado` requiere sesión y devuelve
`{ "configurado": boolean }`. El endpoint raw
`POST /api/copernicus/statistics` ya no existe: el navegador no puede enviar
geometrías, evalscripts ni bodies arbitrarios usando la cuota del servidor.

`POST /api/lotes/:id/satelite/actualizar` no recibe body. Valida UUID, sesión,
ownership y soft delete; obtiene el polígono de PostgreSQL, consulta S2 y S1,
interpreta, calcula el scoring provisional vigente, persiste y devuelve
`{ "resultado": ResultadoLote }`. Lote ajeno o inexistente devuelve el mismo
`LOT_NOT_FOUND`; UUID inválido devuelve `INVALID_LOT_ID`.

`POST /api/lotes/satelite/actualizar` recibe
`{ "loteIds": ["uuid", "uuid"] }`. Valida todos los IDs y su pertenencia en una
consulta agrupada, mantiene el orden pedido y responde
`{ "resultados": ResultadoLote[] }`. La concurrencia se limita a dos lotes,
igual que en la implementación anterior.

Cuando el resultado es `estado: "ok"`, `condicion` puede traer un campo
opcional `proyeccion`:

```
proyeccion?: {
  direccion: "subiendo" | "bajando" | "estable";
  pendienteSemanal: number;                       // puntos de puntaje por semana
  proximoCambio: { categoria: CategoriaCondicion; dias: number } | null;
}
```

Es la recta de mínimos cuadrados que `backend/src/copernicus/proyeccion.ts`
ajusta sobre los puntajes de las fechas de `tendencia`, con el mismo
`calcularPuntaje` del scoring vigente. Falta cuando hay menos de tres fechas
despejadas. **No se persiste**: es un dato derivado, no una observación de
Copernicus, y se recalcula en cada respuesta. `GET /api/lotes/:id/estado` no lo
devuelve — ese endpoint sigue sin agregar scoring.

`consulted_at` usa una referencia del reloj servidor por request. Cada lote
persiste sus mediciones en una transacción: S1 y S2 ocupan filas distintas y
el `UNIQUE (lote_id, fuente, observed_at)` conserva el upsert. `error` y
`sin-datos` no crean filas.

La ruta frontend `/lotes/:id` carga el estado consolidado y, en paralelo, los
tres listados paginados existentes con 20 elementos por pÃ¡gina. Las
actualizaciones satelitales desde la ficha usan el endpoint individual y luego
recargan estado e historial. El frontend no convierte ni persiste mediciones.

## Actualización climática centralizada

Los endpoints individual y batch requieren autenticación. Todos los IDs deben
pertenecer al usuario y corresponder a lotes no eliminados; de lo contrario se
devuelve `LOT_NOT_FOUND` antes de llamar al proveedor. Express usa una
referencia temporal del servidor, consulta Open-Meteo y persiste únicamente
resultados válidos. La respuesta individual es `{ "resultado": ... }` y la
batch `{ "resultados": { "<loteId>": ... } }`.

Cada resultado `ok` incluye metadata `persistencia`. Para origen `automatico`,
`guardado:false, omitido:"reciente"` indica que ya existía una automática
creada en la última hora. El lock de la fila del lote hace atómico ese check;
las manuales siempre pueden crear snapshots. Datos faltantes permanecen
`null`; una respuesta completamente insuficiente no crea historial.

## Contratos actuales de historial

Los endpoints `GET /api/lotes/:id/mediciones-satelitales`,
`GET /api/lotes/:id/clima` y `GET /api/lotes/:id/usos` aceptan `limit` (1 a
100, default 50), `offset` (default 0), `desde` y `hasta` como fechas
`YYYY-MM-DD`, con `desde <= hasta`. Satélite acepta además
`fuente=sentinel-1|sentinel-2`.

Las respuestas conservan sus colecciones (`mediciones`, `consultas`, `usos`)
y agregan metadata consistente:

```json
{ "paginacion": { "limit": 50, "offset": 0, "total": 0, "hayMas": false } }
```

El filtro temporal de clima usa `consulted_at` como instante UTC; los filtros
de satélite y usos usan columnas `DATE`. El historial consolidado conserva las
colecciones para compatibilidad con la ficha actual, limitadas a las últimas
50 entradas por colección.

## `GET /api/lotes/:id/estado`

Este endpoint autenticado devuelve en una respuesta los datos persistidos más
recientes del lote:

```json
{
  "lote": { "id": "...", "numero": 3, "apodo": null, "activo": true },
  "satelite": { "optico": null, "radar": null },
  "clima": null,
  "uso": { "ultimoUso": null, "diasDescanso": null }
}
```

Cuando existen datos, óptica y radar se seleccionan por separado y exponen
sus estadísticas existentes junto con la edad objetiva de la observación.
Clima expone la consulta más reciente, su `origen`, `horasDesdeConsulta` y el día actual
sólo si existe en `dias_clima`. El descanso es una diferencia de fechas
calendario; sin uso es `null`.

`/estado` no llama Copernicus ni Open-Meteo, no combina Sentinel-1 con
Sentinel-2, no calcula un score nuevo y no es un modelo ni una recomendación.

## `GET /api/lotes/estado`

Devuelve `{ "lotes": [...] }` usando el mismo elemento de estado que el
endpoint individual. Por defecto incluye sólo lotes activos; acepta
`incluirInactivos=true|false` y nunca incluye soft-deleted. Los elementos se
ordenan por `lote.numero ASC`. Esta colección no se pagina todavía: se eligió
una respuesta completa porque un establecimiento tiene una cantidad razonable
de lotes y será una entrada futura del motor de decisión, no el motor mismo.

## `GET /api/ia/estado`

Autenticado. Informa si el backend tiene configurado el microservicio de
sugerencia de lotes:

```json
{ "configurado": true }
```

Es `false` cuando `IA_LOTES_URL` está vacío. El frontend usa esta respuesta
para mostrar u ocultar el botón "Subdividir con IA (experimental)": la función
es opcional y su ausencia no rompe nada.

## `POST /api/ia/sugerir-lotes`

Autenticado y sin body. El backend resuelve el establecimiento del usuario
desde la sesión, se lo manda al microservicio Python (que baja la imagen
satelital y corre el modelo), recorta lo que vuelve contra el límite real y
contra los lotes no eliminados, y responde:

```json
{
  "sugerencias": [
    {
      "id": "sug-1",
      "polygon": { "type": "Feature", "properties": { "origen": "ia", "confianza": 0.71 }, "geometry": { "type": "Polygon", "coordinates": [[[0, 0]]] } },
      "hectareas": 12.4,
      "confianza": 0.71
    }
  ],
  "meta": {
    "modelo": "MykolaL/DelineateAnything/DelineateAnything-S.pt",
    "dispositivo": "cpu",
    "zoom": 17,
    "tiles": 12,
    "metrosPorPixel": 1.2,
    "detectadas": 14,
    "descartadas": 3,
    "franjasAsignadas": 9,
    "segundos": 26.4,
    "generadoEn": "2026-09-01T12:00:00.000Z"
  }
}
```

**Este endpoint no persiste nada.** Devuelve una propuesta; los lotes existen
recién cuando el usuario confirma y el frontend los manda uno por uno a
`POST /api/lotes`, con las validaciones de contención y no solapamiento de
siempre. `sugerencias` puede venir vacío: significa que el modelo no encontró
divisiones, no que haya que inventar una.

Toda sugerencia devuelta ya fue recortada al establecimiento, restada contra
los lotes existentes y contra las otras sugerencias, y filtrada por superficie
mínima (0.25 ha), con un tope de 60. La confianza es la que reporta el modelo;
si no la informa, viaja como `null` y nunca se completa con un valor inventado.

`franjasAsignadas` cuenta las tiras finas que el recorte dejó entre dos lotes
vecinos y que el backend repartió al lote con el que comparten más borde, para
que la propuesta tesele el campo. Sólo se reparte lo que está a menos de 12 m de
dos lotes a la vez: caminos, canales, cascos, lagunas y potreros no detectados
quedan afuera de los lotes, que es lo correcto. Detalle en
`docs/IA_SUBDIVISION.md`.

Errores propios: `IA_NOT_CONFIGURED` (503), `IA_UNREACHABLE` (502),
`IA_TIMEOUT` (504), `IA_UPSTREAM_ERROR` (502) e `IA_INVALID_RESPONSE` (502).

## `POST /api/lotes/:id/simulacion-pastoreo`

Autenticado y sin body. **Es una herramienta de demo para la presentación**, no
una función de producción: responde qué diría el sistema si el lote se
pastoreara hoy.

```json
{
  "simulacion": {
    "loteId": "...",
    "esSimulacion": true,
    "generadoEn": "2026-09-04T12:00:00.000Z",
    "puntosReales": 4,
    "origen": "persistido",
    "piso": { "fecha": "2026-07-12", "ndvi": 0.21, "puntaje": 18 },
    "umbralRecuperado": 46,
    "recuperacion": { "puntajeInicial": 18, "umbralRecuperado": 46, "pendienteSemanal": 5.2, "dias": 38 },
    "mensaje": null
  }
}
```

**No escribe una sola fila.** No toca `mediciones_satelitales` —esa tabla es
sólo para observaciones reales de Copernicus— ni registra nada en `usos_lote`,
que es el registro de campo de verdad. La simulación vive en la respuesta y en
la pantalla del navegador hasta que se recarga.

Todo sale de datos reales del propio lote: `piso` es la fecha de menor NDVI de
su serie de Sentinel-2, `umbralRecuperado` es la mediana de los puntajes de esa
misma serie, y `recuperacion` es la recta de mínimos cuadrados de
`proyeccion.ts` con sus tres resguardos de siempre (mínimo 3 fechas, pendiente
mínima de 2 puntos por semana, horizonte de 60 días).

`origen` dice de dónde salió la serie. Primero se usa el historial persistido
(`"persistido"`); si todavía no llega a las 3 fechas —el historial crece de a
una por pasada consultada— se le piden a Copernicus las hasta 6 fechas
despejadas de los últimos 45 días (`"copernicus"`), que son las mismas que ve
el análisis satelital. Esas observaciones se usan y se descartan: guardarlas es
trabajo de `POST /api/lotes/:id/satelite/actualizar`, no de una simulación.

`recuperacion` viene en `null` cuando la serie no alcanza para estimar, y en ese
caso `mensaje` explica por qué. No se completa con un número inventado.
