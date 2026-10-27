# Despliegue de RODEO

**Estado verificado el 26/10/2026:** la conexión Neon consultada registra 001–021. Esto no confirma el commit de código desplegado. La suite destructiva y `db:migrate` no se deben ejecutar contra la base habitual. Ver [CUENTAS_OPERATIVAS.md](CUENTAS_OPERATIVAS.md); el aviso fechado al 11/10 era histórico.

La configuración de despliegue versionada está en `vercel.json`; no se pudo confirmar desde el repositorio qué proyecto o ajustes externos están activos en Vercel. El runtime desplegado todavía requiere validación tras el próximo deploy. Esta guía también conserva requisitos portables para otros entornos Node.

## Topologías admitidas

La opción más simple es servir frontend y API bajo el mismo origen, manteniendo
las llamadas relativas a `/api`. También se admite separar los orígenes:

- el frontend define `VITE_API_BASE_URL=https://api.ejemplo.com` al construir;
- el backend incluye el origen público exacto del frontend en `CORS_ORIGINS`;
- todas las llamadas conservan `credentials: "include"`;
- si la cookie debe viajar entre sitios, se usa `COOKIE_SAME_SITE=none`, siempre
  con `NODE_ENV=production` y HTTPS.

No usar `VITE_` para secretos. `VITE_API_BASE_URL` es una URL pública que queda
incluida en el bundle; las credenciales de PostgreSQL, JWT y Copernicus existen
sólo en el entorno del backend.

### Configuración definida en el repositorio

El `vercel.json` de la raíz declara dos builds en un único proyecto: `backend/src/app.mts` con `@vercel/node` y el build estático del frontend hacia `dist`. Las rutas envían `/api` a `/backend/src/app.mts`, sirven archivos existentes y después entregan el resto a `/index.html`. `app.mts` exporta la aplicación Express sin abrir un puerto; `backend/src/server.ts` conserva el arranque local.

Esta configuración local no confirma qué proyecto, raíz, framework preset, rama de producción ni variables están configurados en el panel externo de Vercel. Antes de publicar, comparar el proyecto Vercel con este `vercel.json` y confirmar que su `DATABASE_URL` apunta a Neon de RODEO, rama `production`. El frontend usa `/api` relativo y no requiere `VITE_API_BASE_URL` en esta topología.

## Variables de entorno

### Frontend, durante el build

| Variable | Requerida | Uso |
|---|---:|---|
| `VITE_API_BASE_URL` | No | URL pública del backend separado. Vacía conserva `/api` relativo. |

### Backend, durante ejecución

| Variable | Requerida | Uso |
|---|---:|---|
| `NODE_ENV` | Sí en producción | Debe ser `production`. |
| `PORT` | No | Puerto HTTP; por defecto `3001`. |
| `DATABASE_URL` | Sí | PostgreSQL de la aplicación. |
| `AUTH_JWT_SECRET` | Sí | Secreto aleatorio de al menos 32 caracteres. |
| `CORS_ORIGINS` | Según topología | Orígenes HTTP(S) exactos, separados por comas. No acepta `*` ni paths. |
| `TRUST_PROXY` | Según plataforma | Número de proxies confiables entre Internet y Express; vacío equivale a `false`. |
| `COOKIE_SAME_SITE` | No | `lax` por defecto; también `strict` o `none`. |
| `COPERNICUS_CLIENT_ID` | No | Activa Copernicus únicamente junto con el secret. |
| `COPERNICUS_CLIENT_SECRET` | No | Secreto server-side de Copernicus. |

`TEST_DATABASE_URL` es exclusiva de tests de integración. Debe apuntar a una
base separada y nunca puede ser igual a `DATABASE_URL`.

La aplicación falla al arrancar si una variable obligatoria o un formato de
seguridad es inválido. `COOKIE_SAME_SITE=none` sólo se acepta en producción,
donde la cookie incorpora `Secure`.

## Proxy, cookies y HTTPS

Configurá `TRUST_PROXY` con la cantidad real de saltos confiables indicada por
la plataforma. No lo habilites genéricamente: Express usa esa confianza para
determinar la IP cliente, que también alimenta el rate limit de autenticación.

El TLS debería terminar en el proxy o balanceador de la plataforma. La URL
pública debe usar HTTPS antes de habilitar cookies cross-site. El backend
mantiene la sesión en `rodeo_session`, HttpOnly, con siete días de duración.

El limitador de login/registro usa memoria del proceso. Es suficiente para una
primera instancia, pero un despliegue horizontal debe reemplazar el store por
uno compartido para que el límite sea global y sobreviva reinicios.

## Build, migración y arranque

Frontend:

```bash
npm ci
npx tsc --noEmit
npm run build
```

Backend:

```bash
cd backend
npm ci
npm run typecheck
npm run build
npm run db:migrate
npm run db:verify
npm start
```

En Vercel no se ejecuta `server.ts` ni `npm start`: la ruta `/api` carga `backend/src/app.mts` según `vercel.json`. Los comandos anteriores siguen siendo el flujo de
un proceso Node tradicional.

La migración es un paso explícito previo al arranque; no se ejecuta
automáticamente desde el servidor. PostgreSQL es portable: Neon es el servicio
actual, pero cualquier PostgreSQL compatible puede usarse con `DATABASE_URL`.

Antes de migrar una base principal, validar la misma revisión contra una base
aislada. `NODE_ENV=test` hace que la configuración seleccione exclusivamente
`TEST_DATABASE_URL`; no existe fallback a `DATABASE_URL`:

```powershell
$env:NODE_ENV = "test"
npm run db:migrate
npm run build
npm run db:verify
npm run test:integration
Remove-Item Env:NODE_ENV
```

Sólo después se ejecutan `db:migrate` y `db:verify` con el entorno de la base
principal. `db:verify` falla con exit code no cero si falta una tabla,
columna/tipo, PK, FK, UNIQUE, CHECK o índice esencial.

El proceso responde a `SIGTERM` y `SIGINT`: deja de aceptar conexiones, espera
las requests en curso, cierra conexiones idle y finalmente cierra el pool de
PostgreSQL. La plataforma debe conceder hasta 75 segundos antes de forzar la
terminación, porque una consulta de Copernicus puede tardar cerca de 60.

El servidor usa `requestTimeout=90 s`, `headersTimeout=15 s` y
`keepAliveTimeout=5 s`: conserva margen sobre el timeout legítimo de Copernicus
sin mantener headers o conexiones idle indefinidamente. El pool PostgreSQL se
mantiene conservador (`max=10`, conexión 15 s, idle 30 s) para evitar esperas
sin límite sin hacer tuning específico de un proveedor.

## Health checks

- `GET /api/health/live`: confirma que el proceso HTTP está vivo; no consulta DB.
- `GET /api/health/ready`: confirma proceso y conectividad PostgreSQL; devuelve
  `503` si la base no está disponible.
- `GET /api/health`: alias compatible del readiness histórico.

Usá `/live` para liveness y `/ready` para readiness. Ninguno expone secretos.

## Smoke test de producción

Después de desplegar:

1. comprobar `/api/health/live` y `/api/health/ready`;
2. abrir el frontend y confirmar que las respuestas incluyen `X-Request-Id`;
3. registrar un usuario de prueba, cerrar sesión y volver a iniciar sesión;
4. verificar que la cookie sea HttpOnly y tenga los atributos esperados;
5. confirmar que un origen no permitido no recibe `Access-Control-Allow-Origin`;
6. crear establecimiento/lote en un entorno de prueba y recargar la página;
7. probar Open-Meteo y, sólo si hay credenciales, Copernicus;
8. revisar logs estructurados sin bodies, cookies ni secretos.

El script `npm run test:smoke` amplía ese flujo con clima, un uso válido, el
rechazo de una fecha futura y estado consolidado. Su cleanup elimina
notificaciones, satélite, días/consultas de clima, usos, lotes, establecimiento
y usuario. Sólo acepta usernames exactos `rodeo_smoke_<timestamp de 13 dígitos>`
y confirma que el usuario no quede presente.

No ejecutar smoke tests destructivos contra datos reales de usuarios. Vercel
Services ya es la plataforma configurada; el dominio definitivo, los valores
finales del entorno, la validación del runtime y el mecanismo de CI/CD de
despliegue siguen pendientes.

## Advertencia SSL de `pg`

Con ciertas URLs que usan `sslmode=require`, la versión actual de
`pg-connection-string` avisa que hoy lo interpreta como `verify-full`, pero que
una versión mayor futura adoptará la semántica libpq más débil de `require`.
No es un fallo actual y no debe silenciarse reduciendo TLS. Cuando se roten las
URLs, conviene hacer explícito `sslmode=verify-full` si el proveedor lo admite.
Esta revisión no modifica `.env` ni reescribe la cadena de conexión.

## Microservicio de IA en un servidor

El microservicio de sugerencia de lotes (`ia-lotes/`) es la única pieza de
RODEO que **no** puede ir en Vercel: es PyTorch, pesa GB y una inferencia dura
más que el techo de una función serverless. Va como servicio aparte, siempre
encendido.

Ponerlo en un servidor no es sólo comodidad de despliegue: mientras corre en
localhost, cada integrante necesita Python, torch y una máquina que banque la
inferencia. Centralizado, quien clona el repo no instala nada y una notebook
modesta anda igual, porque el procesamiento de imágenes deja de ser suyo.

**No hay que tocar código.** El navegador nunca habla con el microservicio —
sólo Express lo hace— así que mover el servicio es puramente configuración:

```
IA_LOTES_URL=https://ia-lotes.tu-servidor/
IA_LOTES_TOKEN=<el mismo token que en el microservicio>
```

Tampoco hace falta CORS: el microservicio no recibe pedidos del browser.

### Dónde

Cualquier plataforma que corra un contenedor de larga vida sirve; hay un
`ia-lotes/Dockerfile` listo, con los pesos incluidos en la imagen para que el
primer pedido después de cada arranque no se vaya en la descarga. CPU alcanza:
no hay que pagar GPU. Opciones razonables para el proyecto son Hugging Face
Spaces con SDK Docker, Render, Railway o Cloud Run.

### Lo que cambia al exponerlo

- **El token pasa a ser obligatorio.** En localhost es opcional y el servicio
  acepta cualquier llamada; publicado, eso es una puerta abierta a que
  cualquiera consuma tu CPU. El servicio avisa por log al arrancar sin token.
- **Arranques en frío.** Los planes gratuitos duermen el contenedor. Despertar
  y cargar el modelo puede superar el `IA_LOTES_TIMEOUT_MS` de 75 s y hacer que
  la primera consulta del día falle con `IA_TIMEOUT`. Subir ese valor más allá
  de ~85 s no ayuda por sí solo: el server HTTP corta a los 90 s
  (`requestTimeout`), así que habría que mover los dos.
- **Una inferencia por vez.** El servicio serializa con un lock, porque el
  modelo no es seguro entre hilos. Con varias personas usándolo a la vez, los
  pedidos hacen cola. Si molesta, se escala con más instancias detrás de un
  balanceador, no subiendo workers de uvicorn en el mismo proceso.
- **Nada de esto afecta la regla de siempre**: el microservicio sigue sin saber
  qué es un usuario, sin tocar la base y sin persistir nada.

## Actualización programada de satélite y clima

Hasta ahora las observaciones sólo entraban cuando alguien abría la aplicación y
apretaba "Actualizar". Eso deja a cada lote con una o dos fechas, y todo lo que
necesita una serie —la tendencia del gráfico, la proyección, la simulación de
pastoreo— no arranca hasta las tres.

```powershell
cd backend
npm run build
npm run actualizar
```

Qué hace y qué no (`backend/src/services/actualizacion-programada.ts`):

- Toma **los más desactualizados primero**: hasta 40 lotes satelitales y hasta
  160 de clima/histórico por corrida (`ACTUALIZAR_MAX_LOTES_CLIMA`). El segundo
  límite cubre los 153 lotes activos del relevamiento con margen.
- **No reconsulta lo fresco**: por defecto salta lo satelital de menos de 24 h y
  lo climático de menos de 6 h. Correrlo de más no duplica nada ni gasta cuota.
- **Sólo persiste datos reales.** Reusa los mismos servicios que los endpoints:
  un `error` o un `sin-datos` no escribe una fila.
- **Es prudente con Copernicus**: procesa de a tandas de 5 con pausa entre
  ellas, y si tres tandas seguidas fallan enteras corta, porque eso es el límite
  de consultas y seguir sólo gasta cuota.
- Registra los errores por lote y sale con código 1 si hubo errores técnicos o
  un corte, aunque otras consultas hayan tenido éxito.

Ajustes opcionales por entorno: `ACTUALIZAR_HORAS_SATELITE`,
`ACTUALIZAR_HORAS_CLIMA`, `ACTUALIZAR_MAX_LOTES`,
`ACTUALIZAR_MAX_LOTES_CLIMA`, `ACTUALIZAR_TANDA`, `ACTUALIZAR_PAUSA_MS`.

### Cada cuánto

Sentinel-2 pasa cada ~5 días y la clave es `(lote, fuente, observed_at)`, así
que **una corrida diaria alcanza**: correrlo más seguido no agrega fechas
nuevas. Con una por día, un lote junta en unas dos semanas las tres fechas que
la proyección necesita.

La rutina diaria consulta el clima de hasta 160 lotes. El umbral climático de
6 horas decide cuándo un lote está vencido; no significa que Actions corra cada
6 horas. Se conserva la cadencia diaria: no se verificó una necesidad de
producto para cuatro corridas diarias y eso multiplicaría consumo del proveedor.

Con 153 lotes, clima usa como máximo 153 ubicaciones en la corrida diaria; el
dry-run del 26/10 estimó 177,9 llamadas-equivalentes para el backlog histórico
observado, una carga de recuperación. Ambas cantidades están muy por debajo de
las 10.000 llamadas diarias publicadas para el nivel gratuito de
[Open-Meteo](https://open-meteo.com/en/pricing). El satélite mantiene 40 lotes
por día: con la estimación interna de ~0,2 PU por lote son ~8 PU/día o ~240
PU/mes, frente a la cuota de 10.000 PU/mes de
[Copernicus Data Space](https://documentation.dataspace.copernicus.eu/Quotas.html).

### Cómo programarlo

`.github/workflows/actualizacion.yml` lo corre a diario a las 09:20 UTC
(06:20 en Argentina) y también a mano desde la pestaña Actions. Requiere los
secretos del repositorio y falla explícitamente si faltan.

En la consulta de solo lectura del 26/10/2026, `ejecuciones_actualizacion_proveedor`
tenía 0 registros. Hubo consultas climáticas con origen `automatico` en la base,
pero ese origen no permite atribuirlas a GitHub Actions. No se pudieron leer los
resultados de Actions desde este entorno; confirmar en la pestaña Actions que el
workflow está habilitado y que sus corridas terminan correctamente.

| secreto | para qué |
| --- | --- |
| `DATABASE_URL` | la base Neon |
| `AUTH_JWT_SECRET` | lo exige la validación de entorno al arrancar |
| `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET` | sin esto se intenta el clima; el satélite registra una indisponibilidad |

Equivalentes si no se quiere usar Actions: una tarea de Windows (Task
Scheduler), un `cron` que ejecute `npm run actualizar` desde `backend/` con el
`.env` cargado, o el cron de la plataforma donde quede desplegado el backend.

### Clima histórico para la estimación de forraje

Al final de cada corrida, `npm run actualizar` completa hasta 160 lotes con el
clima histórico que les falte (tabla `clima_historico_lote`, migración 016).
Para una carga completa sin tocar satélite ni el clima regular:

```powershell
cd backend
npm run build
npm run clima:historico   # HISTORICO_MAX_LOTES, HISTORICO_TANDA, HISTORICO_PAUSA_MS opcionales
```

Respeta el límite de Open-Meteo: va de a 5 lotes por consulta, con 3 s entre
consultas, y corta ante un 429. Correrlo de nuevo sólo pide lo que todavía
falta. Sin la migración 016 no hace nada y lo informa.


## Migración de notificaciones

El historial Neon consultado el 26/10/2026 registra 001–021. La suite de integración destructiva no debe ejecutarse en esa base. Los párrafos de despliegue 001–012/013 que siguen describen etapas históricas; para un cambio de esquema futuro, confirmar destino, validar de forma aislada y coordinar compatibilidad antes de desplegar.
