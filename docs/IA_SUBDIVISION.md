# Sugerencia de subdivisión en lotes con IA

Estado: **implementado y marcado como experimental en la interfaz.**

Función opcional: si el microservicio no está configurado, el botón no aparece
y RODEO se comporta exactamente como antes.

## Qué destraba esto

`CLAUDE.md` mantiene "machine learning" en la lista de áreas pausadas. Esta
función es la única excepción, pedida explícitamente por la cátedra: usar un
modelo de IA **ya existente**, sin entrenar nada. La excepción es acotada:

- no se entrena, no se hace fine-tuning y no se guardan pesos propios;
- el modelo no toca el scoring agronómico ni el análisis satelital: no se mezcla
  con Copernicus, con `scoring.ts` ni con `proyeccion.ts`;
- lo único que produce es una propuesta de geometría, que el usuario confirma.

El resto de la lista pausada (ganado, GPS, rotación, planes multi-día,
roles/membresías) sigue pausado.

## La regla que no se rompe, acá

Nunca se muestra ni se persiste un dato inventado.

- La propuesta **nunca se guarda sola**. Vive en memoria del navegador hasta que
  el usuario confirma; recién ahí se crean lotes con `POST /api/lotes`, uno por
  uno y con las validaciones de siempre.
- Si el modelo no detecta nada, se dice "no encontró divisiones claras" y se
  sigue a mano. No se rellena con una grilla ni con una división arbitraria.
- La confianza que se muestra es la que reporta el modelo. Si no la informa,
  viaja como `null`.
- En la interfaz la propuesta se rotula siempre como propuesta: dibujo punteado
  violeta en el mapa, botón "(experimental)" y la advertencia de que el modelo
  puede equivocarse. Nunca se presenta como una medición ni como una división
  correcta.

## El modelo

[Delineate Anything](https://github.com/Lavreniuk/Delineate-Anything), pesos
`MykolaL/DelineateAnything` en Hugging Face.

Se eligió sobre SAM (Segment Anything, de Meta) porque SAM es un segmentador de
objetos genérico: sobre una imagen de campo separa por sombras, manchas de
pasto o cualquier cosa saliente, y hay que filtrar mucho ruido. Delineate
Anything está entrenado específicamente sobre límites de parcelas agrícolas
(dataset FBIS), es resolution-agnostic y devuelve instancias de campo, que es
literalmente el problema que tenemos.

Checkpoint por defecto: `DelineateAnythingv2.pt`. Los autores lo miden en
+103.3% de mAP@0.5 sobre el original, y en CPU resuelve un establecimiento
típico en unos 5 s, así que no hay motivo para usar el chico salvo que haga
falta más velocidad.

Licencia AGPL-3.0 (del modelo y de Ultralytics). Ver `ia-lotes/README.md`.

## Calibración: la escala importa más que el detalle

Esto costó descubrirlo y es lo que separa una propuesta inservible de una
buena, así que queda documentado.

El modelo fue entrenado sobre tiles de **512x512 que contienen varios lotes
cada uno**, con resoluciones de 0.25 a 10 m/píxel. Eso impone dos reglas que
son contraintuitivas:

1. **La ventana de inferencia va en 512 px**, no más. Con ventanas de 1024 el
   modelo se saltea lotes enteros.
2. **El zoom no se maximiza.** Buscar el máximo detalle disponible hace que
   cada ventana vea un pedazo de un solo lote, y ahí el modelo deja de
   reconocer parcelas. `elegir_zoom()` apunta a que el mosaico quede en ~768 px
   de lado, así entran varios lotes por ventana sea el campo grande o chico.

Medido sobre el mismo campo de ~700 ha en Lincoln, cambiando sólo esto:

| configuración | resultado |
| --- | --- |
| máximo detalle (z16, 1399 px), ventana 1024, modelo -S | 28 lotes, se saltea todos los potreros de pasto |
| escala objetivo (z15, 709 px), ventana 512, modelo v2 | 41 lotes, cobertura casi completa |

### Varias escalas a la vez

Por lo mismo, una sola escala tampoco alcanza: en la fina aparecen los cuadros
chicos y en la gruesa los potreros grandes que la fina ni registra. El servicio
corre el modelo en tres zooms (`IA_LOTES_ESCALAS=3`, el elegido ±1) y fusiona
las detecciones en lng/lat, que es el único espacio común entre mosaicos de
distinto zoom. Ante la misma parcela vista en dos escalas gana la versión más
completa y la otra se descarta por solape.

A/B de punta a punta sobre el mismo establecimiento de 763 ha:

| escalas | detectadas | sugerencias | cobertura del campo | tiempo |
| --- | --- | --- | --- | --- |
| 1 (z15) | 41 | 39 | 53.6 % | 7 s |
| 3 (z14, z15, z16) | 63 | 60 | 68.5 % | 17 s |

### Lo que se probó y no sirvió

**TTA (`augment=True` de Ultralytics): no hace nada con este modelo.** Avisa
`Model does not support 'augment=True', reverting to single-scale prediction` y
devuelve exactamente las mismas máscaras en el mismo tiempo. No re-agregarlo
pensando que aporta precisión.

También hay que resistir la tentación de subir el umbral de confianza para
"limpiar ruido": **el modelo califica bajo en este dominio**. A `conf=0.25`
desaparecen los potreros de pasto enteros; el default es `0.10`. Y el IoU de
NMS va alto (`0.70`) porque los lotes diagonales tienen cajas muy solapadas y
con un umbral bajo se suprimen vecinos legítimos.

Para recalibrar hay que **mirar** las detecciones, no leer números:

```powershell
cd ia-lotes
.\.venv\Scripts\python.exe depurar_deteccion.py --salida deteccion.png
.\.venv\Scripts\python.exe depurar_deteccion.py "--bbox=-63.60,-33.20,-63.55,-33.16" --salida otra.png
```

Guarda un PNG con los contornos dibujados sobre la misma imagen que vio el
modelo. Es la única forma de saber si los bordes caen sobre los alambrados o
dos cuadros más allá.

## Arquitectura

```
Navegador                Express                    Python (FastAPI)
    |                       |                              |
    |-- POST /api/ia/------->|                             |
    |   sugerir-lotes        |-- lee establecimiento y      |
    |   (sin body)           |   lotes de PostgreSQL        |
    |                        |-- POST /segmentar ---------->|
    |                        |   { polygon }                |-- baja tiles Esri
    |                        |                              |-- corre el modelo
    |                        |<-- { poligonos, meta } ------|
    |                        |-- recorta contra el límite   |
    |                        |   y resta lotes existentes   |
    |<-- { sugerencias } ----|                              |
    |                        |                              |
    |-- el usuario ajusta, destilda y confirma              |
    |-- POST /api/lotes (uno por lote confirmado) --------->|
```

El navegador manda intención, no geometrías ni imágenes: el mismo patrón que
Copernicus y Open-Meteo.

## Por qué la imagen sale de los tiles del mapa y no de Sentinel-2

Sentinel-2 tiene 10 m por píxel. Un establecimiento de 2 km de lado son 200
píxeles: a esa escala los límites internos de un potrero no se ven. Los tiles de
Esri World Imagery que RODEO ya usa como fondo del mapa llegan a ~1 m por píxel,
que es la escala donde se distinguen los rectángulos de vegetación y color que
marcan la división real, con cerco o sin cerco.

Además la imagen es la misma que el usuario vio al dibujar su establecimiento,
así que la propuesta se corresponde con lo que tiene en pantalla.

Esto no toca el pipeline satelital: Copernicus sigue siendo la única fuente del
análisis agronómico, y Sentinel-1 y Sentinel-2 siguen separados.

## Depuración geométrica (`backend/src/services/sugerencias-lotes.ts`)

El modelo mira un rectángulo y no sabe nada del establecimiento. Express
recorta lo que vuelve, en este orden y de mayor a menor superficie:

1. intersección contra el límite del establecimiento;
2. resta de cada lote no eliminado (incluidos los inactivos, igual que la
   validación de `POST /api/lotes`);
3. resta de las sugerencias ya aceptadas, para que no se pisen entre sí;
4. un `MultiPolygon` se separa en polígonos independientes;
5. se descarta lo que quede por debajo de 0.25 ha;
6. red de seguridad: se vuelve a comprobar contención y no solapamiento con las
   mismas funciones que usa el endpoint de creación;
7. se cierran las franjas finas que dejó el recorte (abajo).

El resultado es que toda sugerencia que llega al usuario es una que
`POST /api/lotes` aceptaría tal cual. Se prefiere perder una sugerencia antes
que ofrecer una que no se puede guardar.

## Cierre de las franjas del recorte

Cada máscara sale independiente del modelo y suele quedarse unos píxeles adentro
del alambrado real, así que entre dos lotes contiguos queda una tira de nadie.
Después del recorte, Express reparte esas tiras al lote vecino.

**Lo que NO se rellena: caminos, canales, cascos, lagunas y potreros que el
modelo no detectó.** Son superficie legítimamente sin lote, y un lote que se come
la laguna es peor que el hueco.

### El criterio

Una franja de recorte es **el área sin asignar que está a menos de
`FRANJA_ANCHO_MAXIMO_METROS` de dos lotes distintos a la vez**. Se construye como
la intersección de las bandas de ambos contornos, así que un hueco más ancho que
ese umbral no genera candidata pegada a ningún lote y queda intacto. Después la
franja tiene que pasar tres filtros más, y recién ahí se la asigna al lote con el
que comparte más borde:

| umbral | default | para qué está |
| --- | --- | --- |
| `anchoMaximoMetros` | 12 | el parámetro físico: hasta dónde una tira es artefacto y no camino |
| `hectareasMaximas` | 2.5 | techo duro: por fina que parezca, una franja no es media hectárea de campo |
| `encierroMinimo` | 0.6 | fracción del contorno pegada a lotes: separa una tira encerrada de una pegada al borde del establecimiento o del sobrante de un potrero, que tienen la mitad del contorno al aire |
| `asignacionMinima` | 0.2 | fracción que tiene que compartir el que se la queda; si no, no se asigna |

Son campos opcionales de `OpcionesDepuracion.franjas`; `franjas: false` apaga el
cierre entero.

No hace falta un umbral aparte de "alargada": el ancho medio (`2·área/perímetro`)
ya lo implica, porque una figura compacta que lo pase mide menos de media
hectárea, y una laguna o un casco —compactos y grandes— dan un ancho medio
enorme.

Si la franja comparte más borde con un lote **ya guardado** se deja sin asignar:
el límite de un lote guardado lo dibujó el usuario, no es un artefacto del
modelo, y no se lo agranda. Por lo mismo, sólo los pares de sugerencias generan
candidatas.

### Por qué 12 m, y por qué es configurable

Un camino y una franja de recorte tienen la misma geometría: la diferencia es
cuánto miden. Un camino vecinal de la pampa mide 20-30 m; el desajuste de las
máscaras va de 4 a 15 m según la escala (el mosaico va de 2 a 8 m/píxel). El
default queda por debajo del camino más angosto.

Barrido sobre el campo de referencia (763 ha en Lincoln, 60 sugerencias):

| ancho | cobertura | qué se absorbe |
| --- | --- | --- |
| sin cierre | 68.5 % | — |
| 8 m | 68.8 % | sólo las tiras más finas |
| **12 m** | **69.1 %** | líneas de alambrado entre lotes vecinos |
| 20 m | 69.5 % | empieza a tocar bordes de arboledas |
| 25 m | 70.9 % | **cruza el canal**: descartado |

Se eligió mirando el dibujo, no la tabla: a 25 m las franjas absorbidas pisan el
agua del canal del noroeste. A 12 m son líneas finas sobre los alambrados.

### Lo que se descartó

**Dilatar los lotes con `turf.buffer` antes de recortar.** Cierra los huecos pero
redondea las esquinas y deja lotes con forma de globo en vez de los rectángulos
que son. Las bandas de acá tienen esquinas rectas (un rectángulo por segmento,
estirado a lo largo para tapar la cuña de las esquinas) y además **son sólo un
cortador**, nunca la geometría que se ofrece: lo que se suma al lote es siempre
sobrante real, con sus bordes rectos.

**Clasificar las componentes conexas del sobrante.** Medido: el área no cubierta
de ese campo es **una sola pieza de 239.8 ha con 32 huecos** —caminos, potreros
sin detectar y tiras finas, todo unido—, y las 14 componentes sueltas restantes
suman 0.5 ha. Sin un cortador que trocee esa pieza no hay nada que clasificar.

El costo del cierre son unos 2 s de geometría sobre los ~17 s que tarda el
modelo. Se mantiene acotado restando los lotes sobre la intersección de dos
bandas (chica) y no sobre cada banda entera, y filtrando pares por caja.

## Dónde aparece en la interfaz

1. **Onboarding, paso 2** (cuando pide marcar el primer lote): botón
   "Subdividir con IA (experimental)" debajo de "Marcar tu primer lote".
2. **Cuenta existente**, pestaña Establecimiento: el mismo botón junto a
   "Agregar lote" y "Editar límite".

En ambos casos el flujo es idéntico: se genera la propuesta, se dibuja punteada
sobre el mapa, y el cartel de revisión permite destildar las que no sirven,
ajustar bordes con Leaflet Draw, confirmar o descartar todo.

## Límites conocidos

- **Depende de que la división se vea.** Si los lotes no dejan marca visible en
  la imagen (sin cerco, sin diferencia de pasto ni de color), no hay nada que
  detectar y la respuesta va a venir vacía. Es el comportamiento correcto.
- **La imagen de Esri no tiene fecha garantizada** y puede ser de hace años. Es
  suficiente para proponer límites, que cambian poco, pero no sirve para nada
  agronómico: para eso está Copernicus.
- **Tiempo de cómputo.** Con la configuración calibrada y tres escalas, en CPU:
  **~17 s** para un campo de ~760 ha; la primera corrida suma la descarga de
  los pesos. Express corta a los 75 s (`IA_LOTES_TIMEOUT_MS`) y el server HTTP
  a los 90 s. Un establecimiento mucho más grande baja de zoom automáticamente
  antes que agrandar el mosaico, y las escalas que no entren en los límites de
  tiles simplemente se descartan en vez de hacer fallar la consulta.
- **Cobertura parcial: el campo no queda cubierto entero.** Medido, la propuesta
  cubre 69.1 % de la superficie del establecimiento. Las franjas finas entre
  lotes vecinos ya se cierran (arriba), pero eran sólo 4.4 ha: mirando el
  sobrante dibujado sobre la imagen, **el grueso de lo que falta son potreros
  enteros que el modelo no detectó**, más los caminos, el canal, las cañadas y
  las lagunas, que no son lotes y tienen que quedar afuera. Subir de acá es
  problema de detección, no de geometría: no se arregla repartiendo sobrante.
- **La precisión depende de la escena.** Sobre parcelas agrícolas bien
  definidas la cobertura es casi total; sobre potreros de pasto sin bordes
  netos, el modelo detecta bastante menos. Es esperable: fue entrenado sobre
  límites de parcelas agrícolas, no sobre divisiones de manejo ganadero.
- **No hay calibración agronómica acá tampoco.** El modelo propone geometría, no
  opina sobre el manejo de los lotes.

## Cómo comprobar que anda

Con el backend levantado y el microservicio corriendo:

```powershell
cd backend
npm run build
npm run test:smoke:ia
```

Crea un usuario `rodeo_smoke_<timestamp>` descartable, dibuja un establecimiento
sobre campo real, pide la sugerencia, verifica que todo lo devuelto esté
contenido y sin superponerse, comprueba que nada se guardó solo, confirma cada
sugerencia contra `POST /api/lotes` y borra el usuario al terminar.

Corrida de referencia con la configuración calibrada: 63 detectadas, 3
descartadas al recortar, 64 franjas repartidas, 60 sugerencias confirmadas sin
que el backend rechazara ninguna, con 69.1 % de cobertura del establecimiento
(527 de 763 ha) en ~17 s. La misma corrida sin el cierre de franjas da 68.5 %
(523 ha).

Para ver qué se absorbió y qué no, el mismo dibujo que sirve para calibrar el
modelo sirve acá: exportar las sugerencias finales y superponerlas al mosaico.
El chequeo que importa es que el camino, el canal y las lagunas sigan afuera de
los lotes.

Para la georreferenciación sola, sin modelo ni red:

```powershell
cd ia-lotes
.\.venv\Scripts\python.exe verificar_mosaico.py
```

## Pendiente / a decidir por el equipo

- Si conviene ofrecer el checkpoint grande cuando haya GPU disponible.
- Si las sugerencias descartadas deberían registrarse para medir qué tan bien
  anda el modelo sobre campos argentinos. Hoy no se guarda nada.
- Términos de uso de los tiles de Esri para consumo automatizado: para un
  trabajo de facultad no es un problema, pero habría que revisarlo antes de
  cualquier uso productivo.
