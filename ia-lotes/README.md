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
- ~3 GB de disco entre las dependencias (torch se lleva la mayor parte) y los
  pesos del modelo.
- Internet en la primera corrida, para bajar los pesos.
- **CPU alcanza**, incluso con `DelineateAnythingv2.pt`, que es el default:
  medido en ~14 s para un campo de 760 ha con las tres escalas. La GPU sólo
  hace falta si querés bajar de eso.

No hace falta conda ni GDAL: la georreferenciación se resuelve con la fórmula
de Web Mercator en `mosaico.py`, así que no entra rasterio en la ecuación.

## ¿Local o en un servidor?

Las dos cosas funcionan sin cambiar una línea de código: `IA_LOTES_URL` puede
apuntar a `localhost` o a cualquier host.

Corriéndolo en un servidor, quien clona el repo no instala Python ni torch, y
una máquina modesta anda igual porque la inferencia deja de ser suya. Hay un
`Dockerfile` acá al lado para eso; el detalle de despliegue, arranques en frío
y concurrencia está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

Lo que sigue es la instalación **local**, para desarrollar o para no depender
de un servidor.

## Arrancar en otra máquina

Del microservicio, el repo trae **sólo el código**. Están en `.gitignore` y hay
que rehacerlos en cada máquina:

| no viaja con el repo | cómo se resuelve |
| --- | --- |
| `ia-lotes/.venv/` | se crea con los pasos de Instalación |
| `ia-lotes/.env` | se copia de `.env.example` |
| `backend/.env` | se copia de `backend/.env.example` y se completa |
| los pesos `.pt` | se bajan solos de Hugging Face en la primera corrida |

Checklist completo, desde un clon limpio:

```powershell
# 0. Python, si la máquina no lo tiene. Ojo: en Windows el comando `python`
#    suele existir como atajo a la Microsoft Store y no es un Python real.
#    Con winget entra en el perfil del usuario, sin permisos de administrador:
winget install -e --id Python.Python.3.12 --scope user
#    Si después de instalarlo `python` sigue abriendo la Store, cerrá y abrí la
#    terminal, o usá la ruta directa:
#    $env:LOCALAPPDATA\Programs\Python\Python312\python.exe

# 1. dependencias del microservicio
cd ia-lotes
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. su configuración
Copy-Item .env.example .env

# 3. avisarle al backend que existe (en backend/.env)
#    IA_LOTES_URL=http://localhost:8001

# 4. levantarlo (la primera vez baja los pesos, tarda unos minutos)
python -m uvicorn app:app --port 8001
```

Y en otra terminal, el backend y el frontend como siempre. Recién con
`IA_LOTES_URL` cargada aparece el botón "Subdividir con IA".

**El error más fácil de cometer es el token.** `IA_LOTES_TOKEN` tiene que ser
el mismo en `ia-lotes/.env` y en `backend/.env`. Si el microservicio tiene uno
y el backend no lo manda, todas las consultas vuelven 401; al revés no falla,
porque un token vacío en el microservicio acepta cualquier llamada. Para correr
en localhost lo más simple es dejarlo vacío en los dos lados.

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

Con el entorno activado, desde `ia-lotes/`:

```powershell
python -m uvicorn app:app --port 8001
```

Sin activar el entorno, apuntando al intérprete del venv:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --port 8001
```

Sin `IA_LOTES_URL` en `backend/.env`, el botón "Subdividir con IA" no aparece y
RODEO funciona igual que antes: la función es opcional y su ausencia no rompe
nada.

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
