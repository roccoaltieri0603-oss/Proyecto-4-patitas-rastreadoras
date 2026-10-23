# Preguntas abiertas

**Estado actualizado al 11/10/2026:** 012 está aplicada y los puestos operativos están publicados en Neon `production`. Los párrafos históricos que siguen sobre `membresias` describen decisiones previas. La migración 013 de avisos personales pertenece a trabajo local no publicado y requiere validación aislada antes de su despliegue.

## Decisiones de multiusuario vigentes

Se resolvieron múltiples establecimientos, roles por membresía, permisos,
invitaciones de un uso por 10 minutos y transferencia explícita. El antiguo
principal conserva rol PROPIETARIO y acceso operativo, pero pierde todas las
capacidades especiales. Ver [MULTIUSUARIO.md](MULTIUSUARIO.md).

**Pendiente:** semántica final de eliminación de establecimientos. No se ha
decidido hard delete, soft delete ni otra estrategia. La operación permanece
bloqueada. Sólo el principal real podrá ejecutarla y antes deben eliminarse todos
los lotes, también los inactivos. No se agregó `establecimientos.deleted_at`.

Las menciones anteriores a “sin roles”, “sin email obligatorio” y onboarding
global que se conservan más abajo son históricas, reemplazadas por email real
y el modelo multiusuario. No hay otra decisión de producto nueva asumida aquí.

Este archivo existe para evitar que un agente invente decisiones que el equipo todavía no tomó.

## Autenticación

Decisiones vigentes:

- email obligatorio, normalizado y único sin distinguir mayúsculas;
- username único como nombre de usuario, no credencial de login;
- contraseña de al menos 8 caracteres, almacenada sólo como hash;
- sesión JWT en cookie HttpOnly `rodeo_session`, con duración de 7 días;
- `SameSite` configurable (`Lax` por defecto); `Secure` en producción y obligatorio para `SameSite=None`.

Las reglas antiguas de username + contraseña sin email son históricas y están reemplazadas por el contrato actual de autenticación.
## Notificaciones

La taxonomía de nueve tipos y la bandeja compartida por puesto de 012 están publicadas; consultar [NOTIFICACIONES.md](NOTIFICACIONES.md). Neon `production` tiene 001–012. La bandeja personal de la migración 013 está en desarrollo local y requiere validación aislada antes de publicar.

Decisiones de producto que siguen abiertas: los umbrales de frescura óptica, agregación y fallos técnicos son provisionales y deben validarse con usuarios. No hay endpoint público de creación. Visores excluidos de la bandeja; la salida de lote asignado, animales, rutas y jornadas siguen fuera de alcance.
## Datos agronómicos / scoring

Pendiente entrevista con productor para validar importancia y pesos de variables.

Los pesos actuales de NDVI/NDMI/EVI y umbrales de lluvia siguen siendo puntos de partida técnicos, no una calibración agronómica definitiva.

No presentar el puntaje actual como “IA” ni como probabilidad.

### Estimación de forraje — destrabada

El equipo destrabó el 22/10/2026 una estimación diaria de forraje por lote y
una fecha estimada de reingreso. Es un modelo determinístico con fórmulas
publicadas, no ML. Se calcula al consultarla y no se persiste.

El método elegido es la eficiencia en el uso de la radiación (LART-FAUBA) con
fRFA desde NDVI de Sentinel-2, más el estado foliar óptimo de INTA Balcarce
para el reingreso. Se descartó proyectar el NDVI y convertir NDVI→kg porque no
hay calibración propia.

La fecha de reingreso es una estimación rotulada, no una recomendación ni un
plan de rotación: rotación y planes multi-día siguen pausados.

El equipo pidió el 22/10/2026 la etiqueta de condición por día ("Perfecto para
pastoreo", "Regular", "Cuidado", "No apto"). Se deriva del mismo estado foliar
y se muestra rotulada como estimación provisional. No habilita otras
recomendaciones de manejo.

También el 22/10/2026 el equipo adoptó la regla **"si no hay un uso registrado,
no hubo pastoreo"**. Sin usos, el descanso se cuenta desde el alta del lote y
la condición se muestra como mínimo. El riesgo aceptado es que un pastoreo sin
registrar deja la etiqueta mal. El clima que falta para ese conteo se completa
con el histórico de Open-Meteo (migración 016). Parámetros,
fuentes y pendientes en [ESTIMACION_FORRAJE.md](ESTIMACION_FORRAJE.md).

El 22/10/2026 el equipo **destrabó las jornadas de pastoreo cargadas a mano**:
entrada y salida con hora, animales por categoría y altura del remanente
(migración 017). La estimación cuenta el descanso desde la salida, y con
animales adentro no da condición para hoy. Los usos viejos, sólo con fecha,
siguen contando desde esa fecha. Tramos, descansos de agua, ganado automático
y dispositivos siguen pausados.

### Estado implementado de notificaciones

La API privada, paginación, conteo de no leídas, marcado individual/masivo y el panel funcionan en la versión publicada. Los nueve disparadores se describen en [NOTIFICACIONES.md](NOTIFICACIONES.md). El esquema publicado llega a 011; la semántica de puesto compartido de 012 aún no se probó en PostgreSQL real.

## Historial

Decidido:

- no sobrescribir observaciones satelitales;
- guardar cada observación real;
- guardar cada consulta de clima y su detalle diario;
- soft delete de lotes para no perder historia.

Pendiente:

- diseño final de la pantalla Historial;
- cuánto historial mostrar por defecto;
- filtros por fecha/fuente.

## Planilla de uso de potreros

Implementado: `GET /api/establecimientos/:establecimientoId/registro-usos` y la
pantalla `PantallaRegistroUsos` muestran los registros de `usos_lote` con la
forma de la planilla de campo, filtrables por rango de fechas y por potrero. No
agregan tabla ni dato nuevo: la superficie y los días de descanso se derivan de
lo ya guardado y no se persisten.

La **exportación a Excel está destrabada e implementada**: el equipo la pidió
explícitamente. Es `GET .../registro-usos.xlsx`, con los mismos filtros que la
vista, armada al vuelo con ExcelJS y sin guardar archivos. Replica la planilla
de campo, y las columnas que todavía no se registran van vacías para
completarlas a mano, con la aclaración en cada hoja.

Sigue pendiente, y **no se destraba con esto**: días de ocupación (necesitan
fecha de salida), animales que ingresan y carga animal por hectárea. Todo eso
depende de jornadas de pastoreo y ganado.

Pendiente de decisión de producto: las recomendaciones de manejo de la planilla
(corte de igualación, riego, fertilización, resiembra) no son área pausada,
pero hoy no tienen dónde guardarse. Serían columnas nuevas en `usos_lote` en
una migración posterior a 013, con validación en PostgreSQL aislado antes de
publicar. El equipo todavía no decidió si van como texto corto, booleano o
booleano con observación.

## Geometría

Decidido:

- conservar GeoJSON y mapa actual;
- almacenar geometría como JSONB en primera versión;
- no PostGIS todavía;
- edición de establecimiento inválida si deja un lote no eliminado afuera.

Pendiente:

- edición geométrica directa de lotes ya implementada mediante `PATCH /api/lotes/:id`;
- si se agregará historial de cambios geométricos en una etapa futura.

## Lotes

Decidido:

- número automático;
- apodo opcional;
- activo/inactivo;
- soft delete;
- números no se reutilizan automáticamente.

Pendiente:

- si un lote eliminado podrá restaurarse desde UI;
- si en el futuro se permitirá archivar en lugar de eliminar.

## Backend / despliegue

Decidido:

- Node.js;
- PostgreSQL;
- Neon como PostgreSQL remoto del estado actual;
- secretos sólo en entorno servidor;
- topología versionada en `vercel.json` con frontend y `/api` bajo el mismo origen; confirmar que el proyecto Vercel externo la utilice;
- entrypoint serverless ESM separado del arranque local.

Pendiente:

- redeploy y validación del runtime del servicio backend en Vercel;
- dominio/URL final;
- valores finales de CORS/cookies según despliegue;
- CI/CD de despliegue. La CI de validación (types, builds y unitarios) ya está implementada en GitHub Actions.

## Historial y estado actual

Decidido: los listados de historial usan `limit`/`offset` con límite máximo
100; `/api/lotes/:id/historial` conserva compatibilidad y devuelve como máximo
50 elementos por colección. `GET /api/lotes/:id/estado` es una capa de datos
objetiva y no representa el futuro modelo/recomendador.

Pendiente: definir, en una etapa posterior, qué reglas agronómicas consumirán
este DTO y cómo se calibrarán sin confundirlo con el scoring provisional.

Implementado: `GET /api/lotes/estado` devuelve la colección completa de lotes
activos, con opción explícita de incluir inactivos no eliminados. No se pagina
por ahora debido al límite conceptual actual de lotes por establecimiento.

## Ficha completa de lote

Nota histórica: el párrafo siguiente describe la etapa de gateway anterior y
queda reemplazado por “Centralización satelital — decisión cerrada” más abajo.
Ya no está pendiente mover parsing, scoring o persistencia.

La integraciÃ³n de Copernicus ya fue trasladada al backend Express. Queda como
decisiÃ³n posterior mover tambiÃ©n el parsing/scoring y la persistencia fuera del
frontend; esta etapa sÃ³lo mueve el gateway seguro.

Implementada en `/lotes/:id`, con historial paginado y deep link. Las
integraciones de Copernicus/Open-Meteo ya viven en backend; la ficha no
introduce recomendaciones ni cambios de modelo.

## Clima externo

Open-Meteo está centralizado detrás de Express y no requiere API key. Consulta,
interpretación y persistencia ocurren en una operación backend-owned; quedan
abiertas sólo la programación automática y futuras decisiones de producto.

## Centralización satelital — decisión cerrada

Copernicus ya no es sólo un gateway seguro. El backend obtiene los polígonos
desde PostgreSQL, construye y ejecuta S2/S1, interpreta, calcula el scoring
provisional y persiste con reloj servidor. El frontend sólo envía IDs y muestra
los DTOs. El endpoint raw `/api/copernicus/statistics` fue retirado.

Sigue abierta únicamente la calibración agronómica futura del scoring; no está
abierta la ubicación de esta lógica, que queda en backend.

La programación de actualizaciones ya está implementada: `npm run actualizar`
recorre los lotes activos más desactualizados y persiste satélite y clima
reusando los mismos servicios que los endpoints, con el workflow diario
`.github/workflows/actualizacion.yml`. Ver `docs/DEPLOYMENT.md`. Queda por
decidir sólo si en algún momento conviene dispararla también desde el backend
desplegado en vez de desde Actions.

## Ganado y GPS

## Decisiones cerradas de la etapa actual

- La persistencia de mediciones y clima ocurre después de una respuesta exitosa
  de los servicios externos; un error o `sin-datos` no crea historial falso.
- La próxima pasada óptica se muestra sólo como estimación aproximada de ~5
  días, nunca como fecha garantizada.
- El uso manual conserva todos los registros y el descanso se deriva del uso
  más reciente.

- El establecimiento y los lotes del usuario autenticado se cargan desde Neon.
- `localStorage` ya no es fuente ni fallback para esos datos.
- No se migran automáticamente datos locales antiguos.
- El onboarding visual reutiliza el mapa y recupera el paso pendiente si ya
  existe establecimiento.
- La eliminación de establecimiento queda deshabilitada hasta definir una
  semántica backend que preserve relaciones e historial.

Fuera de alcance por ahora.

Cuando se retome, habrá que definir:

- dispositivo comercial exacto;
- ID externo;
- frecuencia de posición;
- asignación dispositivo-animal;
- batería;
- precisión;
- reglas de alerta;
- cantidad de vacas monitoreadas.

No crear tablas o endpoints definitivos de esta parte hasta que el equipo la destrabe.

### Lo único destrabado: la última posición del GPS simulado

El equipo destrabó **una sola cosa** de este bloque: que el punto rojo del GPS
simulado del mapa recuerde dónde lo dejaron entre sesiones. Es el Paso 1 de la
idea de jornadas de pastoreo y se implementó así:

- tabla `gps_simulado_posicion`, **una fila por establecimiento**: latitud,
  longitud, `updated_at`, `updated_by`, con CHECK de rangos válidos. Sin
  historial: guardar una serie de posiciones ya sería el GPS real;
- migración `backend/migrations/008_gps_simulado_posicion.sql`, idempotente, aplicada en Neon `production` como parte de la actualización 001–010;
- `GET` y `PUT /api/establecimientos/:establecimientoId/gps-simulado`. El
  establecimiento sale del contexto de membresía de la URL; cualquier miembro
  lee, el Visor no escribe;
- en el frontend, `src/api/gpsSimulado.ts` y `src/components/mapa/GpsSimulado.tsx`.
  El punto arranca en la posición guardada, o en el centroide si no hay ninguna;
  nunca se inventa una. Sigue rotulado "Simulación de GPS · no es un dato real".

**Todo lo demás sigue pausado**, y esta excepción no lo destraba: jornadas,
tramos, descansos de agua, ganado real y dispositivos. No se tocó `usos_lote`,
ni la detección de lote, ni `ganadoSimulado.ts`. (La exportación a Excel
figuraba en esta lista y después el equipo la destrabó por separado: ver
"Planilla de uso de potreros" más arriba.)

Las preguntas abiertas de arriba tampoco quedan respondidas: la posición
guardada es una preferencia de la demo, no una medición de un dispositivo.

### Mockup de interfaz (sin backend)

Existe una pantalla de frontend `PantallaDispositivosGps`
(`src/pages/PantallaDispositivosGps.tsx`, ruta
`/establecimientos/:establecimientoId/dispositivos`) que muestra conexión y
batería de los collares. Es **sólo un mockup visual** pedido para que el
backend tenga una forma concreta contra la cual trabajar:

- no hay tablas, endpoints ni persistencia; nada de esto llegó a la base;
- los datos salen de `src/demo/dispositivosSimulados.ts` y la pantalla lo avisa
  en un banner ámbar permanente, así que no se presenta un dato inventado como
  real;
- el contrato tentativo (tipos y firmas de las llamadas) vive en
  `src/api/dispositivos.ts`, con un comentario por campo sobre qué se espera;
- para apagar los datos simulados alcanza con `VITE_DISPOSITIVOS_MOCK=false`.

Las preguntas de arriba siguen abiertas: el mockup **no** las responde. En
particular quedan sin definir cada cuánto reporta el equipo, desde cuándo
contar "sin señal" y con qué porcentaje de batería avisar (la pantalla usa 20 %
como valor provisional, no acordado).


### Notificaciones: implementación actual y decisiones temporales

Los nueve tipos de notificación compartida funcionan en la versión publicada; ver [NOTIFICACIONES.md](NOTIFICACIONES.md). Neon `production` tiene 001–012 y el equipo informó pruebas funcionales. La frescura óptica, los umbrales y fallos técnicos siguen siendo criterios sujetos a validación de producto. El responsable GPS publicado es un puesto Administrador. Los avisos personales de 013 aún son locales.

Sigue expresamente pendiente diseñar lote asignado, rutas, jornadas, animales y dispositivos. No alertar por salida de un lote asignado ni ampliar IA/GPS en esta tarea.
