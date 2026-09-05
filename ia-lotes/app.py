"""Microservicio de sugerencia de subdivisión en lotes.

Sólo lo llama el backend Express, nunca el navegador: recibe el polígono del
establecimiento, baja la imagen satelital, corre Delineate Anything y devuelve
los límites detectados como GeoJSON en EPSG:4326.

Este servicio no sabe qué es un usuario ni toca la base de datos. No persiste
nada: propone. La validación de pertenencia, el recorte contra el
establecimiento y el guardado son responsabilidad de Express, igual que con
Copernicus y Open-Meteo.
"""

from __future__ import annotations

import hmac
import logging
import math
import threading
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from configuracion import cargar_configuracion
from modelo import DetectorLotes, ErrorModelo
from mosaico import ErrorMosaico, armar_mosaico, bbox_de_anillo, elegir_zoom, escalas_de_zoom

configuracion = cargar_configuracion()
detector = DetectorLotes(configuracion)
candado_inferencia = threading.Lock()
registro = logging.getLogger("ia-lotes")

if not configuracion.token:
    # En localhost es cómodo; publicado en un servidor es una puerta abierta a
    # que cualquiera gaste tu CPU. Avisar fuerte en vez de fallar: hay
    # instalaciones locales legítimas sin token.
    registro.warning(
        "IA_LOTES_TOKEN vacío: el microservicio acepta cualquier llamada. "
        "Aceptable sólo en localhost. Si esto está expuesto en un servidor, "
        "configurá el mismo token acá y en backend/.env."
    )

app = FastAPI(title="RODEO · sugerencia de lotes", version="0.1.0")


class SolicitudSegmentar(BaseModel):
    polygon: dict
    zoom: int | None = Field(default=None, ge=10, le=19)


def _verificar_token(token_recibido: str | None) -> None:
    if not configuracion.token:
        return
    if not token_recibido or not hmac.compare_digest(token_recibido, configuracion.token):
        raise HTTPException(status_code=401, detail="Token del microservicio inválido.")


def _anillo_exterior(polygon: dict) -> list[list[float]]:
    """Valida el Feature<Polygon> de entrada y devuelve su anillo exterior."""
    if not isinstance(polygon, dict) or polygon.get("type") != "Feature":
        raise HTTPException(status_code=400, detail="polygon debe ser un GeoJSON Feature.")
    geometria = polygon.get("geometry")
    if not isinstance(geometria, dict) or geometria.get("type") != "Polygon":
        raise HTTPException(status_code=400, detail="La geometría debe ser un Polygon.")
    coordenadas = geometria.get("coordinates")
    if not isinstance(coordenadas, list) or not coordenadas:
        raise HTTPException(status_code=400, detail="El Polygon no tiene coordenadas.")
    anillo = coordenadas[0]
    if not isinstance(anillo, list) or len(anillo) < 4:
        raise HTTPException(status_code=400, detail="El anillo exterior necesita al menos 4 puntos.")
    for punto in anillo:
        if (
            not isinstance(punto, (list, tuple))
            or len(punto) < 2
            or not all(isinstance(valor, (int, float)) and math.isfinite(valor) for valor in punto[:2])
        ):
            raise HTTPException(status_code=400, detail="El anillo tiene puntos inválidos.")
        if not -180 <= punto[0] <= 180 or not -85.05 <= punto[1] <= 85.05:
            raise HTTPException(status_code=400, detail="Las coordenadas deben ser lng/lat válidas.")
    return [[float(punto[0]), float(punto[1])] for punto in anillo]


@app.get("/salud")
def salud() -> dict:
    return {
        "ok": True,
        "modelo": detector.descripcion,
        "dispositivo": detector.dispositivo,
        "cargado": detector.cargado,
    }


@app.post("/segmentar")
def segmentar(solicitud: SolicitudSegmentar, x_ia_token: str | None = Header(default=None)) -> dict:
    _verificar_token(x_ia_token)
    anillo = _anillo_exterior(solicitud.polygon)
    comenzo = time.monotonic()

    bbox = bbox_de_anillo(anillo)
    if solicitud.zoom:
        zooms = [solicitud.zoom]
    else:
        base = elegir_zoom(bbox, configuracion.zoom_maximo, configuracion.pixeles_maximos)
        zooms = escalas_de_zoom(
            bbox,
            base,
            configuracion.escalas,
            configuracion.zoom_maximo,
            configuracion.pixeles_maximos,
            configuracion.tiles_maximos,
        )

    try:
        mosaicos = [
            armar_mosaico(
                anillo,
                url_tiles=configuracion.url_tiles,
                zoom=zoom,
                tiles_maximos=configuracion.tiles_maximos,
                user_agent=configuracion.user_agent,
                timeout_tile=configuracion.timeout_tile,
            )
            for zoom in zooms
        ]
    except ErrorMosaico as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    try:
        with candado_inferencia:
            detectados = detector.detectar(mosaicos)
    except ErrorModelo as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    # La escala de referencia para reportar es la del zoom base, la del medio.
    mosaico = mosaicos[len(mosaicos) // 2]

    return {
        "poligonos": [
            {
                "type": "Feature",
                "properties": {"confianza": deteccion["confianza"], "origen": "delineate-anything"},
                "geometry": {"type": "Polygon", "coordinates": [deteccion["anillo"]]},
            }
            for deteccion in detectados
        ],
        "meta": {
            "modelo": detector.descripcion,
            "dispositivo": detector.dispositivo,
            "zoom": mosaico.zoom,
            "zooms": zooms,
            "tiles": sum(item.tiles for item in mosaicos),
            "ancho": mosaico.imagen.width,
            "alto": mosaico.imagen.height,
            "metrosPorPixel": round(mosaico.metros_por_pixel, 3),
            "detectadas": len(detectados),
            "segundos": round(time.monotonic() - comenzo, 2),
        },
    }
