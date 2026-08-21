# Backend de RODEO: recorrido fiel al código

> Material de estudio basado en el repositorio vigente al 21/08/2026. Cuando una explicación histórica de otros documentos contradice el código, en este archivo manda el código actual.

## 0. Alcance y método de lectura

Este recorrido no describe un backend ideal ni una aplicación genérica. Sigue imports, rutas, consultas SQL, servicios, clientes frontend, migraciones, pruebas y CI de este RODEO.

Para prepararlo se revisaron 72 archivos de backend dentro del alcance pedido:

- 45 archivos en `backend/src/`;
- 3 migraciones;
- 6 scripts;
- 14 archivos de tests;
- `backend/package.json`, los dos `tsconfig`, `vitest.config.ts` y `backend/.env.example`.

También se revisaron el frontend que llama a la API, `vite.config.ts`, toda la documentación y `.github/workflows/ci.yml`. El inventario real resultante es:

- 29 endpoints HTTP;
- 8 tablas de dominio;
- 47 tests unitarios y 51 tests de integración declarados, 98 en total;
- 5 flujos principales: autenticación, lotes, satélite, clima y ficha/historial.

No se leyó ni se documenta `node_modules`, y no se usaron secretos de archivos `.env` reales.

## 1. Mapa general de la arquitectura

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│ React 18 + React Router + Leaflet                           │
│ localhost:5173 en desarrollo                                │
└───────────────────────┬─────────────────────────────────────┘
                        │ fetch HTTP + JSON
                        │ credentials: "include"
                        │ rutas /api/...
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Vite en desarrollo                                          │
│ proxy /api/... ───────────────────────► localhost:3001       │
│ En producción puede usarse VITE_API_BASE_URL                │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Express: backend/src/app.ts                                 │
│ request ID → Helmet → CORS → JSON → routers → error handler │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Routes: método + path + middleware + controller             │
│ auth, establecimiento, lotes, historial, satélite, clima,   │
│ Copernicus, notificaciones y health                         │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Controllers: validación HTTP, ownership, SQL y respuesta    │
└──────────────┬──────────────────┬───────────────────────────┘
               │                  │
               ▼                  ▼
┌──────────────────────────┐  ┌───────────────────────────────┐
│ Servicios y dominio      │  │ PostgreSQL administrado      │
│ geometría, estado,       │  │ actualmente en Neon          │
│ persistencia, scoring    │  │ pool de pg, SQL parametrizado│
└──────────────┬───────────┘  └───────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌───────────────┐  ┌────────────────┐
│ Copernicus    │  │ Open-Meteo     │
│ OAuth +       │  │ Forecast API   │
│ Statistical   │  │ sin API key    │
│ API, S1 y S2  │  │                │
└───────────────┘  └────────────────┘
```

### Quién llama a quién

1. React nunca abre una conexión a PostgreSQL. Llama por HTTP a Express.
2. En desarrollo, Vite sólo reenvía las rutas `/api`; no ejecuta la lógica del backend.
3. Los routers de Express seleccionan el controller y aplican middleware como autenticación o rate limit.
4. Los controllers validan el caso HTTP, comprueban ownership y ejecutan SQL mediante el pool de `pg` o llaman servicios.
5. El backend, a través de sus servicios, es el único que habla con Copernicus y Open-Meteo.
6. PostgreSQL conserva usuarios, polígonos, históricos y notificaciones.
7. Neon no es otra base distinta: es el servicio donde corre el PostgreSQL actual.

## 2. Cinco recorridos completos de requests reales

### 2.1 Login: desde el formulario hasta la cookie

1. El formulario de `src/components/AuthScreen.tsx` ejecuta `enviar(event)`. En modo login llama a `login(nombre, password)`.
2. `src/api/auth.ts` serializa `{ username, password }` con `JSON.stringify` y llama a `pedir()` con `POST /api/auth/login`.
3. `src/api/client.ts` agrega `Content-Type: application/json`, `credentials: "include"` y construye la URL con `apiUrl()`.
4. En desarrollo, `vite.config.ts` proxifica `/api/auth` a `http://localhost:3001`.
5. `backend/src/app.ts` asigna request ID, aplica Helmet, CORS y el parser JSON de 1 MB. Luego entrega la request a `authRouter`.
6. `backend/src/routes/auth.ts` aplica `authRateLimiter` a login y registro y delega en `controllers/auth.ts`. Allí `credenciales()` exige username no vacío y password de al menos 8 caracteres.
7. El controller consulta `usuarios` con `WHERE username = $1`. `$1` es un parámetro, no texto concatenado.
8. `bcrypt.compare(password, user.password_hash)` compara la clave recibida con el hash guardado. Si no existe el usuario o no coincide, ambos casos producen el mismo `401 INVALID_CREDENTIALS`.
9. `crearToken(user.id)`, en `backend/src/autenticacion/session.ts`, firma un JWT cuyo `subject` (`sub`) es el UUID del usuario y cuya expiración es de 7 días.
10. `guardarCookie()` envía `Set-Cookie: rodeo_session=...` con `Path=/`, `HttpOnly`, `SameSite` configurable, `Max-Age` de 7 días y `Secure` en producción.
11. La respuesta `200` contiene sólo `{ user: { id, username, onboardingCompleted } }`; nunca contiene el hash.
12. El navegador almacena la cookie. JavaScript recibe el DTO del usuario, pero no puede leer una cookie `HttpOnly`.
13. `pedir()` parsea el JSON; `login()` extrae `.user`; `AuthScreen` llama `onAuthenticated`; `App.tsx` pasa a estado `authenticated` y renderiza las rutas autenticadas.

Resumen de lo que queda en cada lugar:

| Lugar | Qué conserva |
|---|---|
| PostgreSQL | `username`, `password_hash`, estado de onboarding y datos del usuario |
| JWT | identificador del usuario en `sub`, timestamps de emisión/expiración y firma |
| Cookie del navegador | el JWT codificado bajo el nombre `rodeo_session` |
| Estado React | DTO público: `id`, `username`, `onboardingCompleted` |
| JavaScript | no puede leer `rodeo_session` por `HttpOnly`; sí puede pedir al browser que la envíe |

### 2.2 Crear un lote

1. Leaflet entrega un `Feature<Polygon>` a `RodeoApp.onLoteDrawn()`.
2. `RodeoApp` hace validaciones rápidas de experiencia de usuario con `isFullyContained()` y `polygonsOverlap()`. No son la autoridad final.
3. `crearLote(polygon)` de `src/api/rodeo.ts` envía `POST /api/lotes` con `{ polygon, apodo }`.
4. `lotesRouter.use(requiereAutenticacion)` obliga a pasar por el middleware de sesión.
5. `requiereAutenticacion` lee la cookie, verifica firma/expiración del JWT y vuelve a consultar `usuarios` por `payload.sub`. Coloca el DTO en `req.usuario`.
6. La ruta delega en `controllers/lotes.ts`; `crearLote()` valida estructura GeoJSON con `esPolygonFeature()` y el tipo de `apodo`.
7. Obtiene un client del pool e inicia `BEGIN`.
8. Consulta el establecimiento del usuario con `FOR UPDATE`. Este lock serializa creaciones concurrentes para que no asignen el mismo número.
9. `estaContenido(nuevo, establecimiento)` usa Turf; si falla devuelve `LOT_OUTSIDE_ESTABLISHMENT`.
10. Carga todos los lotes no eliminados y `seSuperpone()` rechaza intersecciones de más de 1 m².
11. Calcula `MAX(numero) + 1` sobre todos los lotes, incluso soft-deleted. Por eso un número histórico no se reutiliza.
12. Inserta la fila en `lotes` y actualiza `usuarios.onboarding_completed_at` con `COALESCE(valor_actual, NOW())`. Es irreversible desde este flujo.
13. Si todo sale bien hace `COMMIT`; ante cualquier error hace `ROLLBACK`; siempre ejecuta `client.release()`.
14. Devuelve `201 { lote: ... }` con el DTO creado por PostgreSQL.
15. `RodeoApp` incorpora ese DTO al estado local, selecciona el lote y vuelve a pedir `/api/auth/me` para reflejar que el onboarding terminó.

La validación del frontend mejora la interacción; la del backend protege los datos incluso si otro cliente saltea la UI.

### 2.3 Actualizar satélite desde la ficha

Este flujo sí centraliza consulta, interpretación y persistencia en un solo request backend.

1. El botón de `src/pages/LotePage.tsx` ejecuta `actualizarSatelite()` y bloquea acciones paralelas mediante `ocupado`.
2. Llama `actualizarSateliteLote(lote.id)` de `src/copernicus/api.ts`.
3. El cliente envía `POST /api/lotes/:id/satelite/actualizar`, sin geometría, evalscript ni credenciales.
4. `sateliteRouter` exige autenticación y delega en `controllers/satelite.ts`; `actualizarSateliteLote()` valida el formato UUID y ejecuta `obtenerLotes([id], usuarioId)`.
5. La consulta une `lotes` con `establecimientos`, filtra por `e.user_id`, descarta `deleted_at IS NOT NULL` y obtiene el polígono desde PostgreSQL. Un lote ajeno y uno inexistente producen el mismo `404 LOT_NOT_FOUND`.
6. El controller fija una sola `referencia = new Date()` para análisis y `consulted_at`.
7. `analizadorSatelital.analizarLotes()` de `backend/src/copernicus/analizar.ts` limita el trabajo a dos lotes simultáneos. Para cada lote, `consultarLote()` lanza en paralelo la consulta óptica y la radar.
8. `cuerpoPeticion()` arma el body de Sentinel-2 L2A; `cuerpoPeticionRadar()` arma el de Sentinel-1 GRD. Ambos incluyen el polígono guardado, CRS84, intervalos `P1D`, resolución `0.0002` grados y percentil 50.
9. `backend/src/services/copernicus.ts` verifica que existan ambas credenciales. Si faltan lanza internamente `ApiError(503, COPERNICUS_NOT_CONFIGURED)`; `consultarOptico()` lo captura y lo convierte en un `ResultadoLote` con `estado: "error"`. Por eso la actualización HTTP actual responde 200 con error por lote, sin impedir que arranque el resto de RODEO.
10. El servicio obtiene un token OAuth client-credentials de CDSE, lo cachea hasta 60 segundos antes del vencimiento y llama la Statistical API con `Authorization: Bearer ...`. Si statistics devuelve 401, renueva el token y reintenta una vez.
11. Copernicus ejecuta `EVALSCRIPT_INDICES` para Sentinel-2 y `EVALSCRIPT_RADAR` para Sentinel-1.
12. `aObservacion()`/`aObservacionRadar()` convierten la respuesta estadística. Una fecha con error, estadísticas no numéricas, cero muestras o cobertura menor a 35% se descarta.
13. Para óptica se toma la observación válida más reciente de una ventana de 45 días y se arma una tendencia con las últimas 6 fechas válidas. Para radar se usa una ventana de 20 días.
14. `calcularPuntaje()`, `categorizar()` y `generarAlertas()` producen el resultado óptico provisional.
15. Radar se usa como resultado principal sólo si existe y es estrictamente más reciente que la óptica, o si no hay óptica utilizable. Si hay una óptica válida más vieja, se conserva separada en `resultado.optico`.
16. El controller llama `persistirResultadoSatelital(resultado, referencia)`. Los estados `error` y `sin-datos` no crean filas.
17. La persistencia abre una transacción por lote. `medicionesDesdeResultado()` crea una fila S2, una S1, o ambas según el resultado. `guardarMedicionSatelital()` hace upsert por `(lote_id, fuente, observed_at)`.
18. Al hacer `COMMIT`, el controller devuelve `{ resultado }`.
19. `LotePage` sólo considera exitosos `estado: "ok"` o `estado: "radar"` y luego ejecuta `cargarDatos()` para recargar estado e históricos desde PostgreSQL.

Importante: la Statistical API puede devolver muchos intervalos, pero el código persiste la observación seleccionada más reciente de cada fuente relevante, no cada intervalo devuelto en esa consulta.

### 2.4 Actualizar clima

Consulta e historial forman una sola operación backend-owned.

1. En la ficha, `LotePage.actualizarClima()` llama el endpoint individual con origen `manual`. En el mapa, `RodeoApp` envía los IDs activos al batch con origen `automatico` en la carga y `manual` al pulsar Actualizar.
2. `src/clima/api.ts` envía sólo ID/IDs y origen a `POST /api/lotes/:id/clima/actualizar` o `POST /api/lotes/clima/actualizar`.
3. `climaRouter` autentica y delega en `controllers/clima.ts`; el controller valida UUID/origen, elimina IDs repetidos y comprueba ownership + soft delete de todos antes del upstream.
4. `OpenMeteoClient.consultar()` calcula con Turf el centroide de cada lote. Cambia `[lng, lat]` de GeoJSON a `[lat, lng]` para la API.
5. Construye una sola URL multi-coordinate: latitudes y longitudes separadas por comas, redondeadas a 4 decimales.
6. Pide `precipitation_sum`, `temperature_2m_max` y `temperature_2m_min`, con `past_days=7`, `forecast_days=5` y `timezone=auto`.
7. Tiene timeout de 20 segundos. Convierte la respuesta en un `ResultadoClimaLote` por ID; faltantes quedan `null` y una respuesta completamente vacía se vuelve error.
8. Terminada la llamada HTTP externa, el controller persiste cada lote `ok` en una transacción independiente; no mantiene conexiones bloqueadas durante Open-Meteo.
9. `persistirConsultaClima()` bloquea la fila del lote. Si el origen es `automatico`, busca sólo automáticas con `created_at` servidor de la última hora; así dos requests concurrentes no insertan duplicados. Una manual siempre crea snapshot.
10. La misma transacción inserta `consultas_clima` y todos sus `dias_clima`. Un error hace `ROLLBACK` sólo de ese lote; otros resultados batch quedan aislados.
11. El endpoint responde con el resultado y metadata `persistencia`; la ficha recarga estado/historial. El frontend nunca reenvía lluvia, temperaturas, categoría, días ni `consultedAt`.

La carga automática de clima de `RodeoApp` ocurre cuando cambia `establecimiento?.id`, no mediante un cron del backend. No hay scheduler server-side.

### 2.5 Abrir la ficha de un lote

1. `RodeoApp.openFicha(id)` navega a `/lotes/:id`.
2. `App.tsx` permite esa ruta sólo si el DTO autenticado tiene `onboardingCompleted: true`.
3. `LotePage.cargarDatos()` primero llama `obtenerLotes()` y busca el ID en la colección visible del usuario. Esto da contexto de nombre/polígono y evita mostrar un lote eliminado.
4. Después lanza en paralelo cuatro requests:
   - `GET /api/lotes/:id/estado`;
   - `GET /api/lotes/:id/mediciones-satelitales?limit=20&offset=...`;
   - `GET /api/lotes/:id/clima?limit=20&offset=...`;
   - `GET /api/lotes/:id/usos?limit=20&offset=...`.
5. Cada router valida sesión y su controller comprueba ownership mediante `loteDelUsuario()` o el servicio de estado.
6. El estado obtiene la óptica más reciente, el radar más reciente, la consulta climática más reciente y el último uso. No llama APIs externas.
7. El historial satelital devuelve S1 y S2 separados; clima devuelve snapshots con sus días; usos devuelve eventos manuales.
8. `diasDescanso` se calcula en lectura como diferencia de fechas calendario entre el último uso y hoy. No existe una columna de descanso.
9. Los estados React actualizan tarjetas, tablas y paginadores. La función `obtenerHistorialLote()` y el endpoint consolidado `/historial` existen, pero la ficha actual usa los tres listados paginados separados.

## 3. Capas usadas por RODEO

| Capa | Ejemplo real | Responsabilidad |
|---|---|---|
| Frontend API client | `src/api/client.ts` | Uniforma URL, cookie, JSON y errores para el navegador. |
| Route | `routes/lotes.ts` | Define `Router`, método, path, middleware y controller, respetando el orden de matching. |
| Controller | `controllers/lotes.ts` | Lee `req`, valida el caso HTTP, coordina DB/servicios y construye la respuesta. |
| Middleware | `autenticacion/middleware.ts` | Ejecuta una tarea transversal antes de la ruta: autenticar y cargar `req.usuario`. |
| Service | `services/open-meteo.ts` | Encapsula una integración o operación reutilizable fuera del detalle HTTP de Express. |
| Domain logic | `copernicus/scoring.ts`, `geometria.ts` | Reglas y cálculos del dominio, sin decidir una URL Express. |
| Config | `configuracion/parse-env.ts` | Convierte variables de entorno en configuración validada. |
| DB | `base-datos/pool.ts` y migraciones | Conexión y estructura persistente. |
| HTTP helper | `http/errors.ts`, `http/query.ts` | Comportamiento común para errores, query params, logging y request IDs. |

Separarlas permite leer el catálogo HTTP sin atravesar SQL, probar algoritmos sin red, cambiar la forma de despliegue sin tocar scoring y reutilizar el mismo armado de estado en una ruta individual y otra batch. Los controllers siguen siendo una capa HTTP sencilla: no se introdujeron repositories, clases ni otra abstracción de dominio.

## 4. Express en este proyecto

Express es la capa que recibe requests HTTP y decide qué código ejecutar.

- `app`: la instancia creada con `express()` en `app.ts`.
- `Router`: subaplicaciones como `authRouter` o `lotesRouter` que agrupan endpoints y los conectan con middleware/controllers.
- `req`: contiene `body`, `params`, `query`, headers y las extensiones `usuario`/`requestId`.
- `res`: fija status, headers y respuesta JSON o vacía.
- `next`: pasa al middleware siguiente o al manejador de errores.
- `app.use`: monta middleware global o routers bajo un prefijo.

Los routers no interpretan payloads ni ejecutan SQL: esas operaciones están en los controllers. Ejemplos reales dentro de controllers:

- route param: `req.params.id` en `PATCH /api/lotes/:id`;
- query params: `req.query.limit`, `offset`, `desde`, `hasta` y `fuente` en históricos;
- body: `req.body.loteIds` en actualización satelital batch;
- status: `201` al crear, `204` al borrar/logout, `400` al validar, `401` sin sesión, `404` sin recurso y `503` ante indisponibilidad;
- JSON: `res.json({ lotes: ... })`.

Orden global en `app.ts`:

```text
trust proxy / x-powered-by off
  → asignarRequestId
  → Helmet
  → CORS
  → express.json(1 MB)
  → routers
  → 404 genérico
  → middleware de errores
```

## 5. `app.ts` frente a `server.ts`

`backend/src/app.ts` construye la aplicación Express: middleware, routers y manejo de errores. No abre un puerto.

`backend/src/server.ts` importa esa app y ejecuta `app.listen(env.port)`. El valor devuelto es el servidor HTTP real de Node. Además configura:

- `requestTimeout = 90 s`;
- `headersTimeout = 15 s`;
- `keepAliveTimeout = 5 s`;
- escucha de `SIGTERM` y `SIGINT`;
- cierre de conexiones idle, servidor y pool;
- timeout forzado de shutdown de 75 s.

Los tests de integración importan `app` y Supertest le envía requests en memoria. No importan `server.ts`, porque eso abriría un puerto real, agregaría conflictos y haría más difícil cerrar el proceso. En producción sí se ejecuta `server.ts` mediante el artefacto compilado.

Graceful shutdown significa dejar de aceptar requests nuevas, permitir terminar las activas, cerrar conexiones y recién entonces salir. El margen de 75 segundos contempla que Copernicus puede tardar hasta 60.

## 6. Autenticación y autorización completas

### Registro

`POST /api/auth/register` valida credenciales, calcula `bcrypt.hash(password, 12)`, inserta `usuarios`, crea JWT, fija cookie y devuelve `201`. El `12` es el cost factor de bcrypt: aumenta el trabajo deliberadamente para encarecer ataques de fuerza bruta. El constraint UNIQUE del username produce `409 USERNAME_TAKEN`.

### Login

Consulta por username y usa `bcrypt.compare`. La clave plana sólo vive durante el request; no se persiste ni se devuelve. El mensaje de error no revela si falló el usuario o la clave.

### Logout

`POST /api/auth/logout` devuelve `204` y reemplaza la cookie con una de `Max-Age=0`. No requiere middleware de auth. No hay una tabla de revocación: borrar la cookie cierra esa sesión en el browser, pero un token copiado antes de logout seguiría criptográficamente válido hasta expirar.

### `/me`

`GET /api/auth/me` usa `requiereAutenticacion` y devuelve `req.usuario`. `App.tsx` lo llama al arrancar; una respuesta 401 se transforma en `null` por `getCurrentUser()`.

### JWT y cookie

- El JWT está firmado con `AUTH_JWT_SECRET`; no está cifrado.
- `sub` guarda el UUID del usuario.
- Expira a los 7 días.
- `HttpOnly` impide que JavaScript lea la cookie; no impide que el navegador la envíe.
- `SameSite=Lax` es el default; `Strict` y `None` son configurables.
- `SameSite=None` sólo se admite con `NODE_ENV=production`, donde se agrega `Secure` y la cookie viaja sólo por HTTPS.

### Middleware y ownership

`requiereAutenticacion` no se limita a confiar en el JWT. Después de verificar firma y expiración, consulta `usuarios` por `sub`; una cuenta inexistente invalida la sesión. Así cada request privado recibe un `req.usuario` actualizado, incluido el onboarding.

Ownership significa que el servidor deriva el usuario de la sesión y filtra datos por él. Por ejemplo, satélite usa:

```sql
SELECT l.id, l.polygon
FROM lotes l
JOIN establecimientos e ON e.id = l.establecimiento_id
WHERE l.id = ANY($1::uuid[])
  AND e.user_id = $2
  AND l.deleted_at IS NULL
```

El cliente nunca envía un `user_id` que el backend acepte como autoridad. Un UUID válido de otro usuario se trata como `LOT_NOT_FOUND`, evitando confirmar su existencia.

## 7. PostgreSQL en RODEO

### Conexión y pool

`DATABASE_URL` identifica servidor, credenciales y base. `backend/src/base-datos/pool.ts` crea un `Pool` de `pg` con máximo 10 conexiones, timeout de conexión de 15 s e idle de 30 s.

`pool.query(sql, values)` toma una conexión, ejecuta y la devuelve. Para transacciones se usa `pool.connect()`, porque `BEGIN`, operaciones y `COMMIT` deben ocurrir en la misma conexión; luego hay que llamar `client.release()`.

### SQL parametrizado

`$1`, `$2`, etc. son placeholders. Los valores viajan separados del SQL, lo que reduce inyección SQL y maneja tipos correctamente. Ejemplo:

```sql
SELECT id, username
FROM usuarios
WHERE username = $1
```

`result.rows` es el arreglo de filas. `rows[0]` es la primera o `undefined`; `rowCount` indica cuántas se modificaron cuando aplica.

### Transacciones

```text
BEGIN
  operaciones relacionadas
COMMIT       si todas funcionan
ROLLBACK     ante cualquier error
release      siempre
```

RODEO las usa para crear/editar lotes, persistir una consulta climática con todos sus días y persistir las mediciones resultantes de un lote. Evitan estados parciales.

### Tipos relevantes

- `UUID`: IDs no secuenciales generados con `gen_random_uuid()`.
- `JSONB`: guarda GeoJSON y metadata JSON consultable sin convertirlo a columnas espaciales.
- `DATE`: fecha calendario sin hora (`observed_at`, días de clima, usos).
- `TIMESTAMPTZ`: instante real con zona normalizado por PostgreSQL (`consulted_at`, `created_at`, etc.).
- `FOREIGN KEY`: obliga a que, por ejemplo, un lote apunte a un establecimiento existente.
- `UNIQUE`: evita usernames repetidos, dos establecimientos por usuario o dos mediciones del mismo lote/fuente/fecha.
- `INDEX`: acelera patrones de consulta; no cambia el resultado lógico.

El parser global de `pg` para OID 1082 devuelve `DATE` como `YYYY-MM-DD`. Sin esa configuración, `pg` podría convertir la fecha a `Date` y desplazarla por timezone. No se modifica el parser de `TIMESTAMPTZ`, que continúa siendo un instante.

## 8. Base de datos real: 8 tablas

### DER textual simplificado

```text
usuarios (1) ───── (0..1) establecimientos
   │                         │
   │                         └──── (1..N) lotes
   │                                      │
   │                                      ├──── (1..N) mediciones_satelitales
   │                                      ├──── (1..N) consultas_clima
   │                                      │                │
   │                                      │                └──── (1..N) dias_clima
   │                                      └──── (1..N) usos_lote
   │
   └──── (1..N) notificaciones ─── (0..1 lote asociado)
```

Todas las FKs usan `ON DELETE RESTRICT`; los flujos normales no borran físicamente el grafo.

### `usuarios`

- PK: `id UUID`.
- Campos clave: `username UNIQUE`, `password_hash`, `onboarding_completed_at`, timestamps.
- Representa cuenta, autenticación y estado irreversible del onboarding.
- La usan auth, el middleware y la creación del primer lote.

### `establecimientos`

- PK: `id`; FK `user_id → usuarios.id`; `UNIQUE(user_id)`.
- Campos clave: `nombre`, `polygon JSONB`, timestamps.
- Relación actual 1:0..1 con usuario.
- La usan `/api/establecimiento`, rutas de lotes y ownership.

### `lotes`

- PK: `id`; FK `establecimiento_id → establecimientos.id`.
- Campos: `numero`, `apodo`, `polygon`, `activo`, `deleted_at`, timestamps.
- `UNIQUE(establecimiento_id, numero)` preserva identidad histórica.
- La usan CRUD, satélite, clima, estado, historial y opcionalmente notificaciones.

### `mediciones_satelitales`

- PK: `id`; FK `lote_id → lotes.id`.
- Fuente limitada por CHECK a `sentinel-1` o `sentinel-2`.
- `observed_at DATE`, `consulted_at TIMESTAMPTZ`, cobertura, estadísticas NDVI/NDMI/NDWI/EVI/RVI, puntaje, categoría, alertas y metadata.
- UNIQUE `(lote_id, fuente, observed_at)` sostiene el upsert.
- La usan persistencia satelital, endpoints históricos y estado consolidado.

### `consultas_clima`

- PK `id`; FK `lote_id`.
- Un snapshot: momento consultado, acumulados, categoría, metadata y origen validado (`automatico`, `manual`, `legacy`).
- Cada actualización guardada crea una fila, salvo dedupe automático reciente.
- La usan actualización/GET de clima y estado.

### `dias_clima`

- PK `id`; FK `consulta_clima_id → consultas_clima.id`.
- Fecha, lluvia, temperaturas y flag `es_pronostico`.
- UNIQUE `(consulta_clima_id, fecha)`.
- Permite conservar qué pronóstico devolvió cada snapshot.

### `notificaciones`

- PK `id`; FK `user_id`; FK opcional `lote_id`.
- Tipo libre, título, mensaje, `read_at`, metadata y creación.
- La API actual sólo lista y marca; no hay endpoint de creación ni reglas automáticas.

### `usos_lote`

- PK `id`; FK `lote_id`.
- `fecha DATE`, `origen` con default `manual`, `created_at`.
- Conserva eventos; no guarda un contador de descanso.
- La usan registro/listado de usos y estado consolidado.

### Índices actuales

Hay índices por establecimiento de lote, medición lote/fecha, consulta climática lote/fecha, día por consulta/fecha, notificación usuario/fecha y uso lote/fecha. Los UNIQUE también crean estructuras para verificar unicidad.

## 9. Neon

Neon no reemplaza PostgreSQL. Neon aloja y administra la instancia PostgreSQL remota actual; el backend sigue hablando el protocolo PostgreSQL mediante `pg` y `DATABASE_URL`.

Si mañana se usa otro PostgreSQL compatible, en principio cambiarían la URL, SSL/parámetros del proveedor, backups y operación. Las tablas, SQL, pool, migraciones y contratos HTTP podrían mantenerse. El código no importa un SDK de Neon.

## 10. Migraciones

Una migración versiona la estructura de la base por separado del código que la usa.

- `001_initial_schema.sql`: habilita `pgcrypto`, crea las primeras siete tablas, constraints e índices.
- `002_lote_usos.sql`: agrega `usos_lote` y su índice.
- `003_clima_origen.sql`: agrega/backfillea `consultas_clima.origen`, su CHECK y el índice parcial para automáticas recientes.
- `backend/scripts/migrate.ts`: ordena los `.sql`, abre una transacción y ejecuta todos.
- `npm run db:migrate`: comando explícito; el servidor no migra al arrancar.

Los scripts usan operaciones idempotentes donde corresponde, pero no existe una tabla ledger de migraciones aplicadas. Por eso cada ejecución vuelve a recorrer los tres archivos. Código y estructura son diferentes: agregar una query en TypeScript no crea una columna; agregar SQL no enseña automáticamente al frontend a usarla.

## 11. Geometría de establecimiento y lotes

GeoJSON representa geometrías en JSON. RODEO usa:

```json
{
  "type": "Feature",
  "properties": {},
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[longitud, latitud], [longitud, latitud], "..."]]
  }
}
```

- `Feature` envuelve geometría y propiedades.
- `Polygon` contiene uno o más anillos.
- Cada punto está en orden `[longitud, latitud]`.

`esPolygonFeature()` comprueba estructura, tipo, anillos de al menos cuatro puntos y coordenadas numéricas finitas. No comprueba explícitamente rangos geográficos, cierre del anillo ni todas las reglas topológicas.

`estaContenido(inner, outer)` usa `turf.difference(featureCollection([inner, outer]))`: si no queda diferencia, el lote está contenido. Ante excepción devuelve `false`.

`seSuperpone(a, b)` calcula intersección y sólo considera solapamiento de área mayor a 1 m². Compartir borde no debería contar. Ante excepción devuelve `true`, una decisión conservadora.

Reglas backend:

- crear/editar lote: contenido y sin solapar otros no eliminados;
- editar establecimiento: todos los lotes no eliminados deben seguir dentro;
- lotes inactivos también participan de esas validaciones;
- lote soft-deleted no participa.

Se usa `JSONB` porque preserva el formato que ya consume Leaflet/Turf y evita introducir PostGIS antes de necesitar consultas espaciales de base.

## 12. Soft delete

`DELETE /api/lotes/:id` no ejecuta `DELETE FROM lotes`. Ejecuta un `UPDATE` que fija `deleted_at = NOW()` y `updated_at = NOW()`.

Consecuencias:

- el lote desaparece de consultas normales por `deleted_at IS NULL`;
- sus mediciones, clima y usos siguen ligados a una fila existente;
- las FKs no se rompen;
- `MAX(numero) + 1` sigue viendo el número y no lo reutiliza;
- no hay endpoint actual para restaurarlo.

`activo=false` no es borrado: el lote sigue visible si la UI incluye inactivos, conserva geometría y participa en validaciones.

## 13. Satélite: Copernicus, Sentinel-1 y Sentinel-2

### Conceptos separados

- **Copernicus Data Space Ecosystem (CDSE)** es la plataforma externa usada para obtener datos.
- **Sentinel-2 L2A** es una fuente óptica. Sus bandas permiten calcular los índices usados por RODEO, pero nubes y sombras pueden invalidar píxeles.
- **Sentinel-1 GRD** es radar en banda C. No depende de luz visible y las nubes no lo tapan de la misma forma.
- **Statistical API** recibe polígono, rango temporal, dataset y evalscript; devuelve estadísticas por intervalos.
- **Evalscript** es JavaScript ejecutado en la infraestructura de Sentinel Hub para transformar bandas por píxel antes de agregarlas.

RODEO nunca mezcla S1 y S2 en un mismo puntaje. Una observación radar no recibe un puntaje óptico inventado.

### Requests construidos por el backend

`backend/src/copernicus/analizar.ts` fija:

| Constante | Valor real | Uso |
|---|---:|---|
| `DIAS_VENTANA` | 45 | búsqueda óptica |
| `DIAS_VENTANA_RADAR` | 20 | búsqueda radar |
| `RESOLUCION_GRADOS` | 0.0002 | `resx` y `resy` |
| `COBERTURA_MINIMA` | 0.35 | descarta fecha con menos de 35% válido |
| `FECHAS_TENDENCIA` | 6 | observaciones ópticas para tendencia |
| `CONCURRENCIA` | 2 | lotes procesados simultáneamente |

Ambos bodies usan CRS84 y agregación diaria `P1D`. Piden percentil `p50`, que se usa como mediana cuando está disponible. S2 usa `mosaickingOrder: "leastCC"`; S1 usa el dataset `sentinel-1-grd`.

### Evalscript óptico

`EVALSCRIPT_INDICES` pide B02, B03, B04, B08, B11, SCL y `dataMask`. Excluye clases SCL 0, 1, 3, 8, 9, 10 y 11. Los índices se acotan a `[-1, 1]`:

- NDVI: `(B08 - B04) / (B08 + B04)`;
- NDMI: `(B08 - B11) / (B08 + B11)`;
- NDWI: `(B03 - B08) / (B03 + B08)`;
- EVI: `2.5 * (B08 - B04) / (B08 + 6*B04 - 7.5*B02 + 1)`.

Este archivo calcula fórmulas; no decide por sí solo qué lote recomendar.

### Evalscript radar

`EVALSCRIPT_RADAR` pide VV y VH en `LINEAR_POWER`. Rechaza valores no finitos o no positivos y calcula:

```text
suma = VV + VH
dop = VV / suma
RVI = sqrt(dop) * (4 * VH / suma)
```

El valor superior se limita a 1. El backend guarda estadísticas de RVI separadas y deja índices ópticos en `NULL`.

### Interpretación de estadísticas

Para cada intervalo, el backend lee media, desvío, mínimo, máximo y p50. Si p50 falta, usa la media como mediana. La cobertura se calcula como:

```text
(sampleCount - noDataCount) / sampleCount
```

Una estadística inválida o `NaN` hace que se descarte el intervalo completo. Las observaciones válidas se ordenan por fecha. La óptica más reciente alimenta condición y las últimas seis alimentan tendencia.

### Scoring provisional

`backend/src/copernicus/scoring.ts` normaliza y pondera:

- mediana NDVI: rango 0.2–0.8, peso 0.5;
- media NDMI: rango -0.1–0.35, peso 0.3;
- media EVI: rango 0.1–0.55, peso 0.2.

La base se multiplica por 100. La media NDWI por encima de -0.05 inicia una penalización que llega hasta 25 puntos en 0.2. El resultado se redondea y limita a 0–100.

Categorías:

- 70 o más: `excelente`;
- 50–69: `buena`;
- 30–49: `regular`;
- menos de 30: `baja`.

Alertas actuales:

- dato óptico de más de 12 días;
- cobertura menor a 60%;
- NDWI medio mayor a -0.05;
- NDMI medio menor a 0;
- desvío NDVI mayor a 0.15.

Estos rangos son un **scoring provisional de condición satelital**. No son IA, probabilidad, ranking final, recomendación de pastoreo ni modelo agronómico calibrado.

### Fallback radar y persistencia

Óptica y radar se consultan siempre en paralelo. Si la óptica existe y es igual o más nueva, se devuelve `estado: "ok"`. Radar se vuelve resultado principal sólo si es estrictamente más nuevo o no hay óptica válida. Puede incluir una óptica anterior en una propiedad separada.

La persistencia usa el mismo instante servidor para `consulted_at`. Hace upsert, de modo que consultar de nuevo la misma fuente/fecha actualiza esa observación en lugar de duplicarla. Cada lote tiene su transacción. Un error o `sin-datos` no crea historial.

### Credenciales, token y TLS

`COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET` son opcionales para arrancar, pero ambas son necesarias para consultar. No tienen prefijo `VITE_` y nunca se envían al browser.

El servicio construye una cadena CA con las raíces de Node, archivos `.pem/.crt/.cer` encontrados en carpetas `certs` conocidas y `NODE_EXTRA_CA_CERTS`. El timeout upstream es 60 segundos. Los errores TLS conocidos se convierten en un error entendible; no se desactiva la validación de certificados.

## 14. Open-Meteo

Open-Meteo no necesita API key. El backend usa el centroide porque el proveedor recibe coordenadas puntuales, mientras RODEO almacena polígonos. El centroide es una representación simple del lote; no hace promedio espacial del pronóstico.

Una petición con N lotes contiene N latitudes y N longitudes separadas por comas. Eso evita una llamada HTTP por lote. La respuesta puede ser un objeto para un lote o un arreglo para varios; el servicio normaliza ambos casos manteniendo el orden.

Variables y parámetros reales:

```text
daily = precipitation_sum, temperature_2m_max, temperature_2m_min
past_days = 7
forecast_days = 5
timezone = auto
timeout = 20 segundos
```

El índice 7 se marca como hoy/pronóstico; los siete anteriores forman `lluviaUltimos7Dias` y desde el índice 7 se suma `lluviaProximosDias`.

Categorías implementadas:

- semana `>= 40 mm`: `piso-pesado`;
- si no, próximos días `>= 15 mm`: `lluvia`;
- semana `< 5` y próximos `< 5`: `seco`;
- resto: `normal`.

Estas categorías tampoco son calibración agronómica definitiva. Un valor diario
faltante/no finito permanece `null`. Si falta lluvia dentro de una ventana, su
suma y categoría quedan `null`; si faltan todos los valores meteorológicos, el
resultado es error y no se persiste.

Cada persistencia exitosa crea un snapshot en `consultas_clima` y sus fechas en
`dias_clima`. `origen` queda persistido. Para `automatico`, un lock sobre la
fila del lote serializa check+insert y sólo considera automáticas con
`created_at >= NOW() - INTERVAL '1 hour'`. `consulted_at` usa la referencia
temporal fijada por el backend.

## 15. Estado actual derivado

### `GET /api/lotes/:id/estado`

Valida ownership y llama `obtenerEstadosDeLotes([id])`. Devuelve:

- datos básicos del lote;
- última fila S2 como `satelite.optico`;
- última fila S1 como `satelite.radar`;
- última consulta climática y, si existe, el día calendario actual;
- último uso y días de descanso.

### `GET /api/lotes/estado`

Primero toma los IDs del establecimiento del usuario. Por defecto incluye lotes activos; `?incluirInactivos=true` agrega inactivos no eliminados. Después reutiliza el mismo servicio y devuelve la colección ordenada por número.

### No existe una tabla `estado`

El estado se deriva en lectura. `backend/src/services/estado-lotes.ts` ejecuta:

1. una query para lotes presentes;
2. cuatro queries paralelas con `DISTINCT ON (lote_id)` para última óptica, radar, clima y uso;
3. una query batch para el día de hoy de todas las consultas climáticas encontradas.

Luego arma `Map` por ID. No hace cuatro queries por cada lote; evita el patrón N+1. Para una colección, la cantidad conceptual de queries permanece acotada aunque aumenten los lotes.

`diasDesdeObservacion` usa diferencia de fechas calendario. `horasDesdeConsulta` usa instantes. Ningún endpoint de estado llama a Copernicus/Open-Meteo, recalcula scoring ni persiste derivados.

## 16. Historial, paginación y filtros

Los tres listados aceptan:

- `limit`: default 50, mínimo 1, máximo 100;
- `offset`: default 0, mínimo 0;
- `desde` y `hasta`: fechas válidas `YYYY-MM-DD`, con `desde <= hasta`.

Satélite además acepta `fuente=sentinel-1|sentinel-2`.

La respuesta incluye:

```json
{
  "paginacion": {
    "limit": 50,
    "offset": 0,
    "total": 123,
    "hayMas": true
  }
}
```

`total` viene de `COUNT(*)`; `hayMas` compara `offset + filasDevueltas < total`.

Orden real:

- mediciones: `observed_at DESC, fuente ASC, id ASC`;
- clima: `consulted_at DESC, id ASC`, con todos los días de esa página cargados mediante una query `ANY(uuid[])`;
- usos: `fecha DESC, created_at DESC, id ASC`.

El filtro de clima interpreta `desde/hasta` como límites UTC de `consulted_at`. Satélite y usos filtran columnas `DATE`.

`GET /api/lotes/:id/historial` es un contrato de compatibilidad: devuelve hasta 50 de cada colección. Para satélite y usos pide 51 para calcular `hayMas`; clima usa su paginador. La ficha vigente no lo llama.

Los endpoints históricos de satélite y clima son sólo de lectura. Los antiguos
POST que aceptaban observaciones del cliente fueron retirados; las escrituras
provienen exclusivamente de los flujos backend-owned.

## 17. Descanso

El descanso no es una predicción ni una columna fija. `obtenerEstadosDeLotes()` elige el uso de fecha más reciente y calcula:

```text
diasDescanso = max(0, fechaCalendarioDeHoy - fechaDelUltimoUso)
```

`diasEntreFechas()` trabaja con medianoches UTC construidas desde partes `YYYY-MM-DD`, evitando diferencias de horario de verano o zona. Sin usos devuelve `ultimoUso: null` y `diasDescanso: null`.

Además del `max` de UI, el backend compara contra `hoyCalendario()` y rechaza
una fecha futura con `400 FUTURE_USE_DATE`.

## 18. Notificaciones

La infraestructura implementada incluye tabla, API privada, hook React, badge/panel y marcado leído.

`GET /api/notificaciones`:

- default 20, máximo 100;
- `offset`;
- `soloNoLeidas=true|false`;
- orden `created_at DESC, id DESC`;
- tres queries paralelas: items, total filtrado y total global no leído.

`PATCH /api/notificaciones/:id/leida` valida UUID y ownership. Usa `COALESCE(read_at, NOW())`, por lo que es idempotente y conserva el primer timestamp.

`PATCH /api/notificaciones/leidas` marca todas las no leídas y devuelve cuántas actualizó.

No existe endpoint HTTP de creación, scheduler, polling, catálogo cerrado ni reglas automáticas. Esas partes **no están implementadas todavía**.

## 19. El frontend necesario para entender el backend

### `src/api/client.ts`

`pedir<T>()` es el único wrapper general sobre `fetch`:

1. `apiUrl()` antepone `VITE_API_BASE_URL` si existe;
2. usa `credentials: "include"`;
3. agrega `Content-Type: application/json`;
4. conserva headers específicos de la llamada;
5. devuelve `undefined` para 204;
6. intenta `response.json()` para otros status;
7. en error HTTP crea `ApiError(status, message, code)`;
8. si un 2xx trae JSON inválido o `null`, lanza `INVALID_RESPONSE`;
9. si falla la red, usa status interno 0 y un mensaje de conexión.

Cada fachada serializa bodies con `JSON.stringify`: `api/auth.ts`, `api/rodeo.ts`, `api/historial.ts`, `api/notificaciones.ts`, `clima/api.ts` y `copernicus/api.ts`.

### Inicio de React y sesión

`src/main.tsx` monta `App` dentro de `StrictMode` y `BrowserRouter`. `App.tsx` tiene estados `loading`, `unauthenticated`, `authenticated`; todos sus hooks se ejecutan antes de returns condicionales. La lógica pesada del mapa vive en `RodeoApp`.

La implementación real no renderiza `SetupPendingScreen`. Un usuario autenticado pendiente entra a `RodeoApp`, que deriva `onboardingStep` y ejecuta el onboarding dentro del mapa.

### Proxy Vite

En desarrollo:

```text
Browser http://localhost:5173
  └─ pide /api/lotes
       └─ Vite proxy
            └─ http://localhost:3001/api/lotes
```

Hay proxies explícitos para auth, establecimiento, lotes, Copernicus,
notificaciones y health. Clima usa el prefijo `/api/lotes`. El browser ve una
URL relativa y evita CORS en esta topología local.

En un build donde API y frontend tienen dominios distintos, `VITE_API_BASE_URL=https://api...` queda incorporada al bundle. Es una URL pública, no un secreto.

## 20. CORS

Un origen combina esquema, host y puerto. `http://localhost:5173` y `http://localhost:3001` son orígenes distintos.

- **Mismo origen/proxy:** el browser cree que llama al mismo origen; Vite o el servidor frontal enruta `/api` internamente.
- **Dominios separados:** el backend compara el header `Origin` con `CORS_ORIGINS`.

`app.ts` configura `credentials: true`. Para un origen permitido, el middleware responde con `Access-Control-Allow-Origin` específico y habilita credenciales. Un origin no listado no recibe permiso del browser. Requests sin Origin, como server-to-server o ciertas herramientas, se admiten.

`Access-Control-Allow-Origin: *` no puede combinarse correctamente con cookies/credentials, porque permitiría una política demasiado amplia y los navegadores no aceptan wildcard para credenciales.

CORS es una política del navegador; no reemplaza autenticación ni evita que un cliente no-browser intente llamar a la API.

## 21. Hardening de producción

| Medida | Problema que reduce | Implementación real |
|---|---|---|
| Helmet | headers inseguros o faltantes | `app.ts`; CSP y CORP se deshabilitan para compatibilidad actual, el resto queda activo |
| `x-powered-by` off | revelar Express innecesariamente | `app.disable('x-powered-by')` |
| Rate limit | fuerza bruta/spam de auth | 15 intentos por IP en 15 min para login+registro, `MemoryStore` |
| Límite de body | consumo de memoria por JSON grande | `express.json({ limit: '1mb' })`, error 413 |
| JSON inválido | errores opacos del parser | `INVALID_JSON` 400 |
| Request ID | correlacionar respuesta y log | conserva IDs válidos de hasta 128 caracteres o genera UUID |
| Logs estructurados | diagnóstico auditable | JSON con timestamp, requestId, method, path, status y error |
| Redacción | fuga accidental de secretos | oculta URLs/secret JWT/Copernicus en mensaje y stack |
| `/live` | saber si vive el proceso | no toca DB |
| `/ready` y `/health` | saber si puede atender con DB | `SELECT 1`, 503 si falla |
| `trust proxy` | IP/protocolo correctos tras proxy | falso o 1–10 saltos validados |
| Timeouts HTTP | conexiones colgadas/lentas | 90 s request, 15 s headers, 5 s keep-alive |
| Graceful shutdown | cortar requests/transacciones | SIGTERM/SIGINT, cierre servidor/pool, límite 75 s |
| Pool acotado | agotar DB/esperar sin límite | máximo 10, connect 15 s, idle 30 s |

El rate limit en memoria es por proceso y se pierde al reiniciar. Si hubiera múltiples instancias, haría falta un store compartido para un límite global.

## 22. Manejo de errores

`ApiError` lleva `status`, `code` y `message`. Las rutas lanzan errores esperables. `asyncHandler()` convierte el rechazo de una función async en `next(error)`. El último middleware de `app.ts` llama `errorResponse()` y devuelve siempre:

```json
{
  "error": {
    "code": "LOT_NOT_FOUND",
    "message": "Lote inexistente."
  }
}
```

Los `ApiError` menores a 500 no se registran como fallos inesperados. Errores desconocidos y 5xx sí pasan por `registrarError()`, pero el cliente sólo recibe `500 INTERNAL_ERROR` genérico.

Casos reales:

| Status | Ejemplo |
|---:|---|
| 400 | UUID/query/body/polígono inválido, lote fuera o solapado |
| 401 | cookie ausente/inválida o credenciales incorrectas |
| 404 | ruta genérica, lote/notificación no visible para el usuario |
| 409 | username ocupado, segundo establecimiento o establecimiento requerido |
| 413 | JSON superior a 1 MB |
| 429 | demasiados intentos de login/registro |
| 500 | error inesperado o geometría guardada inválida durante satélite |
| 503 | DB no lista en `/health` o `/ready` |

El servicio Copernicus crea errores internos 502/503, pero `AnalizadorSatelital` los captura. El controller de actualización vigente responde HTTP 200 con un `ResultadoLote` `estado: "error"`; no expone normalmente esos status upstream como respuesta HTTP.

## 23. Qué protege hoy RODEO

- **bcrypt:** evita guardar claves reversibles; no arregla una contraseña débil elegida por el usuario.
- **Cookie HttpOnly:** dificulta robo por JavaScript; no elimina todos los riesgos XSS ni protege un equipo comprometido.
- **JWT firmado:** detecta alteración y expira; no cifra el contenido ni se revoca automáticamente en logout.
- **Lookup de usuario por request:** invalida cuentas inexistentes; agrega una query DB por request privado.
- **Ownership:** separa datos de usuarios; depende de que cada nueva ruta aplique correctamente filtros de sesión.
- **SQL parametrizado:** reduce inyección en valores; no vuelve segura una consulta dinámica construida sin cuidado.
- **CORS:** restringe browsers por origen; no autentica y no bloquea clientes server-to-server.
- **Rate limit:** frena intentos repetidos por IP/proceso; no es protección distribuida.
- **Helmet:** agrega headers; CSP está desactivada en la configuración actual.
- **Body limit:** reduce abuso de payload; no limita costo de todas las operaciones válidas.
- **Secrets en entorno:** evita versionarlos/mandarlos al browser; el entorno y los logs igualmente deben protegerse.
- **404 genérico + ownership:** reduce enumeración; no reemplaza autorización.
- **Base de test aislada:** protege producción de `TRUNCATE`; depende de configurar una URL realmente separada.

No hay protección CSRF específica basada en token. `SameSite` ayuda según topología, pero si se despliega cross-site con `SameSite=None` debe reevaluarse el modelo CSRF. Tampoco hay roles, MFA ni revocación server-side de sesiones.

## 24. Tests automáticos

### Unitarios frente a integración

Un test unitario aísla una función/clase y controla sus dependencias. Los 47 actuales prueban configuración, fechas/zona calendario, geometría, query params, request ID, hardening, Copernicus, analizador satelital, Open-Meteo, schema verify y cleanup smoke.

Un test de integración atraviesa Express, middleware y PostgreSQL real. Los 51 actuales usan Supertest con `app`, sin abrir puerto, y agentes que conservan cookies. Verifican health/auth, integraciones sustituidas, ownership, geometría, transacciones, upserts, clima, estado, historial y notificaciones.

Vitest es el runner/aserciones. Supertest simula el cliente HTTP contra la app Express.

### Por qué PostgreSQL real

Las integraciones necesitan comprobar SQL, constraints, `DATE`, `TIMESTAMPTZ`, transacciones, locks y comportamiento de `pg`. Un mock no demostraría que la migración y las queries coinciden.

`TEST_DATABASE_URL` es obligatoria cuando `NODE_ENV=test`. No hay fallback a `DATABASE_URL`, y se rechaza explícitamente que ambas cadenas sean iguales. Si falta, el bloque de integración se omite de forma segura; los unitarios siguen disponibles.

`backend/tests/helpers/db.ts` aplica migraciones y antes de cada test trunca las ocho tablas con reinicio de identidades y `CASCADE`. Esa base debe ser descartable. También se reinicia el `MemoryStore` del rate limit para aislar casos.

Las integraciones sustituyen transporte/gateway de Copernicus y Open-Meteo mediante `reemplazarGateway()` y `reemplazarTransporte()`: prueban el código de RODEO sin consumir servicios/cuotas reales.

### Inventario de tests

- `tests/helpers/db.ts`: guardas de URL, migración y limpieza.
- `tests/helpers/fixtures.ts`: usuarios, polígonos y payloads reutilizables.
- `tests/integration/api.test.ts`: los 51 casos HTTP+DB.
- `tests/unit/analizador-satelital.test.ts`: bodies, parsing, fallback, scoring, concurrencia.
- `tests/unit/config.test.ts`: validación de entorno.
- `tests/unit/copernicus.test.ts`: credenciales, OAuth, cache y retry 401.
- `tests/unit/fechas.test.ts`: `DATE`, diferencias y frescura.
- `tests/unit/geometria.test.ts`: estructura, contención y solapamiento.
- `tests/unit/http-hardening.test.ts`: headers, CORS, body, errores y logs.
- `tests/unit/open-meteo.test.ts`: request multi-coordinate e interpretación.
- `tests/unit/query.test.ts`: paginación, booleanos y rangos.
- `tests/unit/request-id.test.ts`: conservación/reemplazo de identificadores.
- `tests/unit/schema-verifier.test.ts`: detecta estructuras DB esenciales ausentes.
- `tests/unit/smoke-cleanup.test.ts`: exige el username smoke estricto.

`vitest.config.ts` usa entorno Node, limpia mocks y da 30 segundos porque las integraciones pueden hacer múltiples roundtrips contra Neon remoto.

## 25. Scripts y comandos operativos

| Comando/archivo | Función |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run typecheck` | TypeScript productivo sin emitir |
| `npm run build` | compila `src` y scripts a `dist` |
| `npm start` | ejecuta `dist/src/server.js` |
| `npm run db:migrate` / `scripts/migrate.ts` | aplica los SQL en transacción |
| `npm run db:verify` / `scripts/verify-schema.ts` | comprueba tablas, columnas/tipos, PK, FK, UNIQUE, CHECK e índices |
| `npm run test:smoke` / `scripts/smoke.ts` | recorre API, clima, uso y estado contra un servidor levantado |
| `scripts/list-smoke-users.ts` | lista usuarios de smoke identificables |
| `scripts/cleanup-user.ts` | limpieza administrativa acotada por `SMOKE_USERNAME` |
| `scripts/smoke-cleanup.ts` | guard y borrado compartido de todas las tablas dependientes |
| `npm test` | typecheck de tests, unitarios e integración |
| `npm run test:coverage` | suite con cobertura V8 |

La limpieza administrativa de smoke elimina relaciones de un usuario de prueba
en orden, incluido `usos_lote`. Sólo admite el formato exacto
`rodeo_smoke_<13 dígitos>`, resuelve primero un único UUID y confirma al final
que el usuario ya no exista.

El backend es ESM (`"type": "module"`). `tsconfig.json` usa target ES2022, módulos/resolución `NodeNext`, modo `strict`, incluye `src` y `scripts`, y emite a `dist`. `tsconfig.test.json` lo extiende, agrega `tests` y fuerza `noEmit`; así el typecheck de la suite también valida fixtures y Supertest sin producir artefactos.

## 26. Integración continua (CI)

`.github/workflows/ci.yml` se ejecuta en cada `push` y `pull_request` con Node 22.

Job frontend:

```text
npm ci → npx tsc --noEmit → npm run build
```

Job backend, dentro de `backend/`:

```text
npm ci → npm run typecheck → npm run build → npm run test:unit
```

La CI actual no ejecuta integraciones porque no configura `TEST_DATABASE_URL`. CI valida una revisión de código; deploy publica/arranca una versión en un entorno. Este workflow no despliega nada.

## 27. Variables de entorno

Nunca se listan valores reales.

| Variable | La usa | ¿Secreto? | Propósito | Default/comportamiento |
|---|---|---:|---|---|
| `NODE_ENV` | backend config | No | `development`, `test` o `production` | `development` |
| `PORT` | `server.ts`, smoke | No | puerto HTTP | `3001` |
| `DATABASE_URL` | backend productivo/desarrollo | Sí | conexión PostgreSQL | obligatoria fuera de test |
| `TEST_DATABASE_URL` | config/tests | Sí | DB PostgreSQL descartable | obligatoria en test; nunca fallback |
| `AUTH_JWT_SECRET` | sesión/config/logger | Sí | firmar/verificar JWT | obligatoria, mínimo 32 caracteres útiles |
| `CORS_ORIGINS` | `app.ts` | No | allowlist exacta separada por comas | lista vacía |
| `TRUST_PROXY` | Express | No | cantidad de proxies confiables | `false`; si existe, entero 1–10 |
| `COOKIE_SAME_SITE` | sesión | No | política SameSite | `lax`; admite `strict`/`none` |
| `COPERNICUS_CLIENT_ID` | servicio Copernicus | No, pero queda server-side | OAuth client ID | opcional junto al secret |
| `COPERNICUS_CLIENT_SECRET` | servicio/logger | Sí | OAuth client secret | opcional junto al ID |
| `NODE_EXTRA_CA_CERTS` | transporte Copernicus | No | ruta a CA adicional para TLS | opcional |
| `SMOKE_USERNAME` | cleanup administrativo | No por sí solo | usuario exacto a limpiar | sin default; debe cumplir prefijo seguro |
| `VITE_API_BASE_URL` | frontend al compilar | No | base pública de la API | vacío: rutas relativas `/api` |

En `NODE_ENV=production`, `cookieSecure=true`. `COOKIE_SAME_SITE=none` se rechaza fuera de producción. `CORS_ORIGINS` sólo acepta origins HTTP(S) sin path.

## 28. Inventario completo de API: 29 endpoints

### Health y autenticación

| Método y path | Auth | Body/query | Qué hace | DB/servicios |
|---|---:|---|---|---|
| `GET /api/health` | No | — | readiness histórico | `SELECT 1` |
| `GET /api/health/live` | No | — | confirma proceso vivo | ninguno |
| `GET /api/health/ready` | No | — | readiness; 503 si DB falla | `SELECT 1` |
| `POST /api/auth/register` | No | `{username,password}` | hash, crea cuenta/cookie; 201 | `usuarios`, bcrypt, JWT |
| `POST /api/auth/login` | No | `{username,password}` | verifica y crea cookie | `usuarios`, bcrypt, JWT |
| `POST /api/auth/logout` | No | — | expira cookie; 204 | ninguno |
| `GET /api/auth/me` | Sí | — | DTO de sesión/onboarding | `usuarios` vía middleware |

### Establecimiento y lotes

| Método y path | Auth | Body/query | Qué hace | DB/servicios |
|---|---:|---|---|---|
| `GET /api/establecimiento` | Sí | — | devuelve uno o `null` | `establecimientos` |
| `POST /api/establecimiento` | Sí | `{nombre,polygon}` | crea el único; 201 | `establecimientos`, geometría estructural |
| `PATCH /api/establecimiento` | Sí | nombre y/o polygon | actualiza; valida lotes contenidos | `establecimientos`, `lotes`, Turf |
| `GET /api/lotes` | Sí | — | lista no eliminados, activos e inactivos | `establecimientos`, `lotes` |
| `POST /api/lotes` | Sí | `{polygon,apodo?}` | valida, numera, crea y completa onboarding | `usuarios`, `establecimientos`, `lotes`, Turf, transacción |
| `PATCH /api/lotes/:id` | Sí | apodo/activo/polygon | edita lote propio no eliminado | `establecimientos`, `lotes`, Turf, transacción |
| `DELETE /api/lotes/:id` | Sí | — | soft delete; 204 | `establecimientos`, `lotes` |
| `GET /api/lotes/estado` | Sí | `incluirInactivos?` | estado batch derivado | 6 tablas de lotes/historial; servicio estado |

### Integraciones externas y persistencia histórica

| Método y path | Auth | Body/query | Qué hace | DB/servicios |
|---|---:|---|---|---|
| `GET /api/copernicus/estado` | Sí | — | `{configurado}` | servicio Copernicus/env |
| `POST /api/lotes/satelite/actualizar` | Sí | `{loteIds}` (1–100) | analiza/persiste batch | lotes, Copernicus, mediciones |
| `POST /api/lotes/:id/satelite/actualizar` | Sí | sin body requerido | analiza/persiste uno | lotes, Copernicus, mediciones |
| `POST /api/lotes/clima/actualizar` | Sí | `{loteIds,origen}` (1–100) | consulta/persiste batch | lotes, Open-Meteo, consultas/días |
| `POST /api/lotes/:id/clima/actualizar` | Sí | `{origen}` | consulta/persiste uno | lote, Open-Meteo, consultas/días |
| `GET /api/lotes/:id/mediciones-satelitales` | Sí | limit/offset/desde/hasta/fuente | historial paginado | mediciones satelitales |
| `GET /api/lotes/:id/clima` | Sí | limit/offset/desde/hasta | snapshots y días paginados | consultas/días clima |
| `POST /api/lotes/:id/usos` | Sí | `{fecha,origen?}` | registra uso no futuro; 201 | `usos_lote` |
| `GET /api/lotes/:id/usos` | Sí | limit/offset/desde/hasta | usos paginados | `usos_lote` |
| `GET /api/lotes/:id/estado` | Sí | — | estado derivado individual | lote, mediciones, clima/días, usos |
| `GET /api/lotes/:id/historial` | Sí | — | hasta 50 por colección | mediciones, clima/días, usos |

### Notificaciones

| Método y path | Auth | Body/query | Qué hace | DB/servicios |
|---|---:|---|---|---|
| `GET /api/notificaciones` | Sí | limit/offset/soloNoLeidas | items, total y no leídas global | `notificaciones` |
| `PATCH /api/notificaciones/leidas` | Sí | — | marca todas y cuenta | `notificaciones` |
| `PATCH /api/notificaciones/:id/leida` | Sí | — | marca una de forma idempotente | `notificaciones` |

No existen actualmente `POST /api/copernicus/statistics`, endpoints
`/condicion`, POST históricos de mediciones/clima, creación HTTP de
notificaciones ni DELETE de establecimiento.

## 29. Seis diagramas compactos de flujo

### A. Login

```text
AuthScreen.enviar
  → api/auth.login
  → pedir + Vite proxy
  → POST /api/auth/login
  → route auth: rate limit → controller auth: credenciales()
  → SELECT usuarios → bcrypt.compare
  → JWT(sub=user.id) → Set-Cookie HttpOnly
  → DTO user → App authenticated
```

### B. Creación de lote

```text
Leaflet polygon → RodeoApp.onLoteDrawn
  → validación UX → api/rodeo.crearLote
  → route lotes: auth → controller lotes: BEGIN
  → establecimiento FOR UPDATE
  → Turf contenido/solapamiento
  → MAX(numero)+1 → INSERT lote
  → completar onboarding → COMMIT
  → DTO lote → estado React + /auth/me
```

### C. Actualización satelital

```text
LotePage → POST /lotes/:id/satelite/actualizar
  → route satélite: auth → controller satélite: ownership + polygon DB
  → AnalizadorSatelital
       ├─ S2 45 d → evalscript óptico → stats/scoring
       └─ S1 20 d → evalscript radar → RVI
  → selección sin mezclar fuentes
  → transacción + upsert mediciones
  → resultado → recarga estado/historial
```

### D. Actualización clima

```text
React → POST /api/lotes/[IDs]/clima/actualizar {IDs/origen}
  → route clima: auth → controller clima: ownership + polígonos
  → centroides → una llamada Open-Meteo (sin transacción abierta)
  → por lote ok: BEGIN → lock lote → dedupe auto → consulta + días → COMMIT
  → resultado + metadata de persistencia → React
  → recarga estado/historial cuando corresponde
```

### E. Ficha de lote

```text
/lotes/:id → obtenerLotes → encontrar lote visible
  → Promise.all
       ├─ /estado
       ├─ /mediciones-satelitales?limit=20...
       ├─ /clima?limit=20...
       └─ /usos?limit=20...
  → routes lotes/historial: auth → controllers: ownership + consultas
  → PostgreSQL → tarjetas/tablas/paginadores
```

### F. Notificaciones

```text
Sidebar habilita useNotificaciones
  → GET /api/notificaciones
  → route notificaciones: auth → controller: 3 queries paralelas
  → items/total/noLeidas
  → PATCH una o todas
  → UPDATE read_at → estado React/badge
```

## 30. Inventario de `backend/src`: los 45 archivos

La estructura definitiva usa nombres completos para las carpetas internas que
antes eran abreviaturas y conserva los términos profesionales `routes`,
`controllers` y `services`:

```text
backend/src/
├── app.ts
├── server.ts
├── fechas.ts
├── geometria.ts
├── autenticacion/
│   ├── middleware.ts
│   ├── session.ts
│   └── types.ts
├── base-datos/
│   ├── pool.ts
│   └── schema-verifier.ts
├── configuracion/
│   ├── env.ts
│   └── parse-env.ts
├── controllers/
│   ├── auth.ts
│   ├── clima.ts
│   ├── copernicus.ts
│   ├── establecimiento.ts
│   ├── health.ts
│   ├── historial.ts
│   ├── lotes.ts
│   ├── notificaciones.ts
│   └── satelite.ts
├── copernicus/
│   ├── analizar.ts
│   ├── evalscript.ts
│   ├── scoring.ts
│   └── types.ts
├── http/
│   ├── async-handler.ts
│   ├── auth-rate-limit.ts
│   ├── errors.ts
│   ├── logger.ts
│   ├── query.ts
│   └── request-id.ts
├── routes/
│   ├── auth.ts
│   ├── clima.ts
│   ├── copernicus.ts
│   ├── establecimiento.ts
│   ├── health.ts
│   ├── historial.ts
│   ├── lotes.ts
│   ├── notificaciones.ts
│   └── satelite.ts
├── services/
│   ├── consultas-clima.ts
│   ├── copernicus.ts
│   ├── estado-lotes.ts
│   ├── mediciones-satelitales.ts
│   └── open-meteo.ts
└── types/
    └── express.d.ts
```

### Raíz, configuración y DB

#### `backend/src/app.ts`

- **Existe para:** construir/exportar la app Express sin escuchar un puerto.
- **Lo importan:** `server.ts` y tests de integración.
- **Importa:** env, helpers HTTP y los nueve routers.
- **Entrada/salida:** recibe requests vía Express; produce respuestas, 404 y errores JSON.
- **Conecta:** infraestructura HTTP con rutas.

#### `backend/src/server.ts`

- **Existe para:** ser el entrypoint del proceso HTTP.
- **Lo importa:** ningún módulo productivo; lo ejecutan `dev`/`start`.
- **Importa:** `app`, `env`, `pool`.
- **Funciones importantes:** `apagar()` y `finalizar()`.
- **Entrada/salida:** señales/requests; escucha puerto, emite logs y cierra recursos.

#### `backend/src/configuracion/env.ts`

- **Existe para:** cargar `.env` con `dotenv/config` una vez y exportar config validada.
- **Lo importan:** app, server, pool, sesión y logger.
- **Importa:** `parseEnv`.
- **Salida:** singleton `env`.

#### `backend/src/configuracion/parse-env.ts`

- **Existe para:** validar tipos, seguridad y defaults sin efectos de red.
- **Lo importan:** `env.ts` y tests unitarios.
- **Funciones:** `parseEnv()` y parsers internos de puerto, URL, CORS, proxy y SameSite.
- **Entrada/salida:** mapa de strings opcionales → `ConfiguracionEntorno` o error de arranque.

#### `backend/src/base-datos/pool.ts`

- **Existe para:** centralizar conexión PostgreSQL y parser `DATE`.
- **Lo importan:** middleware, controllers, servicios, servidor y scripts indirectamente.
- **Importa:** `pg` y `env`.
- **Salida:** singleton `pool`.

#### `backend/src/base-datos/schema-verifier.ts`

- **Existe para:** describir y validar el contrato estructural mínimo de PostgreSQL.
- **Lo importan:** `scripts/verify-schema.ts` y tests unitarios.
- **Comprueba:** ocho tablas, todas sus columnas/tipos/nullability, PK, FK, UNIQUE, CHECK e índices esenciales.
- **Salida:** snapshot seguro de catálogo y lista de diferencias; no lee filas de negocio ni secretos.

#### `backend/src/fechas.ts`

- **Existe para:** fechas calendario y frescura sin errores de timezone.
- **Lo importan:** query helper, historial, estado y tests.
- **Funciones:** `esFechaCalendario`, `diasEntreFechas`, `hoyCalendario`, `horasDesdeTimestamp`.
- **Entrada/salida:** strings/instantes → validación y diferencias numéricas.

#### `backend/src/geometria.ts`

- **Existe para:** reglas GeoJSON/Turf compartidas.
- **Lo importan:** controllers de establecimiento, lotes y satélite, además de tests.
- **Importa:** Turf y tipos GeoJSON.
- **Funciones:** `esPolygonFeature`, `estaContenido`, `seSuperpone`.
- **Entrada/salida:** valores/polígonos → type guard o booleano conservador.

#### `backend/src/types/express.d.ts`

- **Existe para:** ampliar globalmente `Express.Request`.
- **Lo consume:** TypeScript en todo handler.
- **Importa:** tipo `Usuario`.
- **Salida:** declara `req.usuario?` y `req.requestId?`; no genera JS útil.

### Autenticación

#### `backend/src/autenticacion/types.ts`

- **Existe para:** tipos públicos de usuario y payload mínimo.
- **Lo importan:** sesión y augmentación de Express.
- **Salida:** `Usuario` y `JwtPayload { sub }`.

#### `backend/src/autenticacion/session.ts`

- **Existe para:** JWT y serialización de la cookie.
- **Lo importan:** controller auth y middleware.
- **Importa:** jsonwebtoken, env y tipos Express.
- **Funciones:** `crearToken`, `leerToken`, `verificarToken`, `guardarCookie`, `limpiarCookie`.
- **Entrada/salida:** userId/request/response ↔ token/cabecera `Set-Cookie`.

#### `backend/src/autenticacion/middleware.ts`

- **Existe para:** resolver sesión y usuario DB antes de rutas privadas.
- **Lo importan:** todos los routers privados y `/auth/me`.
- **Importa:** pool, `ApiError`, helpers de sesión.
- **Salida:** `req.usuario` o error 401; llama `next()`.

### Helpers HTTP

#### `backend/src/http/async-handler.ts`

- **Existe para:** pasar rechazos async a Express 4.
- **Lo importan:** routers con handlers async.
- **Función:** `asyncHandler(handler)`.
- **Entrada/salida:** `RequestHandler` → wrapper que llama `next(error)`.

#### `backend/src/http/auth-rate-limit.ts`

- **Existe para:** limitar registro/login compartiendo `MemoryStore`.
- **Lo importa:** ruta auth y tests.
- **Importa:** `express-rate-limit`.
- **Salidas:** `authRateLimiter`; `reiniciarRateLimitAuth()` para aislamiento de tests.

#### `backend/src/http/errors.ts`

- **Existe para:** contrato uniforme de errores.
- **Lo importan:** app, controllers, middleware, servicios y helpers.
- **Funciones/clases:** `ApiError`, `errorResponse`.
- **Entrada/salida:** error desconocido → status + body seguro.

#### `backend/src/http/logger.ts`

- **Existe para:** registrar fallos estructurados sin secretos.
- **Lo importa:** app.
- **Importa:** tipos Express y env.
- **Función:** `registrarError(req,status,error)`; escribe JSON en stderr.

#### `backend/src/http/query.ts`

- **Existe para:** validar paginación, booleanos y fechas de query.
- **Lo importan:** controllers de historial/notificaciones y tests.
- **Funciones:** `leerPaginacion`, `leerBooleano`, `leerRangoCalendario`.
- **Entrada/salida:** `req.query` → objetos tipados o `ApiError 400`.

#### `backend/src/http/request-id.ts`

- **Existe para:** correlación request/respuesta/log.
- **Lo importa:** app y tests.
- **Importa:** `randomUUID`.
- **Salidas:** constante de header, validador y middleware `asignarRequestId`.

### Dominio Copernicus

#### `backend/src/copernicus/types.ts`

- **Existe para:** DTOs de estadísticas, condición y resultado discriminado.
- **Lo importan:** analizador, scoring, persistencia y controller satélite.
- **Salida:** tipos como `ResultadoLote`, `CondicionLote`, `CondicionRadar` y `LoteSatelital`.

#### `backend/src/copernicus/evalscript.ts`

- **Existe para:** contener los scripts enviados a Statistical API.
- **Lo importa:** analizador.
- **Salidas:** `EVALSCRIPT_INDICES` y `EVALSCRIPT_RADAR`.

#### `backend/src/copernicus/scoring.ts`

- **Existe para:** score/categorías/alertas ópticas provisionales.
- **Lo importa:** analizador y tests.
- **Funciones:** `calcularPuntaje`, `categorizar`, `generarAlertas`.
- **Entrada/salida:** estadísticas ópticas → número, categoría y textos.

#### `backend/src/copernicus/analizar.ts`

- **Existe para:** armar requests, interpretar stats, seleccionar S2/S1 y controlar concurrencia.
- **Lo importa:** controller satélite y tests.
- **Importa:** servicio Copernicus, evalscripts, scoring, errores y tipos.
- **Funciones/clase:** bodies, `aObservacion`, `aObservacionRadar`, `AnalizadorSatelital`, singleton.
- **Entrada/salida:** lotes + referencia temporal → `ResultadoLote[]`.

### Servicios

#### `backend/src/services/copernicus.ts`

- **Existe para:** transporte HTTPS, OAuth, cache, retry y TLS de CDSE.
- **Lo importa:** analizador y tests.
- **Importa:** módulos Node HTTPS/TLS/FS/path y `ApiError`.
- **Clase:** `CopernicusClient`; singleton `copernicus`.
- **Entrada/salida:** body Statistical → status/texto; puede lanzar errores internos 502/503 que el analizador transforma en resultado por lote.

#### `backend/src/services/mediciones-satelitales.ts`

- **Existe para:** mapear resultados a filas y hacer upsert/transacción.
- **Lo importa:** controller de satélite.
- **Importa:** pool y tipos satelitales.
- **Funciones:** `guardarMedicionSatelital`, `medicionesDesdeResultado`, `persistirResultadoSatelital`.
- **Entrada/salida:** resultado o payload validado → fila retornada/efecto persistente.

#### `backend/src/services/consultas-clima.ts`

- **Existe para:** persistir un resultado real de Open-Meteo con sus días.
- **Lo importa:** controller clima.
- **Importa:** pool, errores y tipos de Open-Meteo.
- **Función:** `persistirConsultaClima`; lock por lote, dedupe automático y transacción por snapshot.

#### `backend/src/services/open-meteo.ts`

- **Existe para:** centroides, request multi-coordinate e interpretación climática.
- **Lo importa:** controller clima y tests.
- **Importa:** Turf y GeoJSON.
- **Clase:** `OpenMeteoClient`; `reemplazarTransporte` habilita tests; singleton `openMeteo`.
- **Entrada/salida:** lotes con polygon + reloj servidor → mapa `loteId → ResultadoClimaLote`; faltantes permanecen `null`.

#### `backend/src/services/estado-lotes.ts`

- **Existe para:** estado objetivo individual/batch sin N+1.
- **Lo importan:** controllers de lotes e historial.
- **Importa:** pool y helpers de fecha.
- **Función:** `obtenerEstadosDeLotes(loteIds, referencia?)`.
- **Entrada/salida:** IDs visibles → `EstadoLote[]` derivado.

### Controllers

Los nueve controllers reflejan uno a uno los nueve routers. Son funciones de Express, no clases: conservan exactamente la validación, SQL, transacciones, llamadas a servicios y respuestas que antes estaban dentro de cada archivo de rutas.

#### `backend/src/controllers/health.ts`

- **Existe para:** ejecutar liveness/readiness y responder sin exponer detalles de DB.
- **Lo importa:** route health.
- **Importa:** pool y tipos Express.
- **Funciones:** `liveness`, `readiness`.

#### `backend/src/controllers/auth.ts`

- **Existe para:** registro, login, logout y consulta de sesión.
- **Lo importa:** route auth.
- **Importa:** bcrypt, pool, sesión y errores.
- **Funciones:** `registrar`, `iniciarSesion`, `cerrarSesion`, `obtenerSesion`.

#### `backend/src/controllers/establecimiento.ts`

- **Existe para:** obtener, crear y editar el único establecimiento del usuario.
- **Lo importa:** route establecimiento.
- **Importa:** pool, geometría y errores.
- **Funciones:** `obtenerEstablecimiento`, `crearEstablecimiento`, `actualizarEstablecimiento`.

#### `backend/src/controllers/lotes.ts`

- **Existe para:** listado, creación, edición, soft delete y estado batch.
- **Lo importa:** route lotes.
- **Importa:** pool, geometría, estado de lotes y errores.
- **Funciones:** `obtenerEstadoLotes`, `obtenerLotes`, `crearLote`, `actualizarLote`, `eliminarLote`; conserva las transacciones y locks existentes.

#### `backend/src/controllers/satelite.ts`

- **Existe para:** coordinar actualización satelital individual y batch segura.
- **Lo importa:** route satélite.
- **Importa:** pool, geometría, analizador, tipos y persistencia satelital.
- **Funciones:** `actualizarSateliteLotes`, `actualizarSateliteLote`; no acepta geometrías ni evalscripts del browser.

#### `backend/src/controllers/copernicus.ts`

- **Existe para:** responder el estado opcional de configuración de Copernicus.
- **Lo importa:** route Copernicus.
- **Importa:** servicio Copernicus.
- **Función:** `obtenerEstadoCopernicus`.

#### `backend/src/controllers/clima.ts`

- **Existe para:** validar ownership y coordinar consulta + persistencia de Open-Meteo.
- **Lo importa:** route clima.
- **Importa:** pool, geometría, logger, errores y servicios Open-Meteo/clima.
- **Funciones:** `actualizarClimaLote`, `actualizarClimaLotes`.

#### `backend/src/controllers/historial.ts`

- **Existe para:** listados de satélite/clima, escritura de usos, estado e historial consolidados.
- **Lo importa:** route historial.
- **Importa:** pool, fechas/query, estado y errores.
- **Funciones:** seis handlers públicos; conserva ownership y paginación.

#### `backend/src/controllers/notificaciones.ts`

- **Existe para:** listar y marcar notificaciones del usuario.
- **Lo importa:** route notificaciones.
- **Importa:** pool, query params y errores.
- **Funciones:** `obtenerNotificaciones`, `marcarTodasLeidas`, `marcarNotificacionLeida`.

### Routers

Cada router queda como catálogo declarativo: crea su `Router`, aplica el mismo middleware en el mismo lugar y conecta método/path con un controller. No contiene SQL ni lógica de negocio.

#### `backend/src/routes/health.ts`

- **Existe para:** liveness/readiness pública.
- **Lo importa:** app.
- **Importa:** Router y controller health.
- **Salida:** `healthRouter` con sus tres paths públicos en el orden original.

#### `backend/src/routes/auth.ts`

- **Existe para:** register/login/logout/me.
- **Lo importa:** app.
- **Importa:** controller auth, auth middleware, rate limit y `asyncHandler`.
- **Cableado:** conserva rate limit sólo en register/login y autenticación sólo en `/me`.

#### `backend/src/routes/establecimiento.ts`

- **Existe para:** GET/POST/PATCH del único establecimiento.
- **Lo importa:** app.
- **Importa:** controller establecimiento, auth y `asyncHandler`.
- **Cableado:** autenticación para todo el router y los tres endpoints originales.

#### `backend/src/routes/lotes.ts`

- **Existe para:** listado, creación, edición, soft delete y estado batch.
- **Lo importa:** app.
- **Importa:** controller lotes, auth y `asyncHandler`.
- **Cableado:** mantiene `/estado` antes de `/:id` y los cinco endpoints originales.

#### `backend/src/routes/satelite.ts`

- **Existe para:** actualización satelital individual y batch segura.
- **Lo importa:** app bajo `/api/lotes`.
- **Importa:** controller satélite, auth y `asyncHandler`.
- **Cableado:** mantiene batch antes del path individual.

#### `backend/src/routes/copernicus.ts`

- **Existe para:** exponer sólo estado de configuración.
- **Lo importa:** app.
- **Importa:** controller Copernicus y auth.
- **Cableado:** `GET /estado` autenticado.

#### `backend/src/routes/clima.ts`

- **Existe para:** actualización climática individual/batch autenticada.
- **Lo importa:** app.
- **Importa:** controller clima, auth y `asyncHandler`.
- **Cableado:** `POST /clima/actualizar` y `POST /:id/clima/actualizar` bajo `/api/lotes`.

#### `backend/src/routes/historial.ts`

- **Existe para:** lecturas satélite/clima, usos, estado individual e historial compatible.
- **Lo importa:** app bajo `/api/lotes`.
- **Importa:** controller historial, auth y `asyncHandler`.
- **Cableado:** seis endpoints; los POST históricos de satélite/clima no existen.

#### `backend/src/routes/notificaciones.ts`

- **Existe para:** listar y marcar notificaciones del usuario.
- **Lo importa:** app.
- **Importa:** controller notificaciones, auth y `asyncHandler`.
- **Cableado:** mantiene `/leidas` antes de `/:id/leida`.

## 31. Diez conceptos imprescindibles

1. **Flujo completo:** React hace HTTP; Express coordina; PostgreSQL o un servicio externo responde; React actualiza estado.
2. **`app` no es `server`:** la primera configura Express y el segundo abre/cierra el proceso HTTP.
3. **Autenticación:** bcrypt protege hashes; JWT identifica sesión; cookie HttpOnly lo transporta.
4. **Autorización/ownership:** estar autenticado no alcanza; cada query debe limitarse al usuario de `req.usuario`.
5. **Persistencia relacional:** PK, FK, UNIQUE e índices mantienen identidad, relaciones y rendimiento.
6. **Transacciones:** operaciones que deben ser atómicas usan una misma conexión con BEGIN/COMMIT/ROLLBACK.
7. **Geometría e historial:** GeoJSON se guarda en JSONB, Turf valida y soft delete conserva relaciones/números.
8. **Fuentes reales:** S1, S2 y Open-Meteo son distintas; no se inventan equivalencias ni un modelo final.
9. **Estado derivado:** no hay tabla `estado` ni `descanso`; se calculan desde los históricos más recientes.
10. **Fronteras de entorno:** proxy/CORS/cookies conectan frontend-backend; tests y variables separan producción de prueba.

## 32. Qué necesito saber para el oral

### NIVEL 1 — Imprescindible

Deberías poder explicar sin mirar:

- qué problema resuelve el backend y por qué el browser no habla directo con la DB;
- el recorrido de login y de creación de lote;
- diferencia entre autenticación y ownership;
- qué guardan las ocho tablas y sus relaciones principales;
- qué es soft delete y por qué se usa;
- diferencia entre Sentinel-1, Sentinel-2 y Open-Meteo;
- que scoring satelital es provisional, no IA ni recomendación final;
- qué es una transacción;
- cómo React envía cookie con `credentials: "include"`;
- por qué Neon es PostgreSQL alojado, no un reemplazo de PostgreSQL.

### NIVEL 2 — Bueno saber

- `app.ts` versus `server.ts`;
- middleware, route, service y helper;
- SQL parametrizado, pool e índices;
- DATE versus TIMESTAMPTZ;
- dedupe climático automático atómico por lock y `created_at` de una hora;
- upsert satelital por lote/fuente/fecha;
- cómo `DISTINCT ON` y queries batch evitan N+1;
- Vite proxy, CORS, SameSite y Secure;
- unitarios versus integración con Supertest/DB real;
- liveness, readiness y graceful shutdown.

### NIVEL 3 — Muy técnico / no necesario memorizar

- OID 1082 del parser de `pg`;
- regex exacta de request ID/UUID;
- todos los códigos SCL excluidos;
- fórmulas y umbrales exactos del scoring;
- construcción de la cadena CA TLS;
- valores exactos de timeouts del servidor/pool;
- orden exacto de desempate por IDs;
- implementación interna del worker de concurrencia;
- forma exacta de cada columna estadística;
- detalles de los mocks de transporte en Vitest.

## 33. Preguntas posibles de profesor y respuestas breves

1. **¿Qué hace el backend de RODEO?** Autentica usuarios, protege datos por ownership, persiste establecimiento/lotes/históricos, consulta Copernicus/Open-Meteo y expone JSON al frontend.
2. **¿Qué es un endpoint?** Una combinación de método HTTP y path que representa una operación, por ejemplo `POST /api/lotes`.
3. **¿Por qué el frontend no conecta directo a PostgreSQL?** Expondría credenciales y permitiría saltar validaciones y ownership.
4. **¿Qué papel cumple Express?** Recibe HTTP, ejecuta middleware/routes y devuelve status, headers y JSON.
5. **¿Qué diferencia hay entre `app.ts` y `server.ts`?** `app.ts` arma Express; `server.ts` escucha el puerto y gestiona el proceso.
6. **¿Qué es middleware?** Código que corre antes/después de una ruta; auth carga `req.usuario`.
7. **¿Qué es una route?** El handler ligado a un método/path y a su validación HTTP.
8. **¿Qué es un service?** Una unidad reutilizable para integración o lógica, como `OpenMeteoClient`.
9. **¿Por qué no guardar passwords?** Una filtración revelaría claves reutilizables; se guarda un hash bcrypt no reversible.
10. **¿Qué hace bcrypt?** Aplica un hash lento con salt; RODEO usa cost 12.
11. **¿Qué es JWT?** Un token firmado con claims; RODEO usa `sub` para el UUID y 7 días de expiración.
12. **¿Por qué usar una cookie HttpOnly?** El navegador la envía, pero JavaScript no puede leerla directamente.
13. **¿El JWT está cifrado?** No; está firmado. No se deben poner secretos en su payload.
14. **¿Qué hace logout?** Expira la cookie en el navegador; no existe revocación server-side.
15. **¿Qué hace `/auth/me`?** Verifica sesión y devuelve el DTO público actual del usuario.
16. **¿Autenticación y autorización son iguales?** No. Autenticación identifica; autorización decide si ese usuario puede acceder a ese lote.
17. **¿Qué pasa si dos usuarios conocen el mismo ID de lote?** Las queries unen con establecimiento y filtran `user_id`; el ajeno recibe el mismo 404 que uno inexistente.
18. **¿Qué es SQL parametrizado?** SQL y valores viajan separados en `$1`, `$2`; reduce inyección.
19. **¿Qué es un pool?** Un conjunto reutilizable de conexiones; RODEO limita a 10.
20. **¿Por qué usar transacciones?** Para que un grupo de cambios ocurra completo o no ocurra.
21. **¿Dónde usa RODEO transacciones?** Lotes, snapshots clima y persistencia satelital por lote.
22. **¿Qué es una foreign key?** Una regla que exige que la fila relacionada exista.
23. **¿Qué es un índice?** Una estructura que acelera búsquedas/ordenamientos a cambio de espacio y costo al escribir.
24. **¿Qué es UNIQUE?** Un constraint que impide combinaciones repetidas, como username o lote/fuente/fecha.
25. **¿Por qué UUID?** Da identificadores globalmente difíciles de predecir; no reemplaza autorización.
26. **¿Por qué JSONB para polygon?** Mantiene el GeoJSON del mapa sin agregar PostGIS todavía.
27. **¿Qué valida la geometría?** Estructura Polygon, contención con Turf y solapamiento mayor a 1 m².
28. **¿Qué es soft delete?** Marcar `deleted_at` en vez de borrar la fila.
29. **¿Por qué no reutilizar números de lote?** Evita confundir el historial de un lote eliminado con otro nuevo.
30. **¿Qué es Neon?** El proveedor donde corre PostgreSQL; no es un motor diferente.
31. **¿Qué es una migración?** SQL versionado que crea/evoluciona la estructura de DB.
32. **¿Cuántas tablas hay?** Ocho.
33. **¿Hay una tabla `estado`?** No; se deriva de las filas más recientes.
34. **¿Cómo se calcula descanso?** Días calendario desde el último uso registrado.
35. **¿Qué diferencia hay entre DATE y TIMESTAMPTZ?** DATE es calendario sin hora; TIMESTAMPTZ representa un instante.
36. **¿Qué es Copernicus en el sistema?** La plataforma externa para estadísticas satelitales S1/S2.
37. **¿Diferencia entre Sentinel-1 y Sentinel-2?** S1 es radar/RVI; S2 es óptico/NDVI-NDMI-NDWI-EVI.
38. **¿Qué pasa si Copernicus falla?** El endpoint devuelve resultado/error controlado; `error`/`sin-datos` no persisten mediciones.
39. **¿Copernicus es obligatorio para levantar la app?** No; sólo la actualización queda no disponible sin ambas credenciales.
40. **¿Qué es un evalscript?** Código que Copernicus ejecuta por píxel para generar las bandas estadísticas pedidas.
41. **¿El puntaje es IA?** No. Es una fórmula provisional explícita y no calibrada como recomendador final.
42. **¿Por qué no mezclar radar y óptica?** Miden fenómenos distintos y no hay calibración cruzada implementada.
43. **¿Cómo se elige fallback radar?** Sólo si el radar válido es estrictamente más reciente o no hay óptica válida.
44. **¿Por qué el clima usa centroide?** Open-Meteo recibe puntos; el lote está guardado como polígono.
45. **¿Cómo evita una llamada de clima por lote?** Envía listas de coordenadas en una única request multi-coordinate.
46. **¿Consultar clima ya lo persiste?** Sí. El mismo endpoint backend consulta Open-Meteo y persiste cada resultado válido.
47. **¿Qué diferencia hay entre consulta manual y automática?** La manual siempre puede crear snapshot; la automática se omite si ya se persistió otra automática en la última hora.
48. **¿Qué es paginación?** Pedir una porción con limit/offset y recibir total/hayMas.
49. **¿Cómo evitan N+1 en estado?** Consultan lo último para todos los IDs con queries agrupadas y mapas en memoria.
50. **¿Qué es el proxy de Vite?** Reenvía `/api` de localhost:5173 al backend 3001 durante desarrollo.
51. **¿Qué es CORS?** La política que decide qué origins del browser pueden leer respuestas cross-origin.
52. **¿Por qué no usar `*` con cookies?** Las credenciales requieren un origin explícito y una política acotada.
53. **¿Qué hace Helmet?** Agrega headers de seguridad; CSP/CORP están desactivados aquí por compatibilidad.
54. **¿Qué hace el rate limit?** Limita login/registro a 15 intentos por IP cada 15 minutos en esa instancia.
55. **¿Qué diferencia hay entre `/live` y `/ready`?** Live verifica proceso; ready también consulta PostgreSQL.
56. **¿Qué es graceful shutdown?** Dejar de aceptar requests y cerrar servidor/pool ordenadamente ante señales.
57. **¿Unit test e integration test son iguales?** No; unitario aísla lógica, integración atraviesa Express y PostgreSQL real.
58. **¿Por qué `TEST_DATABASE_URL` no puede caer a producción?** Los tests truncan tablas; un fallback podría destruir datos reales.
59. **¿Qué hace CI?** Instala y valida types/build/unitarios en push/PR.
60. **¿CI despliega la aplicación?** No. El workflow actual sólo valida.

## 34. Glosario sencillo

- **API:** contrato para que programas se comuniquen.
- **Backend:** código server-side que aplica reglas, integra servicios y persiste.
- **Frontend:** aplicación React ejecutada en el navegador.
- **Endpoint:** método + path de una operación HTTP.
- **HTTP:** protocolo de requests/responses usado entre browser y Express.
- **JSON:** formato de datos de bodies y respuestas.
- **Express:** framework HTTP del backend.
- **App Express:** configuración de middleware y rutas, sin implicar puerto abierto.
- **Router:** catálogo modular que conecta método/path, middleware y controller.
- **Controller:** handler HTTP que valida la request, coordina DB/servicios y construye la respuesta.
- **Middleware:** función intermedia que procesa `req/res/next`.
- **Route param:** parte variable del path, como `:id`.
- **Query param:** opción en la URL, como `?limit=20`.
- **Body:** datos enviados dentro de una request.
- **Status code:** número HTTP que resume el resultado.
- **Service:** módulo que encapsula una operación/integración reutilizable.
- **DTO:** forma de datos expuesta entre capas, distinta de una fila interna.
- **SQL:** lenguaje para consultar/modificar la DB.
- **PostgreSQL:** motor relacional usado por RODEO.
- **Neon:** servicio que aloja el PostgreSQL actual.
- **Pool:** grupo reutilizable de conexiones DB.
- **Row:** fila devuelta o guardada en una tabla.
- **Primary key (PK):** identificador único de una fila.
- **Foreign key (FK):** relación obligatoria con otra fila.
- **UNIQUE:** restricción de no repetición.
- **Index:** estructura que acelera consultas.
- **UUID:** identificador de 128 bits representado como texto.
- **JSONB:** tipo binario JSON de PostgreSQL.
- **DATE:** fecha calendario sin hora.
- **TIMESTAMPTZ:** instante con semántica de zona horaria.
- **Transaction:** bloque atómico BEGIN/COMMIT/ROLLBACK.
- **Migration:** cambio versionado de estructura DB.
- **Hash:** resultado no reversible usado para verificar una clave.
- **bcrypt:** función lenta de hash de passwords.
- **JWT:** token firmado con claims y expiración.
- **Cookie:** dato que el browser guarda y envía al servidor.
- **HttpOnly:** atributo que impide lectura de cookie desde JavaScript.
- **SameSite:** regla sobre envío cross-site de una cookie.
- **Secure:** cookie enviada sólo por HTTPS.
- **Ownership:** pertenencia de un recurso al usuario autenticado.
- **CORS:** allowlist de origins para browsers.
- **Origin:** esquema + host + puerto.
- **Proxy:** intermediario que reenvía requests.
- **Rate limit:** límite temporal de requests.
- **Request ID:** identificador de correlación HTTP/log.
- **Liveness:** proceso vivo.
- **Readiness:** proceso listo con dependencias esenciales.
- **Soft delete:** baja lógica mediante timestamp.
- **GeoJSON:** JSON estándar de geometrías.
- **Turf:** biblioteca de operaciones geográficas usada por frontend/backend.
- **Upsert:** insertar o actualizar ante conflicto de unicidad.
- **N+1:** patrón ineficiente de una query inicial más una por cada item.
- **OAuth client credentials:** flujo server-to-server para token Copernicus.
- **Statistical API:** API que agrega estadísticas satelitales por geometría/tiempo.
- **Evalscript:** transformación por píxel ejecutada en Sentinel Hub.
- **CI:** validación automatizada de cambios.
- **Deploy:** publicación/ejecución en un entorno accesible.

## 35. Implementado hoy versus planificado

### IMPLEMENTADO HOY

- React/Vite, router, mapa Leaflet/Turf y onboarding dentro de `RodeoApp`;
- auth username/password, bcrypt, JWT/cookie y sesión persistente;
- un establecimiento por usuario, lotes, edición, actividad y soft delete;
- PostgreSQL/Neon como fuente de establecimiento/lotes; sin fallback `localStorage`;
- históricos S1/S2, clima y usos;
- Copernicus centralizado en backend y separado por fuente;
- Open-Meteo centralizado como actualización backend-owned multi-coordinate;
- persistencia climática en la misma operación, con origen, nulls reales y dedupe atómico;
- estado individual/batch derivado y ficha paginada;
- notificaciones de lectura/marcado y UI base;
- CORS, cookies configurables, Helmet, body limit, rate limit, request ID, logs, health y shutdown;
- 29 endpoints, 8 tablas, 47 unitarios/51 integraciones declarados y CI de validación.

### PLANIFICADO / PENDIENTE

- proveedor, dominios, CORS/cookies finales y automatización de deploy;
- Google OAuth;
- reglas automáticas, tipos finales y deduplicación de notificaciones;
- calibración agronómica real del scoring;
- política de restauración/archivo de lotes e historial de geometrías;
- semántica segura para eliminar establecimiento;
- store distribuido de rate limit si hay múltiples instancias;

### FUERA DE ALCANCE ACTUAL / NO IMPLEMENTADO

- IA o machine learning;
- recomendador/ranking final de lotes;
- animales/ganado;
- GPS, dispositivos y posiciones;
- jornadas de pastoreo;
- planes multi-día;
- roles/membresías y múltiples establecimientos.

## 36. Mapa humano de dependencias: si modifico X

| Si modifico... | Probablemente debo revisar... | Motivo |
|---|---|---|
| Auth/cookie | `autenticacion/*`, route/controller auth, `App`, API client, CORS/SameSite, tests | sesión cruza browser, middleware y DB |
| `usuarios`/onboarding | migración, auth DTO, middleware, creación de lote, `RodeoApp` | el estado se calcula en varios puntos |
| Schema DB | migraciones, queries, DTOs, fixtures, cleanup/verify scripts | código y estructura deben coincidir |
| Geometría | `geometria.ts`, controllers establecimiento/lotes, `geo.ts`, MapEngine y tests | hay validación UX y autoridad backend |
| Lotes | API rodeo, `RodeoApp`, ficha, satélite/clima/estado, ownership | es entidad central de casi todo historial |
| Soft delete | todas las queries de lote/historial/estado | olvidar `deleted_at IS NULL` puede reexponer datos |
| Satélite | analyzer, evalscripts, scoring, servicio CDSE, persistencia, DTO frontend/tests | pipeline completo y dos fuentes físicas |
| Clima | controller, Open-Meteo, persistencia transaccional, fachada frontend, estado/ficha/tests | consulta y guardado son una operación |
| Estado | servicio `estado-lotes`, endpoints individual/batch, tipos/ficha | no hay tabla que aisle el cambio |
| Historial/paginación | `http/query`, route/controller historial, `api/historial`, LotePage | filtros y metadata son contrato compartido |
| Notificaciones | tabla, route/controller, API, hook, Sidebar y tests | conteo global y página deben permanecer coherentes |
| API client | todas las fachadas frontend, auth cookie y deployments separados | es el punto único de URL/credentials/error |
| CORS/proxy | `app.ts`, env, Vite, `VITE_API_BASE_URL`, cookies | cambia cómo llega el browser a Express |
| Tests DB | `TEST_DATABASE_URL`, helpers, migraciones y CI | la limpieza es destructiva en la base indicada |

## 37. Segunda pasada: diferencias entre documentación y código

La etapa de persistencia corrigió el doble request climático, los POST históricos
controlados por cliente, los nulls convertidos a cero, la fecha futura, el
cleanup incompleto y el dedupe concurrente. Permanecen estos riesgos/deudas:

1. **Pantalla de onboarding:** algunos textos históricos nombran `SetupPendingScreen`; el flujo vigente ocurre dentro de `RodeoApp`.
2. **Estado de sesión:** documentos históricos aún contienen decisiones previas, aunque el código fija JWT HttpOnly por 7 días y password mínimo 8.
3. **“Cada observación recuperada”:** el analyzer usa varias fechas para elegir/tendencia, pero persiste sólo la última observación relevante S2/S1 de cada actualización.
4. **Ficha:** `LotePage` usa estado + tres listados paginados; `LoteDetallePanel` y el endpoint consolidado de historial no son su camino principal.
5. **Terminología de recomendación:** `CondicionPanel` todavía usa una etiqueta visual “Recomendado”, aunque no existe recomendador final.
6. **Validación GeoJSON:** es estructural y usa Turf, pero no valida explícitamente toda topología/rangos.
7. **Ledger de migraciones:** los archivos son forward e idempotentes, pero no hay tabla de versiones; `migrate.ts` los recorre todos.
8. **CI versus suite completa:** las 51 integraciones requieren una DB externa aislada; no corren en el workflow sin ese servicio/secreto.
9. **Concurrencia geométrica:** no hay constraint espacial DB; operaciones geométricas concurrentes distintas merecen una etapa específica.
10. **Status de Copernicus:** indisponibilidad por lote se representa dentro de un HTTP 200 con `resultado.estado="error"`; el monitoreo debe mirar el body.
11. **Despliegue:** proveedor, dominios, CORS/cookies finales y store distribuido de rate limit siguen pendientes.

### Verificación final del inventario

- Archivos `backend/src` inventariados: 45 de 45.
- Endpoints contados desde declaraciones reales de routers: 29.
- Tablas contadas desde migraciones: 8.
- Routers montados en `app.ts`: 9.
- Controllers conectados desde esos routers: 9.
- Flujos pedidos seguidos de punta a punta: 5.
- Diagramas compactos pedidos: 6.
- Preguntas de oral: 60.

Este documento describe el presente. Si cambia código, schema o contrato, debe actualizarse siguiendo nuevamente las llamadas reales; no alcanza con cambiar un roadmap.
