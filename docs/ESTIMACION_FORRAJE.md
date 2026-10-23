# Estimación diaria de forraje

**Estado al 22/10/2026:** destrabado por el equipo. Implementado en local:

- tipo de pastura y fecha de siembra;
- parámetros con fuente;
- motor;
- endpoint `GET …/lotes/:id/estimacion` (ver `docs/API_CONTRACTS.md`).

La ficha muestra la condición para pastorear de hoy, la de los días con pronóstico y el gráfico de crecimiento (`src/components/EstimacionForrajePanel.tsx`). Las migraciones 014, 015 y 016 están aplicadas en Neon `production` desde el 22/10/2026, y `db:verify` pasó. Si una base no tiene la 015, el backend sigue funcionando y la estimación lo informa. Al 22/10 ningún lote tiene cargado el tipo de pastura, así que todavía no hay estimaciones con datos reales.

Este documento está pensado para que lo revise un agrónomo. Todos los valores son **provisionales** hasta contrastarlos con cortes a campo en los lotes propios.

## Qué estima y qué no

Es un modelo determinístico con fórmulas publicadas. No es machine learning ni un modelo entrenado.

Estima **cuánto forraje se produjo** (kgMS/ha por día y acumulado desde la última imagen o el último pastoreo). **No** estima cuánto forraje hay en pie: para eso haría falta una calibración NDVI → kgMS/ha con cortes propios, que el proyecto no tiene.

El equipo había pensado en proyectar el NDVI hacia adelante. Se descartó porque ninguna fuente publica cuánto sube el NDVI por día según el clima. Ese coeficiente habría que ajustarlo con la historia de cada lote, y el clima completo recién se guarda desde el 20/10/2026 (migración 014).

### Fórmula de crecimiento

Es la lógica de eficiencia en el uso de la radiación (Monteith), la misma del seguimiento forrajero de LART-FAUBA:

```text
crecimiento (kgMS/ha/día) = EUR × fRFA(NDVI) × 0,48 × radiación global (MJ/m²/día) × 10
```

- **Radiación global:** `dias_clima.radiacion_mj_m2` (Open-Meteo `shortwave_radiation_sum`), real del centroide del lote.
- **0,48:** fracción fotosintéticamente activa de la radiación global.
- **fRFA:** fracción de esa radiación que absorbe el canopeo verde, estimada desde el NDVI de Sentinel-2.
- **EUR:** gramos de materia seca aérea por MJ absorbido, por pastura y estación.
- **× 10:** pasa de g/m² a kg/ha.

### Fecha de reingreso

Usa el criterio de **estado foliar óptimo** de INTA Balcarce: se vuelve a pastorear cuando el macollo alcanzó las hojas vivas que es capaz de mantener. Ese lapso es la vida media foliar, expresada en grados-día acumulados desde la salida de los animales.

```text
grados-día del día = max(0, (temp_min + temp_max) / 2 − temperatura base)
```

La fuente publica rangos. Para no dar una precisión falsa, el modelo informa una **fecha temprana** (temperatura base y vida media foliar en su mínimo) y una **fecha tardía** (ambas en su máximo).

### Condición para pastorear

El equipo pidió el 22/10/2026 que la ficha diga, para hoy y cada día con pronóstico, si el lote está **Perfecto para pastoreo**, **Regular**, en **Cuidado** o **No apto**. Sale del mismo conteo de grados-día del reingreso, así que necesita un pastoreo registrado y una pastura con criterio de estado foliar:

| Condición | Regla |
|---|---|
| No apto | Grados-día (base 2 °C) por debajo de la vida media foliar mínima menos un filocrono: falta más de una hoja. |
| Cuidado | Falta menos de una hoja: entre vida media mínima − filocrono máximo y la vida media mínima. |
| Perfecto para pastoreo | Desde la fecha temprana hasta la tardía, inclusive. |
| Regular | Después de la fecha tardía: la fuente indica que pasada la vida media foliar las hojas más viejas mueren. |

El umbral de "una hoja" usa el filocrono **máximo** de la tabla, para no adelantar el aviso. Es una decisión de diseño sobre los datos de la fuente, no un valor publicado. Con festuca a 12 °C constantes: no apto hasta el día 22, cuidado del 23 al 44, perfecto del 45 al 69 y regular desde el 70.

El NDVI no interviene en la etiqueta. No hay fuente que diga con qué NDVI un lote está listo, y un umbral propio sería un dato inventado. El NDVI sí determina el crecimiento en kgMS/ha que la ficha muestra al lado. Para alfalfa, mezclas y pastizal natural no hay etiqueta, porque no tienen criterio de reingreso con fuente.

Es una estimación rotulada, no un plan de rotación. La etiqueta no se persiste.

### Sin pastoreos registrados

Regla del equipo (22/10/2026): **si no hay un uso registrado, no hubo pastoreo**. Sin usos, el conteo de grados-día arranca en el alta del lote en RODEO (`lotes.created_at` en el calendario de Buenos Aires), contando ese día.

El resultado es un **mínimo**. El último pastoreo pudo ser antes del alta, así que el lote está como mínimo así de avanzado:
- la condición es un piso y se muestra "como mínimo";
- las fechas de la ventana son lo más tarde posible y se muestran "a más tardar";
- "Regular" sí es segura.

La respuesta lo marca con `reingreso.inicioConteo = 'alta'` y `esMinimo = true`. Si alguien pastorea sin registrarlo, la etiqueta queda mal; por eso la ficha aclara "sin pastoreo registrado desde…".

### Clima histórico

Cada consulta regular de Open-Meteo guarda sólo 7 días pasados, así que el clima de un lote empezaba el día de su primera consulta. Los días que faltan se completan con la **API de pronóstico histórico de Open-Meteo**, modelo `best_match`, en la tabla `clima_historico_lote` (migración 016). Es el mismo tipo de datos que la consulta regular. En el ensayo del 22/10, los días que se solapaban dieron valores idénticos de temperatura y radiación.

- Se completa desde el último pastoreo (o el alta) y, como mínimo, los 60 días del gráfico. No se va más de 366 días atrás.
- Un día cuenta como cubierto si una consulta regular lo trajo observado con temperatura y radiación. Un día ya guardado no se reescribe.
- Prioridad para cada variable: observado de la consulta regular, después el histórico, después el pronóstico.
- Lo completan la actualización programada (40 lotes por corrida) y la actualización manual del clima, con un presupuesto de 15 s. Para una carga completa existe `npm run clima:historico`.
- La primera carga, del 22/10/2026, guardó 7628 días para 132 lotes sin errores.

## Reglas del motor (fase B)

El motor vive en `backend/src/estimacion/motor.ts` y `clima.ts`. Son funciones puras que leen lo persistido y no escriben nada. Lleva la versión `VERSION_MODELO = 'forraje-eur-3'`. La 2 agregó la condición por día; la 3, el conteo desde el alta y el clima histórico.

- **Imágenes:** sólo Sentinel-2 con `cobertura_valida ≥ 0,6` (`COBERTURA_MINIMA_ESTIMACION`) y NDVI mediano presente. Sentinel-1 no entra.
- **NDVI de cada día:** el de la última imagen válida. Ese día se marca "observado"; los siguientes, "proyectado" con los días desde la imagen. Se arrastra como máximo 30 días (`MAXIMO_DIAS_SIN_IMAGEN`). Es una decisión de diseño, no un dato agronómico: alcanza para los 16 días de pronóstico después de una imagen de dos semanas.
- **Clima de cada día:** para cada variable, el valor observado de la consulta más reciente; si no hay, el pronóstico más reciente. Se marca cuál se usó. Se elige variable por variable porque las filas anteriores a la 014 tienen temperatura pero no radiación.
- **Pastoreos:** el período del uso es "en-pastoreo", sin valor. Hoy sólo existe la fecha de entrada, así que es un único día. Después, el día queda "sin dato" hasta la próxima imagen válida: el NDVI previo al pastoreo sobrestimaría el crecimiento.
- **Acumulado:** kgMS/ha producidos desde el ancla. El ancla es el último pastoreo si hay datos continuos desde entonces; si no, el primer día con datos de la ventana ("inicio") o el primer día después de un hueco ("reanudación"). No es la biomasa en pie.
- **Error de reinicio:** cuando llega una imagen nueva y no hubo un pastoreo en el medio, se informa el NDVI supuesto menos el observado. Sirve para evaluar el arrastre y no se persiste.
- **Horizonte:** nada se extiende más allá del último día con clima guardado.
- **Reingreso:** suma grados-día desde el día siguiente al último pastoreo. La fecha temprana usa temperatura base 2 °C hasta el mínimo de vida media foliar; la tardía, base 4 °C hasta el máximo. Si falta un día de temperatura, la cuenta se corta y lo dice. Si no se alcanza, la fecha queda `null` con "no alcanza … dentro de los N días con pronóstico".
- **Resultado del pastoreo:** con las jornadas (migración 017), `fechaSalida` es el día de la salida registrada. Con la jornada abierta es hoy, así que hoy no hay condición ("Con animales"). Los usos viejos, sin hora, siguen siendo un único día. La altura del remanente y la cantidad de animales se registran, pero este modelo no los usa: calcularían biomasa en pie, que no estima.

## Parámetros generales

| Parámetro | Valor | Fuente | Observaciones |
|---|---|---|---|
| fRFA desde NDVI | `0,013 × e^(4,48 × NDVI)`, tope 0,95 | Pellegrini et al. (2020), *Crop Science* 60: 1607-1616. Ecuación en la tesis doctoral de Pellegrini (FAUBA, 2024), Cuadro 2.5 | Medida a campo con NDVI de Sentinel-2 a 10 m en trigo del sudoeste pampeano: R² 0,89, n 158, RMSD 0,09. Se aplica a pasturas, como hicieron Tommasino et al. El tope de 0,95 es la convención de Potter et al. (1993) que usa Grigera et al. (2007); con esta curva sólo actúa con NDVI > 0,96. |
| Fracción RFA | 0,48 | Monteith (1972) | Mismo factor que usan Maidana (2021, FAUBA) y Tommasino et al. (2026). |

## Parámetros por pastura

### EUR (g MS / MJ RFA absorbida)

| Pastura | Verano | Otoño | Invierno | Primavera | Fuente |
|---|---|---|---|---|---|
| Alfalfa | 0,53 | 0,82 | 0,66 | 0,92 | Tommasino et al. (2026), dataset Zenodo 18874910 |
| Festuca alta | 0,29 | 0,83 | 0,59 | 1,06 | Ídem |
| Mezcla alfalfa con gramíneas | — | — | — | — | Sin fuente verificada |
| Raigrás anual y perenne, agropiro, pasto ovillo, cebadilla, avena | — | — | — | — | Sin fuente verificada |
| Pastizal natural | — | — | — | — | Sin fuente comparable (ver abajo) |

**Cómo se obtuvieron las EUR de alfalfa y festuca.** El dataset publica, para cada parcela y cada ciclo de rebrote entre cortes, la producción (g MS/m²) y la radiación absorbida (MJ/m²). Son ensayos en Colonia, Uruguay, de 2020-2021. Cada ciclo se asignó a la estación de su punto medio (verano: diciembre a febrero) y se calculó **suma de producción / suma de radiación absorbida** por estación.

- Alfalfa: 20 ciclos × 15 parcelas.
- Festuca: 9 ciclos × 15 parcelas. Verano e invierno salen de sólo dos ciclos largos cada uno.

El dataset calcula la fRFA con la ecuación de Pellegrini, la misma que usa este modelo. Como la EUR se expresa por MJ realmente absorbido, sería transferible aunque la fRFA se hubiera estimado con otro sensor validado contra mediciones de campo.

**Por qué el pastizal natural queda sin EUR.** Los valores publicados para pastizales del Río de la Plata (Grigera et al. 2007; Baeza et al. 2011) se calcularon con fRFA de MODIS a 250 m y la fórmula de Potter. Combinarlos con la fRFA de Sentinel-2 mezclaría dos estimadores distintos y sesgaría el resultado.

**Mezclas.** La EUR de una mezcla depende de su composición. INTA Balcarce midió mezclas alfalfa-festuca (repositorio INTA 20.500.12123/11882), pero no se pudieron verificar los valores, y no se promedian las especies puras.

### Criterio de reingreso (estado foliar óptimo)

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

## Qué pasa cuando falta algo

Cada parte responde por separado:

- **Sin tipo de pastura:** no hay estimación; la ficha dice "Sin tipo de pastura".
- **Sin EUR:** no hay curva de crecimiento, pero el reingreso puede estimarse igual si hay criterio. Ejemplo: raigrás anual.
- **Sin criterio de reingreso:** hay curva, pero no fecha de reingreso. Ejemplo: alfalfa.
- **Faltan las dos:** el lote responde "sin parámetros" y explica qué falta.

Nunca se toma prestado un valor de otra especie ni se rellena con un supuesto silencioso.

## Pendiente

- Revisión agronómica de esta tabla.
- Calibración con cortes a campo en los lotes propios.
- EUR para las pasturas que quedaron sin fuente.
- Criterio de reingreso para alfalfa en tiempo térmico.
- Cargar el tipo de pastura y los usos de los lotes reales para ver la estimación con datos.

## Fuentes

- Pellegrini, P. et al. (2020). *Crop Science* 60(3): 1607-1616. doi:10.1002/csc2.20129
- Pellegrini, P. (2024). *Estimación y predicción del rendimiento de trigo a nivel regional mediante modelos de captura y eficiencia de uso de la radiación.* Tesis doctoral, FAUBA. https://ri.agro.uba.ar/files/download/tesis/doctorado/2025pellegrinipedro.pdf
- Tommasino, A.; Castro, M.; Baldassini, P.; Cuitiño, M. J.; Paruelo, J. M. (2026). Dataset de PPNA, RFA absorbida y EUR de *Medicago sativa* y *Lolium arundinaceum*, Colonia, Uruguay, 2020-2021. https://zenodo.org/records/18874910
- Berone, G. D.; Recavarren, P. M.; Marino, M. A. (2021). *Visión Rural* 27(137): 24-27. https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/9704
- Grigera, G.; Oesterheld, M.; Pacín, F. (2007). Monitoring forage production for farmers' decision making. *Agricultural Systems* 94: 637-648.
- Oyarzabal, M.; Oesterheld, M.; Grigera, G. *Seguimiento satelital del forraje. Bases y aplicaciones.* Aves Argentinas, Fundación Vida Silvestre.
- Maidana, C. E. (2021). Tesis de especialización, FAUBA.
- Monteith, J. L. (1972). *Journal of Applied Ecology* 9: 747-766.
- Potter, C. S. et al. (1993). *Global Biogeochemical Cycles* 7: 811-841.
