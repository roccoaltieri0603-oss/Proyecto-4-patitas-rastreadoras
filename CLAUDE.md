# RODEO

Estado al 11/10/2026: migraciones 001–012 aplicadas y verificadas en Neon de RODEO, rama `production`; la reconciliación 001–007 se completó y los datos se conservaron. Las nueve notificaciones compartidas y las cuentas operativas están publicadas. Según el equipo, antes de publicar pasaron 313 pruebas unitarias, 81 integraciones y ocho flujos manuales. Las mejoras actuales son locales, no publicadas; Al 22/10/2026 Neon `production` ya tiene también 013, 014 (radiación y ET₀ en `dias_clima`) y 015 (pastura del lote), registradas el 22/10 a las 13:28 UTC, 016 (`clima_historico_lote`) y 017 (jornadas de pastoreo en `usos_lote`), aplicadas el mismo día; `db:verify` pasó con las 17 migraciones y sus checksums. No ejecutar migraciones ni integraciones destructivas sobre la base habitual.

Para notificaciones leer `docs/NOTIFICACIONES.md`. La eliminación de establecimientos sigue bloqueada por decisión de producto; no introducir hard delete ni soft delete.

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

- ganado real automático (las jornadas de pastoreo **manuales** están
  destrabadas desde el 22/10/2026, ver abajo);
- GPS/dispositivos reales. Excepción local destrabada el 26/10/2026: dos GPS
  virtuales editables por usuario personal y establecimiento (migración 019,
  aún no aplicada en production). Sus ubicaciones, apodos, batería y conexión
  son simulados y persistidos, sin trayectoria ni avisos nuevos;
  - persistir la última posición del punto GPS simulado;
  - alertar si el punto rojo simulado guardado queda fuera del establecimiento,
    exclusivamente al responsable administrador designado (ver
    `docs/NOTIFICACIONES.md`);
  - avisar a la bandeja compartida cuando el punto simulado guardado queda en
    un lote distinto del anterior (`gps_simulado_en_lote`), rotulado como
    simulación y borrable sin leer. No se avisa la salida de un lote;
- rotación definitiva;
- planes multi-día definitivos;
- machine learning, **salvo** la sugerencia de subdivisión en lotes descrita
  abajo, que la cátedra destrabó explícitamente;
- roles/membresías entre usuarios.

Las jornadas de pastoreo se destrabaron el 22/10/2026, **cargadas a mano**:
entrada y salida con hora, animales por categoría de la planilla (adultos,
toretes o vaconas, terneros) y altura del remanente al salir. Amplían cada uso
de `usos_lote` (migración 017); una sola jornada abierta por lote. Siguen
pausados los tramos, los descansos de agua y el ganado real automático. No
implementar salida de lote asignado, rutas ni lógica de
animales automática.

No implementar estas áreas sin que el equipo las destrabe.

## Posición del GPS simulado

El marcador rojo compartido anterior se mantiene para compatibilidad histórica,
pero el mapa ahora muestra los dos puntos de `gps_simulados`. Estos pertenecen
al usuario personal aunque cambie de puesto; los mueve el mapa y se editan en
Mis dispositivos. No ejecutan disparadores de notificaciones ni tocan
`usos_lote`. Por compatibilidad, sólo GPS 1 conserva el aviso visual de lote y
la señal en memoria que habilita la demostración de pastoreo; GPS 2 no altera
esa demo. La migración 019 debe validarse en PostgreSQL desechable antes de
considerar producción.

La tabla `gps_simulado_posicion` (migración
`backend/migrations/008_gps_simulado_posicion.sql`, aplicada en Neon `production`)
guarda **una sola fila por establecimiento**: latitud, longitud, `updated_at` y
`updated_by`, con CHECK de rangos. Sin historial, a propósito: guardar una serie
de posiciones ya sería el GPS real.

Los endpoints son `GET` y `PUT
/api/establecimientos/:establecimientoId/gps-simulado`. El establecimiento sale
del contexto de membresía de la URL, nunca de un ID del cuerpo. Cualquier
miembro lee; el Visor no escribe.

Lo que se guarda no es un dato real de campo y no se presenta como tal: es dónde
dejó el usuario el marcador. El rótulo "Simulación de GPS · no es un dato real"
se mantiene, la detección de lote y `ganadoSimulado.ts` no cambian, y si no hay
posición guardada el punto arranca en el centroide, sin inventar una.

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

## Nombres en el frontend

Las pantallas viven en `src/pages/` y se llaman `Pantalla*` (`PantallaIngreso`,
`PantallaMisEstablecimientos`, `PantallaMapaEstablecimiento`, `PantallaFichaLote`,
`PantallaEquipo`, `PantallaRegistroUsos`, `PantallaDispositivosGps`): el nombre del archivo y el del
componente son iguales y dicen qué se ve. Los paneles de la sidebar siguen con
sufijo `Panel`. Nombres descriptivos en castellano, sin abreviar.

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

## Estimación de forraje

Destrabada por el equipo el 22/10/2026. Desde el 25/10/2026 **no estima el
crecimiento diario**: el equipo sacó la fórmula EUR × fRFA(NDVI) × radiación
porque su EUR salía de un solo ensayo en Uruguay, la fRFA de una calibración en
trigo, no cambiaba la etapa ni el orden y nadie podía validarla. No reintroducir
crecimiento ni NDVI en la estimación sin datos de campo para calibrarlos. El
pasto en pie sale sólo de mediciones de altura, y vale sólo el día medido.

El reingreso se estima por estado foliar en grados-día. De ese mismo conteo
sale la condición por día (Perfecto para pastoreo / Regular / Cuidado / No
apto), para hoy y los días con pronóstico; el satélite no interviene.

Regla del equipo: si no hay un uso registrado, no hubo pastoreo. Sin usos, el
conteo arranca en el alta del lote y la condición es un mínimo (`esMinimo`).
Los días de clima que no cubren las consultas regulares se completan con el
pronóstico histórico de Open-Meteo en `clima_historico_lote` (migración 016).
Esa tabla nunca reescribe un día, no aparece en el historial ni en el estado
del lote, y sólo la lee la estimación. Es determinístico, no
ML ni IA; es derivado y no se persiste. Sentinel-1 no interviene.

Los parámetros viven en `backend/src/estimacion/parametros.ts` con su fuente.
Lo que no tiene fuente queda `null` y el modelo responde "sin parámetros".

`lotes.tipo_pastura` y `lotes.fecha_siembra` (migración 015, aplicada en Neon
`production`) se editan con `editar_lotes`. Sin tipo, la ficha dice "Sin tipo de
pastura". Ver `docs/ESTIMACION_FORRAJE.md`. Para no cargarla lote por lote,
`PATCH …/lotes/pastura` guarda la misma pastura en varios lotes en una sola
transacción (todos o ninguno); en la sidebar es "Seleccionar varios → Asignar
pastura", con la opción de ponérsela a todos los lotes activos.

Ampliada del 23 al 25/10/2026, **local y sin publicar** (`VERSION_MODELO =
'forraje-8'`; subirla cada vez que cambie el cálculo):

- etapa del pasto por día (con animales, rebrotando, listo, pasado), progreso
  del rebrote y confianza de cada dato;
- mediciones de altura cargadas por el usuario (migración 018, **aplicada en
  Neon `production` el 24/10/2026 a las 20:58 UTC** por pedido explícito del
  usuario: es sólo aditiva, `db:verify` pasó con las 18 migraciones y no
  cambió ninguna cantidad de filas) y pasto en pie con la conversión de Ojeda
  et al. (2021, INTA). Festuca y agropiro quedan `null` hasta tener las ecuaciones de INTA
  Balcarce;
- "pasto para comer" sobre un remanente objetivo: `null` en todas las
  pasturas, porque ninguna fuente verificada da esa altura;
- `GET …/lotes/orden-pastoreo` ordena los lotes para pastorear hoy, siempre
  con la leyenda "Orden según los datos disponibles. La decisión es tuya.". No
  calcula animales, carga ni permanencia y no crea notificaciones.

Los scripts `clima:historico` y `satelite:historico` (este último sólo
completa el historial satelital: la estimación ya no usa imágenes) muestran el plan por defecto y sólo escriben con `--escribir`; hasta el plan
lee la base de `DATABASE_URL`. El 24/10/2026 se corrieron contra
`production` sólo en modo lectura. Con `--escribir` sólo agregan
observaciones reales, pero `satelite:historico` gasta cuota de CDSE: un año
de los 136 lotes la agotaría, así que va por partes. Las integraciones nunca
van contra la base habitual: vacían las tablas.

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

Después del recorte, Express reparte entre lotes vecinos **sólo** las franjas
finas que dejó el propio recorte: lo que quedó sin asignar a menos de 12 m de dos
lotes a la vez, al lote con el que comparte más borde. Los umbrales viven en
`sugerencias-lotes.ts` y son configurables. No cerrar huecos dilatando los
polígonos con `turf.buffer`: redondea las esquinas y deja lotes con forma de
globo.

Lo que queda sin cubrir y es grande y compacto se ofrece aparte, con
`origen: 'hueco'` y `confianza: null`. **No es una detección**: ningún
descriptor de forma distingue un potrero de un camino ancho o de una laguna, así
que la interfaz los muestra destildados, en ámbar y rotulados "sin detectar", y
tildarlos es decisión del usuario. Nunca presentarlos como algo que el modelo
encontró.

No se mezcla con el pipeline satelital: la imagen que ve el modelo son los
tiles del mapa, no Sentinel. Copernicus sigue siendo la única fuente del
análisis agronómico y `scoring.ts` no se toca.

## Seguridad

La persistencia histórica debe guardar únicamente datos reales recibidos de
Copernicus/Open-Meteo y las mediciones de campo que carga el usuario (usos,
jornadas y alturas). Sentinel-1 y Sentinel-2 permanecen separados; campos no
aplicables quedan `NULL`. No agregar alertas, recomendaciones, GPS ni ML en
esta etapa; la única posición GPS que se persiste es la del punto simulado
descrito arriba, que es una preferencia de la demo y no una medición.

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

## Planilla de uso de potreros

`PantallaRegistroUsos` (ruta `/establecimientos/:establecimientoId/registro-usos`)
muestra los registros de `usos_lote` con la forma de la planilla de campo
"Registro de manejo de potreros en la finca", con encabezados agrupados,
filtros por rango de fechas y por potrero, y paginación. Los filtros viajan en
la URL para que una planilla filtrada se pueda compartir por link.

Es **sólo una vista de lectura**: no hay tabla nueva, no se escribe nada y los
usos se siguen cargando desde la ficha de lote con los permisos de siempre
(`registrar_usos` / `modificar_usos`). La alimenta
`GET /api/establecimientos/:establecimientoId/registro-usos`.

Con las jornadas, cada renglón muestra entrada y salida con hora, animales por
categoría y altura del remanente, tal como se cargaron. Agrega sólo valores
derivados, nunca persistidos:
- la superficie en hectáreas, del polígono con Turf (`null` si la geometría no sirve);
- los días de descanso, desde la salida del uso anterior del mismo potrero
  (`null` en su primer uso);
- los días de ocupación, de la entrada a la salida;
- las cabezas por hectárea, sumando categorías. No son equivalentes vaca.

Lo que un renglón no tiene (un uso viejo sin hora, una jornada abierta) y las
recomendaciones de manejo se muestran como "sin datos" y no se completan con un
valor inventado.

La descarga en Excel está implementada y el equipo la pidió explícitamente, así
que deja de estar pausada. Es
`GET /api/establecimientos/:establecimientoId/registro-usos.xlsx`, con los
mismos filtros que la vista y sin paginar: el libro lleva el período completo,
hasta un tope de 5000 renglones. **No se guarda ningún archivo**: se arma al
vuelo con ExcelJS y se escribe en la respuesta. Con `loteId` va una sola hoja;
sin él, una hoja por potrero.

El libro trae las columnas de la jornada: entrada y salida con hora, días,
animales por categoría, cabezas por ha y altura del remanente. Lo que no se
cargó y las recomendaciones de manejo quedan **vacías**, para completarlas a
mano en el campo, y cada hoja aclara arriba por qué. Vacío no es un dato
inventado; rellenarlas sí lo sería.
