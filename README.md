# RODEO

Este repositorio contiene el frontend React/Vite existente y el backend real
Node.js/Express/PostgreSQL. El backend ya incluye autenticación, sesiones por
cookie HttpOnly y APIs privadas de establecimiento y lotes. El texto histórico
del frontend que aparece más abajo conserva contexto de la arquitectura
original, pero el backend ya no está fuera de alcance.

Front de gestión de establecimiento y lotes para ganadería, con condición de
pastoreo (satelital) y clima por lote. Es un proyecto grupal: este repo es
El backend de este mismo repositorio ya es la base oficial de persistencia y
autenticación; GPS y ganado continúan fuera de alcance.

Este documento existe para que quien retome el proyecto —humano o asistente
de IA, en otra máquina, sin el historial de chat previo— entienda el estado
real, las decisiones ya tomadas y **por qué**, sin tener que redescubrirlas.

## Estado actual (qué hace hoy)

- Dibujás el límite de un establecimiento y sus lotes sobre un mapa (Leaflet).
- Por cada lote activo, "Analizar" trae la condición de pastoreo real desde
  Sentinel-2/Sentinel-1 (Copernicus), con puntaje 0–100, alertas y un
  gráfico de tendencia de los últimos días despejados.
- Por cada lote activo, el clima (Open-Meteo) muestra lluvia de los últimos
  7 días + pronóstico a 5, con una etiqueta corta (Seco / Normal / Lluvia en
  camino / Piso pesado).
- Todo dato mostrado es real — nunca simulado ni inventado. Ver "Principio
  rector" más abajo; es la regla de diseño más importante del proyecto.
- El sidebar tiene 4 pestañas: Establecimiento, Lotes, Clima, Condición.

## Para volver a levantarlo

```bash
npm install          # reinstala node_modules (no viene en esta copia)
npm run certs        # sólo en Windows con red corporativa (ver abajo)
npm run dev
```

Copernicus es opcional para levantar RODEO. Si querés usar el análisis
satelital, creá `backend/.env` a partir de `backend/.env.example` y completá
`COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET` con credenciales de
https://dataspace.copernicus.eu. No uses prefijo `VITE_`: esas variables las
lee únicamente el backend Express.

El clima (Open-Meteo) no necesita ninguna credencial ni configuración.

## Estado real de cierre de etapa

### IMPLEMENTADO

- Frontend React/Vite con mapa Leaflet, dibujo actual, Turf, Copernicus Sentinel-1/Sentinel-2 y Open-Meteo.
- Backend Node.js + TypeScript + Express con PostgreSQL real en Neon.
- `GET /api/health`.
- Registro, login, logout y `GET /api/auth/me`, con bcrypt, JWT en cookie HttpOnly y sesión persistente.
- APIs privadas de establecimiento y lotes, validaciones geométricas, lotes contenidos, no solapamiento, soft delete, numeración histórica no reutilizable y `onboarding_completed_at` irreversible.
- Frontend conectado a autenticación real: loading inicial, login, registro, usuario visible, logout y separación `App`/`RodeoApp` para conservar el orden de hooks del mapa.
- Proxy Vite para el backend.
- Configuración de producción validada al arrancar, CORS explícito, cookies configurables, Helmet, límite de body, rate limit de auth, request IDs y logs estructurados.
- Health checks separados (`/api/health/live` y `/api/health/ready`), cierre ordenado del servidor y CI de frontend/backend en GitHub Actions.
- Configuración de Vercel Services same-origin con frontend Vite y backend Express mediante un entrypoint ESM dedicado.
- Copernicus es opcional para levantar RODEO. Sus credenciales se leen únicamente en Express desde `COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET`; sin ellas, estado responde `configurado:false` y una actualización devuelve indisponibilidad controlada. No se usa prefijo `VITE_`.
- El backend es dueño de la actualización satelital completa: obtiene lote/polígono desde PostgreSQL, construye las consultas S2/S1, interpreta, calcula el scoring provisional y persiste. El frontend sólo envía IDs y consume `ResultadoLote`.
- El backend también es dueño de la actualización climática: consulta Open-Meteo, preserva datos faltantes como `null`, persiste consulta+días y responde en una sola operación.
- `consultas_clima.origen` conserva `automatico`, `manual` o `legacy`; las automáticas se deduplican de forma transaccional por reloj del servidor.

### ESTADO TEMPORAL IMPORTANTE

La autenticación, el onboarding y los datos de establecimiento/lotes usan el
backend/PostgreSQL de Neon. No se consulta `localStorage` para esos datos.

### EN IMPLEMENTACIÓN / SIGUIENTE ETAPA

- reglas automÃ¡ticas que generen notificaciones;
- validar el redeploy en Vercel, elegir el dominio definitivo y fijar los valores finales de entorno/CORS/cookies, manteniendo el mapa actual.

### PENDIENTE Y FUERA DE ALCANCE

Google OAuth, reglas automáticas de notificaciones y automatización/validación final del deploy. Ganado, GPS, jornadas, recomendaciones y ML siguen fuera de alcance.

## Ficha completa de lote

## Actualización Copernicus actual

La integración completa de Copernicus vive en el backend Express. El flujo es
`frontend (IDs) -> proxy Vite -> backend:3001 -> PostgreSQL/Copernicus -> persistencia`.
Vite no ejecuta el cliente, evalscripts, parsing ni scoring satelital.

Las variables `COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET` son
opcionales y viven en `backend/.env`. No se usan prefijos `VITE_`. Los
endpoints autenticados son `GET /api/copernicus/estado`,
`POST /api/lotes/:id/satelite/actualizar` y
`POST /api/lotes/satelite/actualizar`. El antiguo endpoint raw
`POST /api/copernicus/statistics` fue retirado para impedir bodies arbitrarios
desde el navegador. Para usar Copernicus, copiá manualmente las
dos variables reales desde tu configuración local a `backend/.env` y
reiniciá backend y frontend. No edites ni compartas secretos.

La ficha real está disponible en `/lotes/:id`, también mediante deep link y
recarga directa. Se abre desde el mapa y los listados del sidebar, y consume
`GET /api/lotes/:id/estado` junto con los historiales paginados existentes.
Muestra Sentinel-2 y Sentinel-1 por separado, evolución NDVI, clima, descanso,
registro de uso e historial por pestañas. También permite actualizar satélite,
actualizar clima y registrar un uso sin modificar el mapa ni el modelo de datos.

## Actualización Open-Meteo actual

El navegador ya no llama a `api.open-meteo.com` ni reenvía valores
meteorológicos para guardarlos. `POST /api/lotes/:id/clima/actualizar` y
`POST /api/lotes/clima/actualizar` reciben IDs y origen; Express valida
pertenencia, obtiene los polígonos desde PostgreSQL, calcula centroides, hace
la consulta multi-coordenada, persiste sólo resultados válidos y devuelve los
`ResultadoClimaLote`.

## Notificaciones base

La API autenticada y el panel del Sidebar ya estÃ¡n implementados. Permiten
listar con paginaciÃ³n, mostrar el total global sin leer, marcar una o todas y
actualizar el badge sin recargar. No existe un endpoint pÃºblico de creaciÃ³n ni
reglas automÃ¡ticas: un usuario real sin datos ve correctamente "No tenÃ©s
notificaciones".

## Backend actual

El backend vive en `backend/` y usa Node.js, TypeScript, Express y PostgreSQL
mediante `pg`. Para configurarlo, copiá `backend/.env.example` como
`backend/.env` y completá `DATABASE_URL` localmente; ese archivo no se debe
versionar.

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

El health check queda disponible en `http://localhost:3001/api/health` y no
expone la cadena de conexión. Para verificar tipos o generar el build:

```bash
npm run typecheck
npm run build
```

### Configuración local y de producción

El frontend usa rutas `/api` relativas por defecto, por lo que el proxy de Vite
continúa funcionando en desarrollo. Si frontend y backend se despliegan en
orígenes distintos, `VITE_API_BASE_URL` define la URL pública del backend al
construir el frontend. No contiene secretos.

La configuración actual usa Vercel Services bajo un único origen, por lo que
no necesita `VITE_API_BASE_URL`: `vercel.json` dirige `/api` al servicio
Express y el resto al servicio Vite. `backend/src/vercel.mts` es el entrypoint
serverless ESM; `backend/src/server.ts` conserva el arranque local.

El backend valida al arrancar `NODE_ENV`, `PORT`, `DATABASE_URL`,
`AUTH_JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY` y `COOKIE_SAME_SITE`.
Copernicus sigue siendo opcional. Las plantillas completas están en
`.env.example` y `backend/.env.example`; la guía independiente de proveedor
está en [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Además de `/api/health`, existen `/api/health/live` (sin DB) y
`/api/health/ready` (con DB). Las respuestas incluyen `X-Request-Id`; el
backend aplica headers de seguridad, limita JSON a 1 MB y protege login y
registro con un rate limit conservador en memoria.

Las migraciones `001` y `002` crean las ocho tablas de dominio; `003` agrega el
origen climático y el índice parcial del dedupe automático. `npm run db:verify`
comprueba tablas, columnas/tipos, PK, FK, UNIQUE, CHECK e índices esenciales.
PostgreSQL ya es la fuente de establecimiento, lotes e historiales.

## Qué NO viene en esta copia (y cómo se recupera)

| Carpeta / archivo | Cómo vuelve |
|---|---|
| `node_modules/` | `npm install` |
| `certs/` | `npm run certs` |
| `dist/`, `.tsbuild/` | `npm run build` |
| `.env.local` | configuración pública opcional del frontend, por ejemplo `VITE_API_BASE_URL` (nunca secretos) |

## Sobre `npm run certs`

Si tu red hace inspección TLS (típico en redes corporativas), Node no confía en
la CA interna y toda llamada a Copernicus falla con `SELF_SIGNED_CERT_IN_CHAIN`.
`npm run certs` exporta el almacén de certificados de Windows a `certs/corp-ca.pem`,
que el plugin de Vite levanta solo. Es específico de cada máquina: hay que
correrlo de nuevo en cada PC.

En una red sin inspección TLS no hace falta.

## Principio rector: nunca inventar un dato

Esta es la regla de diseño más importante y aparece en varios lugares del
código (`backend/src/copernicus/analizar.ts`, `evalscript.ts`, `scoring.ts`): si no hay un dato real
disponible, se muestra "sin datos" — nunca un número fabricado para rellenar
un hueco visual. Ejemplos concretos:

- Si una pasada de Sentinel-2 salió `"NaN"` (nublada), se descarta la fecha
  entera en vez de mostrar un promedio parcial engañoso.
- El radar (Sentinel-1) nunca se combina/promedia con la óptica: son físicas
  distintas (reflectancia vs. backscatter) sin calibración cruzada real, así
  que se muestran por separado y rotulados.
- Los rangos de puntaje (`RANGOS` en `backend/src/copernicus/scoring.ts`) y las categorías de lluvia
  (`interpretacion.ts`) están marcados explícitamente como puntos de partida
  razonables, **no calibraciones agronómicas**. Si en algún momento hay datos
  reales para calibrar contra (cortes de forraje, registros de campo), hay
  que ajustar esas constantes contra esos datos — no antes.

Cualquier feature nueva debe seguir esta misma regla.

## Frontend autenticado

Al abrir el frontend se consulta `/api/auth/me` antes de renderizar el mapa.
Una sesión válida con onboarding completo ve la aplicación actual; una sesión
pendiente ve la pantalla temporal de configuración inicial; sin sesión se ve
login/registro. Las cookies se envían con `credentials: "include"`.

En desarrollo Vite proxye las rutas `/api` configuradas hacia `localhost:3001`,
incluidas `/api/lotes` y `/api/copernicus`. Google OAuth y el
onboarding visual completo quedan para etapas posteriores.

## Arquitectura

```
backend/src/app.ts                 composición de Express y routers
backend/src/server.ts              arranque y cierre ordenado del proceso
backend/src/autenticacion/         sesión JWT, cookie y middleware de usuario
backend/src/configuracion/         carga y validación de variables de entorno
backend/src/base-datos/            pool PostgreSQL y verificación del schema
backend/src/routes/                método, path, middleware y controller de los endpoints
backend/src/controllers/           handlers HTTP, validación y coordinación
backend/src/services/copernicus.ts OAuth, TLS y transporte de Sentinel Hub
backend/src/services/              integraciones y operaciones reutilizables
backend/src/copernicus/            requests, evalscripts, parsing y scoring provisional
backend/src/http/                  errores y helpers HTTP compartidos
backend/src/fechas.ts              fechas calendario y frescura
backend/src/geometria.ts           validaciones GeoJSON/Turf
backend/.env                       credenciales opcionales de CDSE (gitignored)
scripts/exportar-ca.mjs     exporta CAs de Windows para redes corporativas

src/
  types.ts, geo.ts, api/rodeo.ts  estado y persistencia API del establecimiento/lotes
  App.tsx                        raíz: estado, orquesta condición + clima
  components/
    MapView.tsx, MapEngine.tsx   mapa Leaflet, dibujo/edición de polígonos
    Sidebar.tsx                  navegación por pestañas
    CondicionPanel.tsx           ranking de condición satelital por lote
    TendenciaChart.tsx           gráfico SVG de NDVI/NDMI/EVI/NDWI históricos
    ClimaPanel.tsx               ranking de lluvia por lote
    PromptModal.tsx, ConfirmModal.tsx

  copernicus/
    api.ts          fachada HTTP que envía únicamente IDs
    presentacion.ts etiquetas y colores de UI, sin cálculo agronómico
    types.ts         DTOs de respuesta

  clima/
    api.ts             solicita actualización y persistencia backend-owned
    interpretacion.ts  categoriza la lluvia en una palabra — NO calibrado agronómicamente
    types.ts
```

Ningún archivo tiene JSDoc largo ni comentarios explicando "qué hace" el
código (los nombres ya lo dicen); los comentarios que hay explican el
**por qué** de una decisión no obvia. Vale la pena preservar ese estilo.

## Fuentes de datos: qué se usa y por qué

### Sentinel-2 + Sentinel-1 (Copernicus Data Space Ecosystem)

- **Sentinel-2 L2A** (óptico, 10–20 m, ~5 días de revisita): NDVI, NDMI, EVI,
  NDWI por píxel vía la Statistical API, enmascarando nubes/sombra con la
  banda SCL. Ventana de búsqueda de 45 días, exige ≥35% del lote despejado.
- **Sentinel-1 GRD** (radar banda C, ~6 días de revisita, no lo tapan las
  nubes): RVI4S1 como respaldo. Se consulta **siempre en paralelo** con la
  óptica (no sólo cuando la óptica está vieja) — medido contra la cuenta real
  del proyecto, las dos consultas combinadas salen ~0.2 PU por lote, contra
  una cuota gratuita de CDSE de 10.000 PU/mes y 300 PU/min. Sobra margen
  para no arriesgar el funcionamiento. Se usa **sólo** cuando resulta
  genuinamente más reciente que la óptica; nunca se mezcla en el mismo
  puntaje (ver "Principio rector").
- Autenticación: OAuth client-credentials contra CDSE, con el secret
  guardado del lado del backend (`backend/src/services/copernicus.ts`) — nunca llega al
  navegador. El endpoint de token no manda CORS, por eso hace falta el
  proxy (a diferencia de Open-Meteo, que sí tiene CORS).
- Cuenta gratuita, hace falta registrarse en https://dataspace.copernicus.eu.

### Open-Meteo (clima)

Elegido sobre OpenWeatherMap después de comparar ambos: no requiere API key ni
cuenta y mezcla modelos regionales de alta resolución (`best_match`). El
navegador ya no llama al proveedor directamente: Express valida los IDs y
polígonos del usuario y realiza la consulta multi-coordenada.

Se pide **una sola petición HTTP para todos los lotes activos**: Open-Meteo
acepta listas de lat/lng separadas por coma y devuelve un arreglo en el
mismo orden. Se usa el centroide de cada lote, no el del establecimiento —
lotes cercanos entre sí suelen caer en la misma celda del modelo y salir con
el mismo número (es lo esperable, no un bug), pero en establecimientos
grandes los lotes más alejados sí pueden diferir, y eso ya se validó con
datos reales.

### Qué se evaluó y se descartó (para no re-investigarlo)

| Fuente | Por qué no |
|---|---|
| **OneSoil** | App gratuita sin API. La API que sí existe es B2B paga (a cotizar por hectárea) y devuelve una imagen renderizada, no estadísticas — habría que reprocesar píxeles a mano. Además usa sólo Sentinel-2, mismo dato que ya tenemos. |
| **MODIS** | Gratis y con API real (NASA AppEEARS), pero 250 m de resolución — un lote de 20–50 ha queda en 2–3 píxeles. El producto de vegetación "bueno" (MOD13Q1) tampoco es diario: compuesto de 16 días. |
| **Copernicus Global Land Service (NDVI 300m)** | Mismo problema de resolución que MODIS. |
| **NASA HLS / Landsat** | Daría más chances de una pasada óptica despejada (revisita ~2 días combinando Landsat+Sentinel-2), pero vive fuera de Copernicus: necesita cuenta de NASA Earthdata aparte (no se puede generar sin que el usuario la cree), y no tiene un endpoint tipo "mandá el polígono, recibí el promedio" — hay que leer tiles crudos (COG) y calcular estadística zonal a mano, con riesgo real de bug de proyección/CRS. Quedó evaluado pero **no implementado**; candidato a futuro si hace falta más frescura óptica. |
| **INTA (Índice Verde / Sistema de Información Clima y Agua)** | No es una API, es un visor web, y usa MODIS (mismo problema de resolución/frecuencia). Sirve como referencia manual para calibrar `RANGOS` contra la zona real, no como fuente en vivo. |
| **Modelo de Machine Learning** | Decisión explícita del equipo: no todavía. No hay datos etiquetados (cortes de forraje reales, condición observada a campo) para entrenar nada — sin eso, un modelo sería una caja negra con los mismos supuestos no calibrados que ya tiene `RANGOS`, pero menos auditable. Se retoma si en algún momento se empieza a loguear condición real observada por lote. |

## Roadmap y bloqueos (contexto de equipo)

Este es un proyecto grupal; estos puntos están explícitamente pausados, no
olvidados:

1. **Ganado en el modelo** (cabezas, categoría, peso) — pausado hasta que el
   grupo consiga y configure el **dispositivo GPS**. Es el cambio de mayor
   impacto: hoy la app dice "este lote está bien", no "entran tantos
   animales por tantos días".
2. **Historial de ocupación / rotación de pastoreo** — depende del punto 1.
   Más adelante se evalúa un modelo de ML para sugerir cuánto descansar cada
   lote (ver por qué el ML está pausado arriba).
3. **Persistencia real / multi-dispositivo** — establecimiento, lotes e
   historiales satelitales y climáticos viven en PostgreSQL/Neon y se cargan
   por API autenticada.
4. **Alertas / análisis programado** — considerado irrelevante hasta que
   exista la persistencia y autenticación del backend; la automatización de
   chequeos periódicos queda para una etapa posterior.

## Convenciones del proyecto

- Todo el código (variables, comentarios, texto de UI) está en **español**.
- Comentarios sólo cuando explican un **porqué** no obvio (un umbral, una
  decisión, una limitación de la API); nunca describiendo qué hace el código.
- Sin dependencias nuevas si se puede evitar: los gráficos (`TendenciaChart`,
  `ClimaPanel`) son SVG a mano, sin librería de charts.
- Paleta de colores de los gráficos: se siguió el skill de dataviz del
  workspace (paleta categórica validada contra daltonismo/contraste) para
  las 4 líneas de índices — no son colores elegidos a ojo.
- Este entorno de desarrollo **no tiene herramienta de automatización de
  navegador** (no hay Playwright/chromium-cli disponible). La validación de
  cada feature se hizo con `npx tsc --noEmit`, `npm run build`, y scripts
  Node/PowerShell puntuales que le pegan directo a las APIs reales
  (Copernicus, Open-Meteo) para confirmar que los datos que vuelven son
  reales y se parsean bien — no hay captura de pantalla real de la UI
  todavía. Si en algún momento se habilita esa herramienta, vale la pena
  revisar el detalle visual con calma.
## Autenticación y pruebas del backend

## Estado implementado: onboarding y datos del mapa

La persistencia histórica de Copernicus y Open-Meteo se realiza en Neon desde
flujos backend-owned; el navegador envía intención/IDs, no observaciones.
También existe historial de uso manual y descanso derivado por lote.

El onboarding visual ahora reutiliza el mapa existente en dos pasos: creación
del establecimiento y creación del primer lote. Cada operación se guarda en
PostgreSQL/Neon mediante APIs autenticadas; el backend asigna IDs y número de
lote.

El frontend autenticado carga `GET /api/establecimiento` y, si corresponde,
`GET /api/lotes` antes de montar la aplicación. Ya no usa `loadState()` ni
`saveState()` como fuente ni migra automáticamente datos viejos de
`localStorage`. Renombrar, activar/desactivar, borrar lotes y editar el
establecimiento esperan la respuesta del backend.

La eliminación de establecimientos está deshabilitada porque todavía no hay
una semántica backend segura para esa operación.

El backend actual usa `AUTH_JWT_SECRET` en `backend/.env`, JWT en cookie
HttpOnly `rodeo_session`, y APIs privadas de establecimiento y lotes. El
frontend ya está conectado a autenticación y PostgreSQL; `localStorage` no es
fuente del establecimiento ni de los lotes.

La guía de pruebas manuales está en [docs/INSOMNIA_TESTING.md](docs/INSOMNIA_TESTING.md).

## Tests automáticos del backend

El backend usa Vitest para los tests unitarios y Supertest para probar la app
Express sin levantar `localhost:3001`.

```bash
cd backend
npm.cmd test
```

También están disponibles:

```bash
npm.cmd run test:unit          # no requiere base de datos
npm.cmd run test:integration   # requiere TEST_DATABASE_URL
npm.cmd run test:watch
npm.cmd run test:coverage
```

Los tests de integración ejecutan las migraciones sobre una base separada y
limpian sus tablas entre tests. Exigen `TEST_DATABASE_URL`; nunca usan
`DATABASE_URL` como fallback y rechazan explícitamente que ambas URLs sean
iguales. Configurá `TEST_DATABASE_URL` sólo con una base o branch de PostgreSQL
descartable creado para testing, sin incluir la URL en el repositorio. Si no
está configurada, la integración se omite de forma segura y los tests unitarios
siguen ejecutándose. La suite actual declara 47 unitarios y 51 integraciones.

## Historial paginado y estado actual

Los endpoints autenticados de historial aceptan `limit` (por defecto 50,
mÃ¡ximo 100), `offset` (por defecto 0) y devuelven `paginacion` con `total` y
`hayMas`. Satélite acepta además `fuente`, `desde` y `hasta`; clima y usos
aceptan `desde` y `hasta`. Las fechas `DATE` se expresan siempre como
`YYYY-MM-DD`.

`GET /api/lotes/:id/estado` devuelve una consolidación objetiva de la última
óptica, el último radar, el clima más reciente y el último uso. No consulta
servicios externos, no calcula un score nuevo y no recomienda lotes: es una
capa de datos para futuras etapas de análisis.

También existe `GET /api/lotes/estado`, que devuelve el mismo DTO consolidado
para todos los lotes activos del usuario, ordenados por número. Con
`?incluirInactivos=true` incluye los inactivos no eliminados; los soft-deleted
nunca aparecen. Por ahora no pagina esta colección porque el establecimiento
tiene una cantidad razonable de lotes y el endpoint está pensado como una
lectura completa para una futura etapa de decisión.
