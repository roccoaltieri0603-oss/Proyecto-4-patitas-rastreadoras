# RODEO

Aplicación de gestión de establecimiento y lotes para ganadería. El repositorio
ya contiene frontend React/Vite y backend Node/Express/PostgreSQL, con
autenticación, persistencia histórica, Copernicus, Open-Meteo y notificaciones
base.

## Antes de tocar nada

Leé primero `AGENTS.md` y después los documentos que referencia.

En particular:

- `docs/PROJECT_DIRECTION.md`
- `docs/AUTH_ONBOARDING.md`
- `docs/DATABASE_MODEL.md`
- `docs/API_CONTRACTS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/CODEX_START_HERE.md`

El `README.md` sigue conteniendo mucho contexto técnico valioso sobre el frontend, Copernicus y Open-Meteo, pero su antiguo bloqueo de “no construir backend” quedó superado por esta etapa nueva. La documentación en `docs/` y `AGENTS.md` manda para el rumbo actual.

## La regla que no se rompe

Nunca mostrar ni persistir un dato inventado. Si no hay dato real, es "sin datos" o un error explícito.

El radar Sentinel-1 nunca se mezcla con la óptica Sentinel-2 en el mismo puntaje: son físicas distintas sin calibración cruzada. Los rangos de `scoring.ts` e `interpretacion.ts` siguen siendo puntos de partida, no calibración agronómica.

## Qué sí está habilitado ahora

- backend Node.js + TypeScript + Express;
- PostgreSQL en Neon y esquema/migraciones;
- registro/login/logout y sesión persistente;
- APIs privadas de establecimiento y lotes con validaciones;
- integración de autenticación en el frontend;
- onboarding backend irreversible, con su pantalla visual armada según el Figma
  (sidebar de vidrio sobre el mapa, en `Sidebar.tsx`);
- mapa, Copernicus y Open-Meteo existentes.

La persistencia histórica de satélite/clima y sus APIs backend están
implementadas. Las actualizaciones satelital y climática completas son
responsabilidad de Express; el navegador sólo envía IDs e intención.

## Qué sigue pausado

- ganado/vacas;
- GPS/dispositivos;
- rotación definitiva;
- planes multi-día definitivos;
- machine learning, **salvo** la sugerencia de subdivisión en lotes descrita
  abajo, que la cátedra destrabó explícitamente;
- roles/membresías entre usuarios.

No implementar estas áreas sin que el equipo las destrabe.

## Los tres repos

Este repositorio es la unión de los tres que tenía el grupo:
`roccoaltieri0603-oss` (backend, auth, persistencia, despliegue),
`Anton-mapa` (migración a Tailwind y rediseño según Figma) y
`bs2896-stack/RODEO-prototipo-1` (el prototipo original). Es la base única: no
volver a bifurcar el trabajo en los otros dos.

Los assets de marca en `src/assets/` (`campo.jpg`, `rodeo-logo.svg`,
`rodeo-marca.svg`) son los exportados del Figma, rescatados del prototipo. No
reemplazarlos por imitaciones en CSS ni por degradados: los originales están en
el repo. Los hex de `--color-lima` y `--color-crema` salen de esos SVG.

## Mapa y geometría

El mapa actual funciona y se debe preservar. Mantener GeoJSON `Feature<Polygon>` y Turf.

Primera versión de DB: guardar polígonos como `JSONB`, no introducir PostGIS todavía.

Regla nueva importante: una edición del establecimiento no puede guardarse si deja algún lote no eliminado parcial o totalmente afuera. La edición debe rechazarse y conservar/restaurar el límite anterior.

## Persistencia

Estado actual: autenticación, onboarding, establecimiento y lotes usan el
backend y PostgreSQL/Neon. El frontend carga esos datos antes de montar el
mapa y no usa `localStorage` como fuente ni fallback; los datos locales viejos
no se migran automáticamente.

La fuente definitiva de establecimiento y lotes es PostgreSQL. No migrar
automáticamente datos locales antiguos ni reintroducir `localStorage` como
fallback silencioso.

Los lotes usan soft delete para conservar historial.

Cada observación satelital real y cada consulta de clima deben poder persistirse históricamente sin pisar datos anteriores.

## Ficha completa de lote

Copernicus se consume mediante el backend Express. Las credenciales opcionales
son `COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET` en `backend/.env`; no
deben existir como variables `VITE_` ni llegar al navegador.

El frontend dispone de la ficha `/lotes/:id`, con routing real, deep link y
carga directa desde los endpoints de estado e historial. Mantener esta lógica
fuera del mapa y no reintroducir `localStorage` como fuente de datos.

## Clima externo

Open-Meteo se consume mediante `POST /api/lotes/:id/clima/actualizar` y
`POST /api/lotes/clima/actualizar`. El frontend envía IDs y origen, no
geometrías ni valores meteorológicos; el backend valida ownership, calcula
centroides, consulta y persiste en una sola operación.

## Notificaciones base

La API y el panel de notificaciones están implementados sobre la tabla
existente, con aislamiento por sesión, paginación y leído/no leído. No crear
reglas automáticas ni tipos agronómicos hasta que producto los defina.

## Actualización satelital

Copernicus está centralizado completamente en Express. El backend obtiene el
lote y su polígono desde PostgreSQL, construye las consultas S2/S1, interpreta,
calcula el scoring provisional sin recalibrarlo y persiste con reloj servidor.
El frontend sólo envía IDs mediante los endpoints individual/batch y consume
`ResultadoLote`. No existe un endpoint raw `/api/copernicus/statistics`.

Los evalscripts y el scoring activos viven en `backend/src/copernicus/`.
Sentinel-1 y Sentinel-2 permanecen separados y `error`/`sin-datos` no se
persisten.

`proyeccion.ts` ajusta una recta de mínimos cuadrados sobre los puntajes de las
fechas de `tendencia` y viaja como campo opcional de `CondicionLote`. No es ML
ni un modelo entrenado, y **no se persiste**: es derivado, no observado. Se
muestra siempre rotulado como proyección, nunca como una medición.

## Sugerencia de subdivisión con IA

Única excepción al pausado de machine learning, pedida por la cátedra: se usa un
modelo ya entrenado, sin entrenar ni ajustar nada. Detalle completo en
`docs/IA_SUBDIVISION.md`.

El modelo es Delineate Anything, corriendo en un microservicio Python aparte
(`ia-lotes/`, FastAPI + Ultralytics) que sólo llama Express. Es opcional: sin
`IA_LOTES_URL` el botón no aparece y nada más cambia.

La propuesta **nunca se guarda sola**. Express la recorta contra el
establecimiento y los lotes existentes, el usuario la revisa y ajusta, y recién
al confirmar se crean los lotes por `POST /api/lotes` con las validaciones de
siempre. Si el modelo no detecta nada, se informa "sin sugerencia": no se
rellena con una división inventada. En la interfaz va siempre rotulada como
propuesta experimental.

No se mezcla con el pipeline satelital: la imagen que ve el modelo son los
tiles del mapa, no Sentinel. Copernicus sigue siendo la única fuente del
análisis agronómico y `scoring.ts` no se toca.

## Seguridad

La persistencia histórica debe guardar únicamente datos reales recibidos de
Copernicus/Open-Meteo. Sentinel-1 y Sentinel-2 permanecen separados; campos no
aplicables quedan `NULL`. No agregar alertas, recomendaciones, GPS ni ML en
esta etapa.

- username único;
- contraseñas hasheadas, nunca planas;
- secretos en servidor / `.env` gitignored;
- nunca enviar `COPERNICUS_CLIENT_SECRET` al browser;
- endpoints privados deben resolver usuario desde la sesión, no confiar en un `user_id` libre del frontend.

## Entorno y validación

Validar cambios con TypeScript y build. Cuando exista backend, validar también sus endpoints y su conexión/schema.

No hay que asumir que algo "debería" funcionar: comprobarlo y documentar cualquier decisión relevante.

## Hardening y despliegue

La configuración backend se valida al arrancar. Mantener centralizadas las
variables en `src/configuracion`: DB y JWT son obligatorias, Copernicus es opcional,
CORS usa orígenes exactos y `SameSite=None` sólo es válido en producción con
cookie `Secure`. `TRUST_PROXY` debe representar saltos reales, no habilitarse
genéricamente.

El frontend consume todas las APIs mediante `src/api/client.ts` y
`VITE_API_BASE_URL` opcional; no agregar `fetch` directos que salteen esa base.
El backend conserva Helmet, JSON máximo de 1 MB, rate limit de auth, request ID,
logs estructurados, `/api/health/live`, `/api/health/ready` y cierre ordenado.
Consultar `docs/DEPLOYMENT.md` antes de preparar una plataforma concreta.

## Historial y estado actual

El backend expone historial paginado con `limit` máximo 100, `offset` y filtros
calendario. También expone `GET /api/lotes/:id/estado`, que sólo consolida
datos persistidos recientes de satélite, clima y uso. Este endpoint no llama
servicios externos, no agrega scoring ni recomendaciones y mantiene separados
Sentinel-1 y Sentinel-2. Las columnas PostgreSQL `DATE` se manejan como
`YYYY-MM-DD`; los `TIMESTAMPTZ` siguen siendo instantes ISO.

`GET /api/lotes/estado` reutiliza ese mismo armado para todos los lotes del
establecimiento. Devuelve activos por defecto, acepta `incluirInactivos=true`,
excluye siempre soft-deleted y ordena por número ascendente. Sus consultas son
agrupadas por lote para evitar N+1; todavía no se pagina esta colección.
