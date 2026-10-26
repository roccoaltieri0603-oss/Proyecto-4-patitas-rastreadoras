# Estimación diaria de forraje

**Estado al 25/10/2026.** El equipo destrabó la estimación el 22/10/2026. El 23 y el 24/10/2026 pidió agregar rebrote, etapa, mediciones de altura y orden de lotes (ver `docs/OPEN_QUESTIONS.md`), y el 25/10/2026 pidió sacar el crecimiento diario (ver "Por qué no estima el crecimiento"). Todo esto está implementado **en local, sin publicar**:

- tipo de pastura y fecha de siembra (migración 015, aplicada en `production`);
- parámetros con fuente;
- motor, versión `forraje-8`;
- endpoints de estimación, de mediciones de altura y del orden de lotes (ver `docs/API_CONTRACTS.md`);
- migración 018 `mediciones_altura`, **aplicada en Neon `production` el 24/10/2026**;
- scripts `clima:historico` y `satelite:historico`, corridos el 24/10/2026 contra `production` **sólo en modo lectura** (ver "Estado con los datos reales").

## Estado con los datos reales (24/10/2026)

Lectura de `production`, sin escribir nada:

- **Pastura cargada:** 5 de 136 lotes activos (4 de festuca alta y 1 de alfalfa). Los otros 131 no tienen pastura y salen "sin datos".
- **Pastoreos registrados:** hay 1 uso en toda la base, así que casi todos los lotes con pastura se cuentan desde el alta, como mínimo.
- **Clima histórico:** faltan 269 días en total, unas 136 llamadas a Open-Meteo, muy por debajo del límite gratuito de 10.000 por día.

Este documento está pensado para que lo revise un agrónomo. Todos los valores son **provisionales** hasta contrastarlos con datos de campo de los lotes propios.

## Qué estima y qué no

Es un modelo determinístico con fórmulas y tablas publicadas. No es machine learning, ni IA, ni un modelo entrenado. Todo lo que calcula es derivado: se calcula al leer y no se persiste. Sólo se guardan observaciones reales (Open-Meteo y las mediciones que carga el usuario). **El satélite no interviene.**

Para cada lote y cada día estima:

| Qué | De dónde sale | Cuándo no hay |
|---|---|---|
| **Etapa del pasto** (con animales, rebrotando, listo, pasado) | Grados-día desde la salida de los animales, contra el criterio de estado foliar | Sin criterio de reingreso con fuente o sin temperatura |
| **Progreso del rebrote** | Grados-día sobre la vida media foliar mínima | Ídem |
| **Pasto en pie** (kg MS/ha) | Una medición de altura de ese día, convertida a kilos | Los días sin medición, o sin conversión con fuente |
| **Pasto para comer** | Pasto en pie menos el remanente objetivo | **Hoy nunca**: ninguna pastura tiene remanente objetivo con fuente |
| **Confianza** de cada dato | Ver más abajo | — |

Además, ordena los lotes del establecimiento para decidir a cuál mandar la hacienda hoy.

No estima cuánto creció el pasto ni cuánto hay en pie sin medir.

## Por qué no estima el crecimiento

Hasta la versión `forraje-eur-7` el modelo estimaba los kg MS/ha producidos por día con la lógica de eficiencia en el uso de la radiación (Monteith), la del seguimiento forrajero de LART-FAUBA:

```text
crecimiento (kg MS/ha/día) = EUR × fRFA(NDVI de Sentinel-2) × 0,48 × radiación global × 10
```

El 25/10/2026 el equipo decidió sacarlo, para que el proyecto sea más confiable:

- **La EUR** de festuca y alfalfa salía de un solo ensayo con cortes, en Colonia (Uruguay), 2020-2021 (Tommasino et al. 2026, Zenodo 18874910). En festuca, el verano y el invierno salían de dos ciclos cada uno. Las demás pasturas no tenían EUR con fuente.
- **La fRFA** desde el NDVI se calibró en trigo del sudoeste pampeano (Pellegrini et al. 2020), no en pasturas.
- **El NDVI de cada día** casi nunca era una imagen de ese día: se interpolaba, se arrastraba hasta 30 días o se modelaba el rebrote en línea recta, que era un supuesto de diseño.
- **No cambiaba la decisión:** la etapa y el orden de los lotes salen de los grados-día; el crecimiento sólo se mostraba en la ficha.
- **Nadie podía validarlo:** sin cortes a campo no se puede medir cuánto se equivoca.

Lo único que sí usaba el crecimiento era el pasto en pie de los días posteriores a una medición (lo medido más lo crecido). Ahora el pasto en pie vale sólo el día que se mide, y la ficha muestra la última medición con su fecha.

Con esto se borraron `ndvi.ts`, el gráfico de crecimiento y el script `evaluar:estimacion`, que medía el error del NDVI supuesto y del pasto en pie proyectado. Si en el futuro hay cortes a campo para calibrar una EUR propia, el cálculo se puede recuperar del historial de git.

## Clima de cada día

Para la temperatura de cada día se usa el valor observado de la consulta regular más reciente; si no hay, el del clima histórico; si no, el pronóstico más reciente. Se marca cuál se usó. Nada se extiende más allá del último día con clima guardado.

### Clima histórico

Cada consulta regular de Open-Meteo guarda sólo 7 días pasados. Los días que faltan se completan con la **API de pronóstico histórico de Open-Meteo**, modelo `best_match`, en la tabla `clima_historico_lote` (migración 016). Es el mismo tipo de datos que la consulta regular: en el ensayo del 22/10, los días solapados dieron valores idénticos.

No se usa el archivo ERA5 (`/v1/archive`). La documentación de Open-Meteo recomienda el pronóstico histórico para representar con más precisión los últimos años; ERA5 está pensado para consistencia de largo plazo, tiene 25 km de resolución y 5 días de demora. La estimación nunca mira más de 366 días atrás.

- Se completa desde el último pastoreo (o el alta) y, como mínimo, los 60 días de la ventana. No se va más de 366 días atrás ni antes de 2022.
- Un día ya guardado no se reescribe. La tabla no aparece en el historial ni en el estado del lote: sólo la lee la estimación.
- Lo completan la actualización programada (40 lotes por corrida) y la manual, con un presupuesto de 15 s.
- Para una carga completa está `npm run clima:historico`. Por defecto **no consulta ni escribe**: muestra el plan, los días faltantes y las llamadas estimadas. Con `--escribir`, consulta y guarda. Acepta `--desde`, `--lote` (repetible) y `--max-lotes`.
- Límite gratuito de Open-Meteo: 10.000 llamadas por día, 5.000 por hora y 600 por minuto. Un pedido de más de 14 días cuenta como varias llamadas; el plan lo estima de más.
- La primera carga, del 22/10/2026, guardó 7628 días para 132 lotes sin errores.

## Historia satelital

La estimación ya no usa las imágenes, pero `npm run satelite:historico` sigue disponible para completar el historial satelital de un lote. Baja las imágenes despejadas de Sentinel-2 del último año, con el mismo pedido, la misma lectura y el mismo scoring de la actualización regular, y las guarda con el mismo `guardarMedicionSatelital`. `scoring.ts` no se toca. Una fecha ya guardada se saltea.

- Por defecto **no consulta ni escribe**: muestra el plan y las PU estimadas. Con `--escribir`, consulta y guarda.
- Opciones: `--dias` (365 por defecto), `--lote`, `--max-lotes`, `--max-pu` (2000 por defecto: si la estimación lo pasa, frena antes de consultar).
- La cuota gratuita de CDSE es de 10.000 PU por mes. Un año completo de los 136 lotes costaría hasta unas 10.000 PU: hay que correrlo por partes.

**Ojo:** hasta el modo sin `--escribir` lee la base de `DATABASE_URL` para armar el plan.

## Etapa del pasto

Sale del mismo conteo de grados-día que la fecha de reingreso, ciclo por ciclo. Cada ciclo de descanso va del día siguiente a una salida (o del alta, si todavía no hubo pastoreos) hasta la próxima entrada.

| Etapa | Condición de la ficha | Regla |
|---|---|---|
| Con animales | — | Entre la entrada y la salida registradas. |
| Rebrotando | No apto o Cuidado | Grados-día (base 2 °C) por debajo de la vida media foliar mínima. |
| Listo | Perfecto para pastoreo | Desde la fecha temprana hasta la tardía, inclusive. |
| Pasado | Regular | Después de la fecha tardía: pasada la vida media foliar, las hojas más viejas mueren. |

**Progreso del rebrote:** grados-día con base baja sobre la vida media foliar mínima. 1 (100 %) es "listo". No tiene tope.

Para alfalfa, mezclas y pastizal natural no hay etapa, porque no tienen criterio de reingreso con fuente.

### Fecha de reingreso

Usa el criterio de **estado foliar óptimo** de INTA Balcarce: se vuelve a pastorear cuando el macollo alcanzó las hojas vivas que es capaz de mantener. Ese lapso es la vida media foliar, en grados-día acumulados desde la salida de los animales.

```text
grados-día del día = max(0, (temp_min + temp_max) / 2 − temperatura base)
```

La fuente publica rangos. Para no dar una precisión falsa, el modelo informa una **fecha temprana** (temperatura base y vida media en su mínimo) y una **fecha tardía** (ambas en su máximo). Si falta un día de temperatura, la cuenta se corta y lo dice.

### Condición para pastorear

La ficha dice, para hoy y cada día con pronóstico, si el lote está **Perfecto para pastoreo**, **Regular**, en **Cuidado** o **No apto**:

| Condición | Regla |
|---|---|
| No apto | Por debajo de la vida media foliar mínima menos un filocrono: falta más de una hoja. |
| Cuidado | Falta menos de una hoja. |
| Perfecto para pastoreo | Desde la fecha temprana hasta la tardía. |
| Regular | Después de la fecha tardía. |

El umbral de "una hoja" usa el filocrono **máximo**, para no adelantar el aviso. Es una decisión de diseño sobre los datos de la fuente. Con festuca a 12 °C constantes: no apto hasta el día 22, cuidado del 23 al 44, perfecto del 45 al 69 y regular desde el 70.

### Sin pastoreos registrados

Regla del equipo (22/10/2026): **si no hay un uso registrado, no hubo pastoreo**. Sin usos, el conteo arranca en el alta del lote en RODEO (`lotes.created_at` en el calendario de Buenos Aires).

El resultado es un **mínimo**: la etapa se muestra "como mínimo", las fechas "a más tardar", y "Regular" sí es segura. La respuesta lo marca con `inicioConteo = 'alta'`, `esMinimo = true` y `etapaEsMinimo` en cada día.

## Confianza

| Dato | Alta | Media | Baja |
|---|---|---|---|
| Etapa de hoy (en el orden) | Nunca: el criterio de la fuente es un rango | Contada desde un pastoreo con temperatura observada | Contada desde el alta o con temperatura pronosticada |
| Pasto en pie | Una buena medición de ese día | — | Una medición con menos de 20 lecturas, fuera del rango calibrado o en una estación que la fuente no midió |

Una medición de confianza baja igual se convierte, con un aviso.

## Pasto en pie

Las mediciones de altura las carga el usuario en la ficha (migración 018): fecha, momento (al sacar los animales, antes de entrar o en una recorrida), instrumento (plato o regla), altura promedio en cm, cantidad de lecturas y, si se quiere, el desvío. Son observaciones reales y se guardan tal cual. Los kilos se calculan al leer.

- **Conversión:** kg MS/ha = coeficiente de la estación × altura, con el intervalo del 95 % del coeficiente que publica la fuente.
- **Sólo el día medido:** sin un crecimiento con fuente no se proyecta a los días siguientes. Esos días dicen "El pasto en pie se conoce sólo el día que se mide; la última medición es del dd/mm", y la ficha muestra la última medición con sus kilos y su fecha.
- **Varias mediciones el mismo día:** vale la de más lecturas.
- **Remanente en la planilla:** una medición "al sacar los animales" asociada a una jornada cerrada copia su altura en `usos_lote.altura_remanente_cm`, para que la planilla y el Excel muestren lo mismo. Al borrarla o cambiarla, se quita sólo si era la que ella había copiado.

El plato Filip's marca cada 0,5 cm: la lectura se divide por 2 para tener cm, como en la fuente. El formulario lo hace solo si se tilda "Mi plato cuenta medios centímetros (Filip's): dividir por 2".

### Altura → kg MS/ha

Fuente: Ojeda, Quinodoz y Lezana (2021), *RIA* 47(1): 26-45, INTA. 17 sitios del sudoeste de Entre Ríos (31,8-33,1 °S), 1999-2005, corte al ras en 0,2 m². Plato Filip's Manual Folding Plate Meter (Jenquip), 3,23 kg/m². Modelo forzado al origen: la ordenada no fue significativa en ningún caso. Con otro plato, más pesado o liviano, la conversión es orientativa.

**Pasturas perennes base alfalfa** (Tabla 2; validación con datos independientes en la Tabla 3). Rango calibrado: 3 a 15,5 cm de altura comprimida.

| Estación | kg MS/ha por cm | IC 95 % | n | R² | Validación: n · R² · sesgo |
|---|---|---|---|---|---|
| Otoño | 153,0 | 143,8-162,2 | 63 | 0,68 | 39 · 0,78 · −9,8 % |
| Invierno | 179,6 | 170,0-189,1 | 79 | 0,67 | 38 · 0,37 · +17,1 % |
| Primavera | 195,6 | 184,5-206,7 | 45 | 0,69 | 55 · 0,64 · +41,0 % |
| Verano | 194,2 | 186,7-201,6 | 40 | 0,74 | 212 · 0,65 · +14,0 % |
| Anual (referencia) | 179,7 | 174,5-184,9 | 227 | 0,68 | +16,2 % |

El sesgo es (media modelada − observada) / observada: en primavera, la conversión **sobrestimó un 41 %** en la validación. La ficha lo muestra al lado del número.

**Verdeos invernales: avena y raigrás anual.** Rango calibrado: 3 a 24 cm.

| Estación | kg MS/ha por cm | IC 95 % | n | R² | Nota |
|---|---|---|---|---|---|
| Otoño | 149,5 | 134,7-164,4 | 24 | 0,83 | El texto dice 149,0; se usa el 149,5 de la Tabla 2. |
| Invierno | 154,2 | 144,5-163,9 | 45 | 0,71 | |
| Primavera | 151,9 (anual) | 144,1-159,6 | 75 | 0,78 | n = 6 en primavera y no significativa: se usa el anual de la misma fuente. |
| Verano | 151,9 (anual) | 144,1-159,6 | 75 | 0,78 | Sin datos de verano: anual, con confianza baja. |

La validación de verdeos sólo se publicó anual: n 72, R² 0,51, **subestimó 27,8 %**.

**Asignación por pastura:**

| Pastura | Plato | Regla |
|---|---|---|
| Alfalfa, mezcla alfalfa con gramíneas | Base alfalfa | Sin calibración |
| Raigrás anual, avena | Verdeos | Sin calibración |
| Festuca alta, agropiro alargado | **null**: pendiente de INTA Balcarce | **null**: ídem |
| Raigrás perenne, pasto ovillo, cebadilla, pastizal natural | null | null |

- **Alfalfa pura:** la fuente calibró pasturas base alfalfa consociadas con gramíneas, no alfalfa pura. Se aplica con esa aclaración, que la ficha muestra. **Decisión a revisar.**
- **Festuca y agropiro:** Laplacette, Berone, Utsumi, Cicore, Marino, Errecart e Insua calibraron plato y regla en la EEA Balcarce (primavera 2021; festuca n 69, agropiro n 30), pero no publicaron las ecuaciones. Informan R² del plato de 0,88 y 0,86, de la regla de 0,74 y 0,77, y un RMSE promedio de 615 kg MS/ha con plato y 687 con regla. Hay que conseguir las ecuaciones de INTA Balcarce.
- **INIA Uruguay** publica calibraciones de plato, pero su sitio bloqueó la descarga y no se pudieron leer en el original. No se adoptaron.
- La regla nunca toma prestada la ecuación del plato, ni una especie la de otra.

## Pasto para comer

```text
para comer = max(0, pasto en pie − remanente objetivo (cm) × coeficiente de la estación)
```

Usa la misma conversión e instrumento de la medición del día.

**Hoy queda `null` para todas las pasturas:** ninguna fuente verificada da una altura de remanente objetivo por especie e instrumento.

- Agnusdei (2013), *Archivos Latinoamericanos de Producción Animal* 21(1): 63-78, explica por qué dejar láminas al salir, pero no da alturas por especie.
- La ficha 48 de INIA Uruguay (Manejo de Praderas), que se cita con 10 cm para festuca, no se pudo abrir para verificarla.
- Las alturas de salida medidas por INTA Olavarría son de mezclas y describen lo que pasó, no lo que se recomienda.

Cuando haya una fuente, se carga en `remanenteObjetivoCm` de `parametros.ts`, en cm del instrumento. Mientras tanto, la ficha y el orden muestran el pasto en pie y el motivo.

### Fuentes buscadas el 24/10/2026

Leídas en el original y **no adoptadas**:

- **Laplacette et al. (2022)**, *RAPA* 42 Supl. 1, PP 26, festuca y agropiro en la EEA Balcarce: el resumen publica sólo los R², no los coeficientes. Sigue sin conversión.
- **Fernández et al. (2022)**, *RAPA* 42 Supl. 1, PP 9 (UNLP), plato en la pradera húmeda de mesófitas de la Depresión del Salado. Tiene ecuaciones por estación, pero:
  - son 54 cortes en cuatro estaciones, unos 13 por estación, por debajo de 20;
  - no publica una ecuación anual;
  - no dice qué plato usó;
  - es una sola comunidad del pastizal.
- **Borrajo (2024)**, *RAPA* 44(2): 69-83: los 5 cm de remanente son para dos pastoreos de control de la floración en agosto y septiembre, no un remanente general.
- **Marino, Errecart, Cicore, Bertram y Berone (2025)**, nota en fertilizar.org.ar: 800-1000 kg MS/ha de remanente para una primavera con exceso de pasto. Es una nota de divulgación sin referencias y para una situación puntual.

Identificadas y **no leídas**, porque sus repositorios cortan la conexión desde el entorno de desarrollo:

- **Berone et al. (2022)**, *Guía para el manejo de pasturas en función del stock de pasto y la tasa de crecimiento*, Ediciones INTA. Según los resúmenes de búsqueda, da biomasa de entrada y de salida en kg MS/ha desde el ras del suelo para festuca, raigrás anual, agropiro, alfalfa y mezclas. Un remanente en kg no depende del instrumento, y la conversión de Ojeda et al. también corta al ras: es la pieza que habilitaría "pasto para comer" en alfalfa, mezclas y verdeos. Está en `ri.conicet.gov.ar` (handle 11336/210433) y en el repositorio de INTA (20.500.12123/11337).
- **Berone**, *Manejo del pastoreo: una herramienta para calcular…*, Visión Rural, INTA (20.500.12123/12229). Usaría kg MS/ha por encima de 5 cm, una base distinta de la de la guía: hay que leer las dos antes de elegir.
- **INIA Uruguay**, en `ainfo.inia.uy`: *Invernada de precisión* (ítem 2559), con ecuaciones del plato por tipo de pastura (Pravia et al.), y la publicación sobre manejo de festuca (ítem 2529).

Si alguien del equipo descarga esos PDF desde su navegador, se pueden leer y, si cumplen las reglas de precisión, cargar.

## Orden de los lotes

`GET …/lotes/orden-pastoreo` ordena los lotes activos del establecimiento para decidir a cuál mandar la hacienda hoy. Se calcula al leer y no se guarda. Va siempre con la leyenda **"Orden según los datos disponibles. La decisión es tuya."**

No calcula animales, carga, días de permanencia ni rutas: siguen pausados. No crea notificaciones.

**Grupos, de primero a último:**

1. **Listo:** en la ventana de reingreso y con el piso firme. Primero el que antes pasa de su mejor momento (en los días con pronóstico); a igualdad, el que más pasto tiene. Un listo que no se pasa dentro del pronóstico va después de los que sí.
2. **Pasado:** pasó la ventana. El que más pasto tiene, primero. Va después de los listos porque todavía están en su punto; uno pasado ya perdió calidad. **Decisión a revisar:** un agrónomo podría preferir el pasado primero, para no perderlo.
3. **Esperar al piso:** listo o pasado, pero con el piso pesado.
4. **Rebrotando:** el más avanzado, primero.
5. **Con animales.**
6. **Sin datos:** sin pastura, sin criterio, sin clima de hoy. Cada uno con su motivo.

"Más pasto" compara primero el pasto para comer y, a igualdad o sin él, el pasto en pie medido ese día. Como hoy no hay remanente con fuente, en la práctica desempata el pasto en pie, y sólo cuando el lote se midió hoy. Es una decisión de diseño: un lote con más pasto aprovecha mejor la entrada de la hacienda. A igualdad de todo, por número de lote. Un valor sin dato va al final de su grupo.

**Qué le falta a cada lote** (`falta`): lo que el usuario puede cargar para que el lote entre al orden o lo haga con su etapa real.

- `pastura`: no tiene tipo de pastura.
- `ultimo-pastoreo`: no tiene pastoreos registrados y se cuenta desde el alta, como mínimo.
- `clima`: falta el clima de hoy o una temperatura del descanso.
- `null`: no falta nada que esté en manos del usuario. Por ejemplo, la alfalfa no tiene criterio de reingreso con fuente.

**Piso pesado** (decisiones de diseño, configurables en `orden-pastoreo.ts`):

- la última consulta de clima, de hasta 2 días, tiene categoría `piso-pesado`; o
- la última imagen óptica, de hasta 10 días, tiene una alerta de agua libre o suelo anegado.

Ambas son lecturas que el sistema ya guarda; no se agregan reglas agronómicas nuevas. Esta alerta del análisis satelital es lo único del satélite que llega al orden.

**En la pantalla:**

- arriba de la lista de lotes, "Hoy, para pastorear": los tres primeros que se pueden pastorear, con su motivo y su confianza, o "Ningún lote está listo hoy" y el próximo;
- debajo, "Les faltan datos": hasta tres lotes con algo por cargar, cada uno con su botón (`CompletarDatosLote.tsx`). "Elegir pastura" y "Cargar último pastoreo" despliegan un formulario corto que guarda ahí mismo, con los permisos de siempre (`editar_lotes` y `registrar_usos`). El último pastoreo se guarda como un uso con fecha; "Con hora y animales, en la ficha" abre la ficha con el formulario del pastoreo terminado listo. "Actualizar clima" consulta el clima de ese lote. Sin permiso, el lote dice qué le falta pero no muestra el botón;
- en la pestaña Condición, todos los lotes en ese orden, con el piso, el pasto, la confianza y el mismo botón cuando les falta algo;
- en la lista de lotes, "Seleccionar varios → Asignar pastura" abre una ventana para elegir una pastura y guardarla en los lotes tildados, o en todos los activos, de una vez. Avisa cuáles ya tenían otra pastura antes de reemplazarla.

## Precisión

**No está medida.** Para saber cuánto se equivoca la etapa haría falta comparar contra lotes reales con fechas de pastoreo conocidas y el estado de las hojas observado en el campo; para el pasto en pie, contra cortes pesados. El proyecto no tiene esos datos.

Lo que sí se sabe está en las fuentes: el criterio de reingreso es un rango (por eso la fecha temprana y la tardía), y la conversión de altura tiene el intervalo y el sesgo de su validación, que la ficha muestra.

## Qué pasa cuando falta algo

Cada parte responde por separado:

- **Sin tipo de pastura:** no hay estimación; la ficha dice "Sin tipo de pastura".
- **Sin criterio de reingreso:** no hay etapa ni fecha, pero sí el pasto en pie de los días medidos (alfalfa, mezcla).
- **Sin conversión de altura:** la medición se guarda, pero no se pasa a kilos (festuca, agropiro).
- **Sin remanente objetivo:** hay pasto en pie, pero no pasto para comer.
- **Faltan el criterio y la conversión:** el lote responde "sin parámetros" y explica qué falta (pastizal natural).

Nunca se toma prestado un valor de otra especie o de otro instrumento, ni se rellena con un supuesto silencioso. Fuera del rango calibrado se calcula igual, con aviso y confianza baja.

## Criterio de reingreso (estado foliar óptimo)

Fuente única: Berone, Recavarren y Marino (2021), "¿Cada cuánto damos la vuelta en pastoreos de Festuca?", *Visión Rural* 27(137): 24-27, Unidad Integrada Balcarce INTA-FCA UNMdP, Tabla 1. Temperatura base: 2-4 °C. Valores para el sudeste bonaerense.

| Pastura | Hojas vivas por macollo | Filocrono (°Cd) | Vida media foliar (°Cd) |
|---|---|---|---|
| Festuca alta | 2,5 | 180-220 | 450-550 |
| Raigrás perenne | 3,0 | 100-115 | 300-350 |
| Raigrás anual | 3,8 | 90-120 | 350-390 |
| Agropiro alargado | 2,5 | 180-240 | 450-600 |
| Pasto ovillo | 4,0 | 105-125 | 420-500 |
| Cebadilla criolla | 4,0 | 75-90 | 300-350 |
| Avena (verdeo de invierno) | 3,8 | 110-150 | 450-500 |
| Alfalfa | — | — | — |
| Mezcla alfalfa con gramíneas, pastizal natural | — | — | — |

La alfalfa no es una gramínea y no se maneja por hojas por macollo. INTA Manfredi recomienda descansos de 35 a 42 días corridos, no en tiempo térmico. El umbral de 500-600 grados-día con base 5 °C que circula proviene de una guía privada y no se adoptó.

## Versiones del modelo

`VERSION_MODELO` en `motor.ts` sube cada vez que cambia el cálculo:

| Versión | Cambio |
|---|---|
| `forraje-eur-2` | Condición por día. |
| `forraje-eur-3` | Conteo desde el alta y clima histórico. |
| `forraje-eur-4` | Interpolación entre imágenes y error de reinicio por tipo. |
| `forraje-eur-5` | Rebrote modelado, relleno retroactivo, etapa, progreso y confianza por día. |
| `forraje-eur-6` | Pasto en pie desde las mediciones de altura, con su error. |
| `forraje-eur-7` | Pasto para comer sobre el remanente objetivo. |
| `forraje-8` | Sin crecimiento diario por EUR ni NDVI: el pasto en pie vale sólo el día de la medición. |

## En la ficha

`src/components/EstimacionForrajePanel.tsx`:

- la condición de hoy y de los días con pronóstico;
- "Rebrote y pasto en pie": la ventana de reingreso, el progreso del rebrote, el pasto en pie medido hoy con su margen y el sesgo de la fuente (o la última medición con su fecha), y el pasto para comer o su motivo;
- los avisos y las aclaraciones, en círculos que se abren al pasar el cursor o al tocarlos (`ui/AvisoInfo.tsx`: amarillo con "!" para lo que hay que tener en cuenta, gris con "i" para aclaraciones), y "Cómo se calcula", plegado, con cada parámetro, su valor y su fuente. Contado desde el alta, el porcentaje del rebrote no se muestra: un número bajo ahí sólo significa que falta el último pastoreo;
- "Mediciones de altura" (`MedicionesAlturaPanel.tsx`), para cargar, corregir y borrar con los permisos de los usos.

## Pendiente

- Correr `clima:historico --escribir`. Sólo agrega observaciones, no pisa ni borra.
- Correr las integraciones, siempre contra una base descartable: vacían las tablas.
- Ecuaciones de plato y regla para festuca y agropiro, a conseguir de INTA Balcarce.
- Una fuente para la altura de remanente objetivo por especie e instrumento.
- Revisión agronómica de todo este documento, en especial las decisiones marcadas "a revisar".
- Validación con datos de campo de lotes reales: fechas de pastoreo y estado de las hojas.
- Criterio de reingreso para alfalfa en tiempo térmico.
- Cargar el tipo de pastura, los usos y mediciones de los lotes reales para ver la estimación con datos.

## Fuentes

- Berone, G. D.; Recavarren, P. M.; Marino, M. A. (2021). *Visión Rural* 27(137): 24-27. https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/9704
- Ojeda, J. J.; Quinodoz, J. E.; Lezana, L. C. (2021). Estimación de disponibilidad forrajera de pasturas base alfalfa y verdeos invernales en el sudoeste de Entre Ríos. *RIA* 47(1): 26-45, INTA. https://www.redalyc.org/journal/864/86468100002/86468100002.pdf
- Laplacette, Berone, Utsumi, Cicore, Marino, Errecart e Insua. Calibración de plato y regla en festuca alta y agropiro alargado, EEA Balcarce, primavera 2021. Sólo resumen, sin ecuaciones: https://www.engormix.com/lecheria/manejo-pasturas/monitoreo-pasturas-calibracion-distintos_a52047/
- Agnusdei, M. G. (2013). *Archivos Latinoamericanos de Producción Animal* 21(1): 63-78.
- Open-Meteo: documentación de la API de pronóstico histórico y de precios. https://open-meteo.com/en/docs/historical-forecast-api · https://open-meteo.com/en/pricing
- Copernicus Data Space Ecosystem: unidades de procesamiento de Sentinel Hub. https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/ProcessingUnit.html

Usadas hasta `forraje-eur-7` para el crecimiento diario, que se sacó:

- Tommasino, A.; Castro, M.; Baldassini, P.; Cuitiño, M. J.; Paruelo, J. M. (2026). Dataset de PPNA, RFA absorbida y EUR de *Medicago sativa* y *Lolium arundinaceum*, Colonia, Uruguay, 2020-2021. https://zenodo.org/records/18874910
- Pellegrini, P. et al. (2020). *Crop Science* 60(3): 1607-1616. doi:10.1002/csc2.20129
- Monteith, J. L. (1972). *Journal of Applied Ecology* 9: 747-766.
