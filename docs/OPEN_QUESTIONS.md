# Preguntas abiertas

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

Pendiente definir:

- longitud mínima de username;
- longitud mínima de contraseña;
- mecanismo exacto de sesión (preferencia técnica: cookie HTTP-only si encaja bien con el entorno);
- duración de sesión.

Decidido:

- username único;
- username + contraseña solamente por ahora;
- contraseña hasheada;
- sin roles por ahora;
- sin email obligatorio por ahora.

## Notificaciones

## Decisiones cerradas desde la implementación actual

- La sesión usa JWT en cookie HttpOnly `rodeo_session`.
- La sesión dura 7 días; `SameSite` es configurable (`Lax` por defecto) y `Secure` se aplica en producción. `SameSite=None` no se admite sin `Secure`.
- La contraseña exige al menos 8 caracteres; el username debe ser único.
- PostgreSQL remoto es Neon para el estado actual.
- Copernicus es opcional en desarrollo y usa `COPERNICUS_CLIENT_ID`/
  `COPERNICUS_CLIENT_SECRET` sin exponer secretos al navegador.
- La autenticación y los datos de mapa ya usan Neon mediante APIs privadas.

Vercel Services ya es la plataforma configurada. Siguen abiertos el dominio
final, la validación del runtime desplegado y los valores definitivos de
CORS/cookies. El soporte técnico ya existe mediante `CORS_ORIGINS`,
`TRUST_PROXY`, `COOKIE_SAME_SITE` y `VITE_API_BASE_URL` para una eventual
topología con orígenes separados.

Pendiente:

- diseño final (campana, panel, página o combinación);
- lista final de tipos;
- cuáles generan notificación persistente y cuáles son sólo alertas de pantalla;
- política de deduplicación.

Decidido:

- debe existir backend/modelo de notificaciones;
- habrá una entrada visual de notificaciones en la aplicación;
- se preparará una página/panel aunque el diseño sea provisional.

## Datos agronómicos / scoring

Pendiente entrevista con productor para validar importancia y pesos de variables.

Los pesos actuales de NDVI/NDMI/EVI y umbrales de lluvia siguen siendo puntos de partida técnicos, no una calibración agronómica definitiva.

No presentar el puntaje actual como “IA” ni como probabilidad.

### Estado implementado de notificaciones

Ya existen API privada, paginaciÃ³n, conteo global de no leÃ­das, marcado
individual/masivo y panel base en Sidebar. No hay generaciÃ³n automÃ¡tica ni
endpoint pÃºblico de creaciÃ³n. Siguen abiertos los tipos finales,
deduplicaciÃ³n y reglas de producto.

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
- Vercel Services con frontend y backend bajo un único origen;
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
