# Microservicio de sugerencia de lotes

Corre [Delineate Anything](https://github.com/Lavreniuk/Delineate-Anything) sobre
la imagen satelital del establecimiento y devuelve los límites de lote que
detecta, como GeoJSON en EPSG:4326.

No es parte del backend Node: es un proceso Python aparte, en otro puerto,
porque el modelo es PyTorch y no corre dentro de Express. Sólo lo llama Express;
el navegador nunca lo ve.

**No es un modelo entrenado por nosotros.** Son los pesos publicados por los
autores, entrenados sobre el dataset FBIS de límites de parcelas agrícolas
reales. Acá sólo se corre inferencia.

## Requisitos

- Python 3.10 o más nuevo.
- ~2 GB de disco entre las dependencias y los pesos.
- CPU alcanza con `DelineateAnything-S.pt`. Los checkpoints grandes piden GPU
  para no tardar minutos por ventana.

No hace falta conda ni GDAL: la georreferenciación se resuelve con la fórmula
de Web Mercator en `mosaico.py`, así que no entra rasterio en la ecuación.

## Instalación

```powershell
cd ia-lotes
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

En Linux/macOS el activado es `source .venv/bin/activate`.

La primera corrida descarga los pesos desde Hugging Face
(`MykolaL/DelineateAnything`) y los cachea. Si preferís bajarlos a mano, apuntá
`IA_LOTES_PESOS_LOCALES` al `.pt`.

## Configuración

Copiá `.env.example` a `.env`: el servicio lo lee solo al arrancar (lo que ya
esté exportado en el entorno gana). Todas las variables tienen default salvo
`IA_LOTES_TOKEN`, que conviene setear y hacer coincidir con el `IA_LOTES_TOKEN`
de `backend/.env`.

## Levantarlo

```powershell
uvicorn app:app --port 8001
```

Y en `backend/.env`:

```
IA_LOTES_URL=http://localhost:8001
IA_LOTES_TOKEN=<el mismo token>
```

Sin `IA_LOTES_URL`, el botón "Subdividir con IA" no aparece y RODEO funciona
igual que antes.

## Endpoints

- `GET /salud`: estado del proceso y qué pesos tiene cargados.
- `POST /segmentar`: recibe `{ "polygon": Feature<Polygon>, "zoom": 17 }` (el
  zoom es opcional) y devuelve `{ "poligonos": [...], "meta": {...} }`.

## Comprobar que anda

```powershell
.\.venv\Scripts\python.exe verificar_mosaico.py     # georreferenciación, sin red ni modelo
.\.venv\Scripts\python.exe depurar_deteccion.py     # guarda deteccion.png para mirarla
curl http://127.0.0.1:8001/salud
```

`depurar_deteccion.py` dibuja los contornos detectados sobre la misma imagen
que vio el modelo. Es la herramienta de calibración: acepta `--pesos`,
`--ventana`, `--conf`, `--iou`, `--zoom` y `--bbox` para comparar
configuraciones, y sin ella ajustar parámetros es adivinar.

Referencia medida en CPU (Python 3.12, torch 2.13), campo de ~760 ha en
Lincoln: tres escalas (z14, z15, z16), 63 polígonos en ~14 s con el modelo ya
en memoria. Con una sola escala son 41 en ~7 s.

## Por qué el zoom no se maximiza

El modelo fue entrenado con tiles de 512x512 que contienen **varios lotes cada
uno**. Si se le da máximo detalle, cada ventana ve un pedazo de un solo lote y
deja de reconocer parcelas: sobre el campo de Lincoln, buscando el máximo
detalle encontraba 28 lotes y se salteaba todos los potreros de pasto; con la
escala correcta encuentra 41 y cubre casi todo. Por eso `elegir_zoom()` apunta
a un mosaico de ~768 px de lado en vez de al zoom más alto disponible.

Por lo mismo, subir `IA_LOTES_CONFIANZA` no "limpia ruido": pierde lotes.

## Cómo funciona

1. Del polígono sale el bbox y de ahí el zoom más detallado cuyo mosaico entre
   en el presupuesto de píxeles (`IA_LOTES_PIXELES_MAXIMOS`).
2. Se bajan los tiles de Esri World Imagery —los mismos que muestra el mapa de
   RODEO— y se pegan en una sola imagen.
3. El modelo la recorre en ventanas cuadradas solapadas. El solape evita perder
   los lotes que caen justo en el corte; las detecciones repetidas se resuelven
   quedándose con la más grande.
4. Los contornos en píxeles se convierten a lng/lat con la inversa de Web
   Mercator y se devuelven como Features.

Lo que este servicio **no** hace: no sabe qué es un usuario, no toca la base de
datos, no recorta contra el establecimiento y no guarda nada. Eso es todo
responsabilidad de Express (`backend/src/services/sugerencias-lotes.ts`).

## Licencia

Delineate Anything y Ultralytics son **AGPL-3.0**. Para un trabajo de facultad
no hay problema, pero tenelo presente si alguna vez se piensa distribuir RODEO
como producto cerrado: esa licencia es contagiosa sobre el software que la
integra. Mantener el modelo en un proceso separado, como está acá, deja esa
discusión acotada a esta carpeta.
