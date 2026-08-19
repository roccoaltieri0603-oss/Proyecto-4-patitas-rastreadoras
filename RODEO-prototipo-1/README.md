# RODEO

Front de gestión de establecimiento y lotes para ganadería, con condición de
pastoreo (satelital) y clima por lote. Es un proyecto grupal: este repo es
sólo el front — el dispositivo GPS y el backend los está armando el resto
del grupo por separado (más detalle en "Roadmap y bloqueos" más abajo).

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

Antes de arrancar, creá `copernicus.credentials.ts` a partir de la plantilla y
pegá tu client id / secret de https://dataspace.copernicus.eu (gratis, hace
falta una cuenta CDSE):

```bash
cp copernicus.credentials.example.ts copernicus.credentials.ts
```

El clima (Open-Meteo) no necesita ninguna credencial ni configuración.

## Qué NO viene en esta copia (y cómo se recupera)

| Carpeta / archivo | Cómo vuelve |
|---|---|
| `node_modules/` | `npm install` |
| `certs/` | `npm run certs` |
| `dist/`, `.tsbuild/` | `npm run build` |
| `copernicus.credentials.ts` | copiar la plantilla y pegar las credenciales (nunca se commitea, ver `.gitignore`) |

## Sobre `npm run certs`

Si tu red hace inspección TLS (típico en redes corporativas), Node no confía en
la CA interna y toda llamada a Copernicus falla con `SELF_SIGNED_CERT_IN_CHAIN`.
`npm run certs` exporta el almacén de certificados de Windows a `certs/corp-ca.pem`,
que el plugin de Vite levanta solo. Es específico de cada máquina: hay que
correrlo de nuevo en cada PC.

En una red sin inspección TLS no hace falta.

## Principio rector: nunca inventar un dato

Esta es la regla de diseño más importante y aparece en varios lugares del
código (`api.ts`, `evalscript.ts`, `scoring.ts`): si no hay un dato real
disponible, se muestra "sin datos" — nunca un número fabricado para rellenar
un hueco visual. Ejemplos concretos:

- Si una pasada de Sentinel-2 salió `"NaN"` (nublada), se descarta la fecha
  entera en vez de mostrar un promedio parcial engañoso.
- El radar (Sentinel-1) nunca se combina/promedia con la óptica: son físicas
  distintas (reflectancia vs. backscatter) sin calibración cruzada real, así
  que se muestran por separado y rotulados.
- Los rangos de puntaje (`RANGOS` en `scoring.ts`) y las categorías de lluvia
  (`interpretacion.ts`) están marcados explícitamente como puntos de partida
  razonables, **no calibraciones agronómicas**. Si en algún momento hay datos
  reales para calibrar contra (cortes de forraje, registros de campo), hay
  que ajustar esas constantes contra esos datos — no antes.

Cualquier feature nueva debe seguir esta misma regla.

## Arquitectura

```
vite-plugin-copernicus.ts   proxy de Node para Sentinel Hub (Copernicus)
copernicus.credentials.ts   client id/secret de CDSE (gitignored)
scripts/exportar-ca.mjs     exporta CAs de Windows para redes corporativas

src/
  types.ts, geo.ts, storage.ts   estado del establecimiento/lotes (localStorage)
  App.tsx                        raíz: estado, orquesta condición + clima
  components/
    MapView.tsx, MapEngine.tsx   mapa Leaflet, dibujo/edición de polígonos
    Sidebar.tsx                  navegación por pestañas
    CondicionPanel.tsx           ranking de condición satelital por lote
    TendenciaChart.tsx           gráfico SVG de NDVI/NDMI/EVI/NDWI históricos
    ClimaPanel.tsx               ranking de lluvia por lote
    PromptModal.tsx, ConfirmModal.tsx

  copernicus/
    api.ts        consulta óptica (S2) + radar (S1) en paralelo, por lote
    evalscript.ts EVALSCRIPT_INDICES (NDVI/NDMI/EVI/NDWI) y EVALSCRIPT_RADAR (RVI4S1)
    scoring.ts     puntaje 0–100, categorías, alertas — NO calibrado agronómicamente
    types.ts

  clima/
    api.ts             consulta Open-Meteo, un request para todos los lotes activos
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
  guardado del lado de Node (`vite-plugin-copernicus.ts`) — nunca llega al
  navegador. El endpoint de token no manda CORS, por eso hace falta el
  proxy (a diferencia de Open-Meteo, que sí tiene CORS).
- Cuenta gratuita, hace falta registrarse en https://dataspace.copernicus.eu.

### Open-Meteo (clima)

Elegido sobre OpenWeatherMap después de comparar ambos: sin API key, sin
cuenta, `access-control-allow-origin: *` confirmado en vivo (por eso el
front lo llama directo desde el navegador, sin pasar por el proxy de Node,
a diferencia de Copernicus). Mezcla de modelos regionales de alta
resolución (`best_match`).

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
3. **Persistencia real / multi-dispositivo** — hoy todo vive en
   `localStorage` del navegador (`storage.ts`), un solo dispositivo, sin
   backup. Lo va a resolver el **backend del grupo** (base de datos +
   sincronización front ↔ dispositivo). No se debe construir un backend
   ad-hoc acá mientras tanto.
4. **Alertas / análisis programado** — considerado irrelevante hasta que
   exista el backend del punto 3 (sin backend no hay dónde correr un chequeo
   periódico ni a quién notificar).

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
