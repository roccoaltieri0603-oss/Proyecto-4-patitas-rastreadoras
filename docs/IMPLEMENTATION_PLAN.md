# Plan de implementación

Objetivo: agregar backend y persistencia sin romper el frontend que ya funciona.

## Principio de trabajo

No hacer una refactorización grande de mapa + auth + datos externos en un solo cambio.

Trabajar por capas, verificando que el proyecto siga compilando y que el mapa conserve comportamiento.

## Fase 0 — documentación y baseline

- leer `AGENTS.md` y toda la carpeta `docs/`;
- levantar frontend actual;
- correr `npx tsc --noEmit`;
- correr `npm run build`;
- no modificar funcionalidad hasta confirmar baseline.

## Fase 1 — backend mínimo

Crear backend Node.js separado del frontend dentro del mismo repositorio, por ejemplo:

```text
backend/
  src/
  package.json
  .env.example
```

Requisitos:

- Express o estructura equivalente simple;
- `GET /api/health`;
- lectura de variables de entorno;
- conexión PostgreSQL preparada;
- migraciones/schema versionado en repo;
- errores JSON consistentes.

### Estado al 20/08/2026

Completada la base técnica en `backend/`: proyecto Node.js + TypeScript,
Express, configuración por entorno, pool PostgreSQL con `pg`, `GET
/api/health`, build/typecheck y script de migración.

No conectar secretos reales al Git.

## Fase 2 — esquema PostgreSQL

Implementar las siete tablas definidas en `DATABASE_MODEL.md`:

1. usuarios;
2. establecimientos;
3. lotes;
4. mediciones_satelitales;
5. consultas_clima;
6. dias_clima;
7. notificaciones.

Agregar constraints, índices y foreign keys.

### Estado al 20/08/2026

Completado `backend/migrations/001_initial_schema.sql` con las siete tablas
definidas en `docs/DATABASE_MODEL.md`, sus claves foráneas, restricciones,
unicidad e índices. La migración es idempotente y se ejecuta dentro de una
transacción; no se agregó una tabla auxiliar de versiones para conservar
exactamente las siete tablas de dominio de esta primera etapa.

Primero debe poder ejecutarse contra PostgreSQL local o una URL de DB de entorno. Después se usará Neon.

## Fase 3 — autenticación

Implementar:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Requisitos:

- username único;
- hash seguro de contraseña;
- sesión segura;
- endpoints privados protegidos;
- nunca devolver `password_hash`.

Frontend:

- pantalla registro;
- pantalla login;
- carga inicial de sesión;
- logout.

## Fase 4 — onboarding

Después del registro:

- ir al mapa;
- ocultar/bloquear navegación no necesaria;
- usuario dibuja y nombra establecimiento;
- guardar establecimiento vía API;
- usuario crea primer lote;
- guardar lote vía API;
- backend marca `onboarding_completed_at`;
- desbloquear app.

Si cierra antes de terminar, el siguiente login vuelve al onboarding.

Una vez completado, nunca relock automático por quedarse sin lotes.

## Fase 5 — reemplazar `localStorage` (completada)

## Estado real al cierre de la etapa actual

La autenticación y el backend de establecimiento/lotes ya están implementados,
y el frontend ya resuelve loading, login, registro, sesión persistente y logout.
El onboarding visual y la carga de establecimiento/lotes desde API ya están
implementados. El frontend no usa `localStorage` para esos datos ni importa
automáticamente su contenido anterior.

Migrar gradualmente:

- cargar establecimiento desde API;
- cargar lotes desde API;
- crear/renombrar/activar/desactivar/eliminar vía API;
- mantener los componentes visuales existentes tanto como sea posible.

Cuando la API sea la fuente definitiva, retirar `storage.ts` o dejar únicamente una migración explícita si todavía hace falta importar datos locales antiguos.

## Fase 6 — corrección de edición de establecimiento

La edición del establecimiento y de los lotes ya pasa por el backend. Mantener
la regla:

- validar todos los lotes no eliminados;
- si alguno queda afuera, no persistir la edición;
- restaurar/conservar polígono anterior en UI;
- mostrar mensaje claro.

Validar tanto frontend como backend.

## Fase 7 — soft delete

Cambiar eliminación de lote:

- frontend sigue mostrando acción “Eliminar”;
- backend actualiza `deleted_at`;
- listados normales omiten eliminados;
- historial permanece intacto;
- no reutilizar automáticamente números antiguos.

## Fase 8 — persistencia satelital

Estado: completada. La consulta, interpretación, scoring provisional y
persistencia de Copernicus pasan por backend.

Pasos seguros:

1. mover credenciales al entorno del backend;
2. reutilizar la lógica existente de request/parsing/scoring, no reescribirla sin necesidad;
3. consultar observaciones;
4. insertar sólo observaciones nuevas;
5. devolver condición actual + tendencia al frontend;
6. mantener Sentinel-1 separado de Sentinel-2.

El backend conserva datasets, evalscripts, ventanas, resolución, cobertura,
p50, tendencia, concurrencia, scoring y fallback anteriores. El frontend sólo
solicita actualizaciones por ID y el endpoint raw `/statistics` fue retirado.

## Fase 9 — persistencia de clima

Mover o encapsular la consulta de Open-Meteo en backend manteniendo la optimización actual de múltiples coordenadas por request.

Por cada actualización:

- crear snapshot por lote;
- guardar resumen;
- guardar cada día asociado;
- devolver DTO compatible al frontend.

## Fase 10 — notificaciones base

Crear:

- endpoint de listado;
- marcar una/todas como leídas;
- icono/campana o entrada visible provisional en frontend;
- página/panel simple de notificaciones.

No inventar todavía una taxonomía compleja de alertas. Los tipos concretos se agregan cuando el equipo los defina.

## Fase 11 — historial UI

Con la DB ya llena, recién entonces construir una vista Historial real que pueda mostrar:

- evolución satelital guardada;
- evolución de consultas de clima;
- eventualmente recomendaciones y uso real cuando existan.

### Estado implementado de notificaciones

La infraestructura de API y UI estÃ¡ completa sobre la tabla original, sin
migraciones ni reglas automÃ¡ticas. El Sidebar carga 20 por pÃ¡gina, mantiene un
badge global sin polling y permite marcar una o todas sin F5. Los tipos y las
reglas que crearÃ¡n notificaciones siguen pendientes de producto.

## No hacer en estas fases

- vacas;
- GPS;
- batería;
- rutas de animales;
- jornadas;
- recomendaciones multi-día definitivas;
- ML;
- roles de usuarios;
- múltiples establecimientos por usuario.

## Estado de la segunda etapa

Completados registro, login, logout y `auth/me` con bcryptjs, JWT firmado,
cookie HttpOnly, middleware reutilizable y errores JSON. También están
implementadas las APIs privadas de establecimiento y lotes, con validación
GeoJSON `Feature<Polygon>`, contención, superposición, pertenencia al usuario,
soft delete, numeración histórica y finalización irreversible del onboarding.

## Etapa de ficha completa de lote

## MigraciÃ³n del gateway Copernicus al backend

Implementada sin cambiar evalscripts, cÃ¡lculos, scoring, ventanas ni
resoluciÃ³n. `backend/src/services/copernicus.ts` concentra OAuth, cache de
token, reintento por 401, timeout y TLS; `backend/src/routes/copernicus.ts`
expone los endpoints autenticados. Vite sÃ³lo hace proxy hacia Express.

Las credenciales son opcionales para arrancar y viven exclusivamente en
`backend/.env`.

Implementada en frontend sin cambios de modelo ni de backend. React Router
expone `/lotes/:id`, incluidos deep links y recarga directa; la página consume
el estado consolidado y los historiales paginados existentes, separa Sentinel-2
óptico de Sentinel-1 radar, y muestra NDVI, clima, descanso, usos e historial.
También permite actualizar satélite/clima y registrar usos con las APIs ya
existentes. La ausencia de datos se muestra explícitamente.

## Centralización satelital completa (implementada)

El backend es dueño del lote/polígono, los requests Statistical API, los
evalscripts, el parsing, el scoring provisional y la persistencia. La ficha usa
`POST /api/lotes/:id/satelite/actualizar`; el mapa usa
`POST /api/lotes/satelite/actualizar` con IDs. El endpoint raw
`/api/copernicus/statistics` fue retirado. S1/S2 permanecen separados y cada
resultado de un lote se guarda en una transacción con reloj servidor.

Las descripciones anteriores que presentan esta centralización como futura son
contexto histórico del orden de implementación, no el estado vigente.

## Definition of done por fase

El bloque histórico siguiente conserva el estado de una etapa anterior. Para
el estado satelital vigente manda la sección “Centralización satelital
completa (implementada)” inmediatamente anterior.

## Estado histórico de la etapa de onboarding y persistencia

La persistencia histórica satelital, climática y de uso manual del lote está
implementada sin mover todavía Copernicus ni Open-Meteo al backend. La
migración adicional es `002_lote_usos.sql`; `001_initial_schema.sql` no fue
modificada.

Ese fue el cierre de aquella etapa; la sección “Actualización climática
backend-owned” describe el estado vigente posterior y agrega la migración 003.

Completado el onboarding visual sobre el mapa existente y la conexión de
establecimiento/lotes a PostgreSQL/Neon. El frontend carga los datos antes de
mostrar el mapa, recupera un onboarding interrumpido y no usa `localStorage`
como fallback ni migra sus datos automáticamente.

También están conectados creación, renombrado, edición de límite,
activación/desactivación y soft delete de lotes. La eliminación de
establecimiento permanece deshabilitada hasta definir su semántica de backend.

Cada fase debe:

- compilar;
- no romper el mapa existente;
- actualizar documentación si cambió contrato/modelo;
- dejar pasos claros de ejecución;
- evitar secretos en Git;
- incluir una prueba manual mínima o test automatizado cuando corresponda.

## Actualización climática backend-owned

Implementada con la migración `003_clima_origen.sql`. Los endpoints
`POST /api/lotes/:id/clima/actualizar` y
`POST /api/lotes/clima/actualizar` reciben IDs/origen, validan ownership y usan
los polígonos almacenados para calcular centroides. Mantienen una llamada
multi-coordenada, `past_days=7`, `forecast_days=5`, `timezone=auto`, interpretan
y persisten sólo resultados válidos. El frontend no reenvía valores
meteorológicos. Las automáticas se deduplican atómicamente por lote y las
manuales conservan snapshots independientes.

## Etapa de historial paginado y estado actual

Implementada sobre las tablas existentes, sin migración nueva:

- paginación y filtros validados para satélite, clima y usos;
- carga de días de clima con una consulta por página, evitando N+1;
- `GET /api/lotes/:id/estado` como DTO consolidado, sin modelo ni
  recomendación;
- tests unitarios de fechas/query params y tests de integración de paginación,
  filtros, estado, datos faltantes y seguridad.

El estado consolidado para todos los lotes (`GET /api/lotes/estado`) reutiliza
el mismo servicio que el endpoint individual. Ejecuta consultas agrupadas por
conjunto de lotes, mantiene orden por número y permite incluir inactivos sin
exponer soft-deleted. La paginación de esta colección queda deliberadamente
para cuando el dominio permita muchos más lotes por establecimiento.

## Etapa de hardening de producción

Implementada sin cambios de modelo ni reglas de negocio:

- validación central de entorno, CORS y cookies configurables;
- Helmet, JSON máximo de 1 MB y rate limit para login/registro;
- request IDs, logs estructurados y pool PostgreSQL acotado;
- liveness/readiness, timeouts HTTP y cierre ordenado;
- URL pública opcional del backend centralizada en el cliente frontend;
- tests de infraestructura y CI de validación en GitHub Actions;
- guía de despliegue portable en `docs/DEPLOYMENT.md`;
- topología Vercel Services same-origin y entrypoint Express ESM dedicado.

Siguen pendientes el redeploy/validación de runtime, los dominios y la
automatización del deploy.
Si se escala a múltiples instancias, el store en memoria del rate limit debe
reemplazarse por uno compartido.
