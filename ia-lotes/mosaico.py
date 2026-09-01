"""Arma el mosaico satelital del establecimiento y lo mantiene georreferenciado.

El microservicio no recibe imágenes: recibe el polígono del establecimiento y
baja por su cuenta los mismos tiles de Esri World Imagery que el mapa de RODEO
ya muestra en pantalla. Así lo que "ve" el modelo es exactamente la imagen
sobre la que el usuario dibujó su establecimiento.

La georreferenciación se resuelve con la fórmula cerrada de Web Mercator
(EPSG:3857, el esquema XYZ de siempre) en vez de rasterio/GDAL: son diez líneas
de trigonometría y evitan toda la cadena binaria geoespacial, que en Windows es
el principal motivo por el que estos entornos no arrancan.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO

import requests
from PIL import Image

LADO_TILE = 256
ZOOM_MINIMO = 10
DESCARGAS_EN_PARALELO = 8

# Tamaño al que se apunta para el lado largo del mosaico.
#
# No es un capricho: el modelo fue entrenado sobre tiles de 512x512 que
# contienen varios lotes cada uno, y rinde mucho mejor cuando la ventana de
# inferencia ve un puñado de lotes en vez de un pedazo de uno solo. Apuntar a
# ~768 px deja el establecimiento en poco más de una ventana, así que los lotes
# quedan en la escala que el modelo espera, sea el campo grande o chico.
#
# Medido sobre un campo de ~700 ha en Lincoln: buscando el máximo detalle
# (z16, 1399 px) el modelo encontraba 28 lotes y se salteaba todos los potreros
# de pasto; con esta regla (z15, 709 px) encuentra 37 y cubre casi todo.
LADO_OBJETIVO_MOSAICO = 768


class ErrorMosaico(RuntimeError):
    """El mosaico no se pudo armar: sin imagen, no hay sugerencia posible."""


@dataclass(frozen=True)
class Mosaico:
    """Imagen RGB del establecimiento más lo necesario para volver a lng/lat."""

    imagen: Image.Image
    zoom: int
    origen_x: float
    origen_y: float
    tiles: int

    def pixel_a_lnglat(self, x: float, y: float) -> tuple[float, float]:
        return pixel_a_lnglat(self.origen_x + x, self.origen_y + y, self.zoom)

    @property
    def metros_por_pixel(self) -> float:
        """Resolución aproximada en el centro del mosaico, para reportarla."""
        _, latitud = self.pixel_a_lnglat(self.imagen.width / 2, self.imagen.height / 2)
        return 156543.03392 * math.cos(math.radians(latitud)) / (2**self.zoom)


def lnglat_a_pixel(lng: float, lat: float, zoom: float) -> tuple[float, float]:
    lado_mundo = LADO_TILE * (2**zoom)
    x = (lng + 180.0) / 360.0 * lado_mundo
    seno = math.sin(math.radians(max(min(lat, 85.05112878), -85.05112878)))
    y = (0.5 - math.log((1 + seno) / (1 - seno)) / (4 * math.pi)) * lado_mundo
    return x, y


def pixel_a_lnglat(x: float, y: float, zoom: float) -> tuple[float, float]:
    lado_mundo = LADO_TILE * (2**zoom)
    lng = x / lado_mundo * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / lado_mundo))))
    return lng, lat


def bbox_de_anillo(anillo: list[list[float]]) -> tuple[float, float, float, float]:
    lngs = [punto[0] for punto in anillo]
    lats = [punto[1] for punto in anillo]
    return min(lngs), min(lats), max(lngs), max(lats)


def lado_del_mosaico(bbox: tuple[float, float, float, float], zoom: int) -> float:
    """Lado más largo, en píxeles, que tendría el mosaico en ese zoom."""
    x0, y0 = lnglat_a_pixel(bbox[0], bbox[3], zoom)
    x1, y1 = lnglat_a_pixel(bbox[2], bbox[1], zoom)
    return max(x1 - x0, y1 - y0)


def elegir_zoom(
    bbox: tuple[float, float, float, float],
    zoom_maximo: int,
    pixeles_maximos: int,
    lado_objetivo: int = LADO_OBJETIVO_MOSAICO,
) -> int:
    """El zoom que deja el mosaico más cerca del tamaño que el modelo prefiere.

    Deliberadamente **no** busca el máximo detalle disponible: a más zoom, cada
    ventana de inferencia ve un pedazo de un solo lote y el modelo deja de
    reconocer parcelas. El presupuesto de píxeles sigue siendo un techo duro
    para no bajar imágenes enormes.
    """
    elegido = ZOOM_MINIMO
    mejor_distancia: float | None = None
    for zoom in range(ZOOM_MINIMO, zoom_maximo + 1):
        lado = lado_del_mosaico(bbox, zoom)
        if lado > pixeles_maximos:
            break  # el lado sólo crece con el zoom: de acá en más, todos se pasan
        distancia = abs(lado - lado_objetivo)
        if mejor_distancia is None or distancia < mejor_distancia:
            elegido, mejor_distancia = zoom, distancia
    return elegido


def tiles_estimados(bbox: tuple[float, float, float, float], zoom: int) -> int:
    """Cuántos tiles haría falta bajar para cubrir el bbox en ese zoom."""
    x0, y0 = lnglat_a_pixel(bbox[0], bbox[3], zoom)
    x1, y1 = lnglat_a_pixel(bbox[2], bbox[1], zoom)
    columnas = int(x1 // LADO_TILE) - int(x0 // LADO_TILE) + 1
    filas = int(y1 // LADO_TILE) - int(y0 // LADO_TILE) + 1
    return columnas * filas


def escalas_de_zoom(
    bbox: tuple[float, float, float, float],
    zoom_base: int,
    cantidad: int,
    zoom_maximo: int,
    pixeles_maximos: int,
    tiles_maximos: int,
) -> list[int]:
    """Los zooms a los que mirar el campo, alrededor del elegido.

    Una sola escala se queda corta: en la fina aparecen los cuadros chicos y en
    la gruesa los potreros grandes que la fina ni registra. Se ordenan por
    cercanía al zoom base y se descartan los que no entren en los límites, así
    un campo grande simplemente usa menos escalas en vez de fallar.
    """
    desplazamientos = [0]
    paso = 1
    while len(desplazamientos) < cantidad:
        desplazamientos.append(-paso)
        if len(desplazamientos) < cantidad:
            desplazamientos.append(paso)
        paso += 1

    zooms: list[int] = []
    for desplazamiento in desplazamientos:
        zoom = zoom_base + desplazamiento
        if zoom < ZOOM_MINIMO or zoom > zoom_maximo:
            continue
        if lado_del_mosaico(bbox, zoom) > pixeles_maximos:
            continue
        if tiles_estimados(bbox, zoom) > tiles_maximos:
            continue
        zooms.append(zoom)
    return sorted(set(zooms))


def _bajar_tile(sesion: requests.Session, url: str, timeout: int) -> Image.Image:
    respuesta = sesion.get(url, timeout=timeout)
    if respuesta.status_code != 200:
        raise ErrorMosaico(f"El servidor de imágenes respondió {respuesta.status_code} para {url}.")
    try:
        return Image.open(BytesIO(respuesta.content)).convert("RGB")
    except Exception as error:  # noqa: BLE001 - cualquier fallo de decodificación es el mismo problema
        raise ErrorMosaico(f"El tile {url} no es una imagen válida.") from error


def armar_mosaico(
    anillo: list[list[float]],
    *,
    url_tiles: str,
    zoom: int,
    tiles_maximos: int,
    user_agent: str,
    timeout_tile: int,
) -> Mosaico:
    """Descarga y pega los tiles que cubren el polígono, en el zoom pedido."""
    minlng, minlat, maxlng, maxlat = bbox_de_anillo(anillo)
    x_izq, y_arr = lnglat_a_pixel(minlng, maxlat, zoom)
    x_der, y_aba = lnglat_a_pixel(maxlng, minlat, zoom)

    tile_x0, tile_y0 = int(x_izq // LADO_TILE), int(y_arr // LADO_TILE)
    tile_x1, tile_y1 = int(x_der // LADO_TILE), int(y_aba // LADO_TILE)
    columnas, filas = tile_x1 - tile_x0 + 1, tile_y1 - tile_y0 + 1
    if columnas * filas > tiles_maximos:
        raise ErrorMosaico(
            f"El establecimiento necesita {columnas * filas} tiles y el límite es {tiles_maximos}. "
            "Bajá IA_LOTES_ZOOM_MAXIMO o subí IA_LOTES_TILES_MAXIMOS."
        )

    sesion = requests.Session()
    sesion.headers.update({"User-Agent": user_agent})
    coordenadas = [(columna, fila) for fila in range(filas) for columna in range(columnas)]

    def tarea(coordenada: tuple[int, int]) -> tuple[tuple[int, int], Image.Image]:
        columna, fila = coordenada
        url = url_tiles.format(z=zoom, x=tile_x0 + columna, y=tile_y0 + fila)
        return coordenada, _bajar_tile(sesion, url, timeout_tile)

    lienzo = Image.new("RGB", (columnas * LADO_TILE, filas * LADO_TILE))
    try:
        with ThreadPoolExecutor(max_workers=DESCARGAS_EN_PARALELO) as pool:
            for (columna, fila), tile in pool.map(tarea, coordenadas):
                lienzo.paste(tile, (columna * LADO_TILE, fila * LADO_TILE))
    except requests.RequestException as error:
        raise ErrorMosaico(f"No se pudo descargar la imagen satelital ({error}).") from error
    finally:
        sesion.close()

    # Recorte fino al bbox del polígono: el modelo no necesita ver el sobrante
    # de los tiles del borde y cada píxel de más es tiempo de cómputo.
    origen_x, origen_y = tile_x0 * LADO_TILE, tile_y0 * LADO_TILE
    caja = (
        max(0, int(x_izq - origen_x)),
        max(0, int(y_arr - origen_y)),
        min(lienzo.width, math.ceil(x_der - origen_x)),
        min(lienzo.height, math.ceil(y_aba - origen_y)),
    )
    recorte = lienzo.crop(caja)
    return Mosaico(
        imagen=recorte,
        zoom=zoom,
        origen_x=origen_x + caja[0],
        origen_y=origen_y + caja[1],
        tiles=columnas * filas,
    )
