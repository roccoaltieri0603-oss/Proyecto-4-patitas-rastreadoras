"""Envoltorio de Delineate Anything, el modelo que propone los límites.

Delineate Anything (https://github.com/Lavreniuk/Delineate-Anything) es un
modelo de segmentación de instancias entrenado específicamente sobre límites de
parcelas agrícolas reales (dataset FBIS). No lo entrenamos nosotros: se
descargan los pesos publicados y se corre inferencia. Los pesos y el modelo
están bajo AGPL-3.0; ver README.md de esta carpeta.

Se corre por ventanas solapadas en vez de una sola pasada: el modelo trabaja
mejor sobre recortes del tamaño con el que fue entrenado que sobre un mosaico
entero reescalado, y el solape evita perder los lotes que caen justo en el
corte entre ventanas.

La ventana por defecto es de 512 px porque es el tamaño de tile con el que se
entrenó el modelo. Correrlo en 1024 lo degrada bastante: se saltea lotes
enteros. Y el zoom del mosaico se elige para que en esa ventana entren varios
lotes, no para maximizar el detalle (ver `LADO_OBJETIVO_MOSAICO` en mosaico.py).
"""

from __future__ import annotations

import threading
from collections.abc import Sequence

import numpy as np
from PIL import Image
from shapely.geometry import Polygon
from shapely.validation import make_valid

from configuracion import REPO_HUGGINGFACE, Configuracion
from mosaico import Mosaico

# Sólo para descartar manchas degeneradas: el filtro por superficie de verdad
# lo hace Express, que sabe cuántos m² es cada polígono (`sugerencias-lotes.ts`).
AREA_MINIMA_PIXELES = 100.0
# Un píxel de tolerancia. Más que eso empieza a recortar esquinas reales del
# lote; a la resolución de trabajo son unos pocos metros.
TOLERANCIA_SIMPLIFICADO_PIXELES = 1.0
SOLAPE_PARA_DESCARTAR = 0.5


class ErrorModelo(RuntimeError):
    """El modelo no está disponible o falló: sin resultado, no hay sugerencia."""


class DetectorLotes:
    """Carga perezosa del modelo y detección sobre un mosaico georreferenciado."""

    def __init__(self, configuracion: Configuracion) -> None:
        self._configuracion = configuracion
        self._modelo = None
        self._dispositivo: str | None = None
        self._candado = threading.Lock()

    @property
    def descripcion(self) -> str:
        return self._configuracion.pesos_locales or f"{REPO_HUGGINGFACE}/{self._configuracion.pesos}"

    @property
    def dispositivo(self) -> str | None:
        return self._dispositivo

    @property
    def cargado(self) -> bool:
        return self._modelo is not None

    def cargar(self) -> None:
        """Descarga los pesos (una sola vez) y deja el modelo listo en memoria."""
        if self._modelo is not None:
            return
        with self._candado:
            if self._modelo is not None:
                return
            try:
                import torch
                from ultralytics import YOLO
            except ImportError as error:
                raise ErrorModelo(
                    "Faltan dependencias del modelo. Instalá ia-lotes/requirements.txt."
                ) from error

            if self._configuracion.pesos_locales:
                ruta = self._configuracion.pesos_locales
            else:
                try:
                    from huggingface_hub import hf_hub_download

                    ruta = hf_hub_download(repo_id=REPO_HUGGINGFACE, filename=self._configuracion.pesos)
                except Exception as error:  # noqa: BLE001 - red, permisos o repo caído dan el mismo síntoma
                    raise ErrorModelo(
                        f"No se pudieron obtener los pesos {self._configuracion.pesos} desde Hugging Face ({error})."
                    ) from error

            pedido = self._configuracion.dispositivo
            dispositivo = ("cuda" if torch.cuda.is_available() else "cpu") if pedido == "auto" else pedido
            if dispositivo == "cuda" and not torch.cuda.is_available():
                raise ErrorModelo("Se pidió IA_LOTES_DISPOSITIVO=cuda pero torch no ve ninguna GPU.")

            try:
                self._modelo = YOLO(ruta)
            except Exception as error:  # noqa: BLE001 - pesos corruptos o incompatibles
                raise ErrorModelo(f"No se pudieron cargar los pesos del modelo ({error}).") from error
            self._dispositivo = dispositivo

    def detectar(self, mosaicos: Sequence[Mosaico]) -> list[dict]:
        """Detecta sobre uno o varios mosaicos del mismo campo y fusiona todo.

        Con varias escalas el modelo ve el campo de más de una manera: en la
        escala fina aparecen los cuadros chicos y en la gruesa los potreros
        grandes que la fina ni registra. La fusión se hace en lng/lat, que es el
        único espacio común entre mosaicos de distinto zoom.
        """
        self.cargar()
        candidatos: list[tuple[Polygon, float]] = []
        for mosaico in mosaicos:
            candidatos.extend(self._detectar_en_mosaico(mosaico))

        # De mayor a menor: ante la misma parcela vista en dos escalas, gana la
        # versión más completa y la otra se descarta por solape.
        candidatos.sort(key=lambda item: item[0].area, reverse=True)
        aceptadas: list[tuple[Polygon, float]] = []
        for poligono, confianza in candidatos:
            if any(_se_pisan(poligono, previo) for previo, _ in aceptadas):
                continue
            aceptadas.append((poligono, confianza))

        resultado = []
        for poligono, confianza in aceptadas:
            anillo = [[x, y] for x, y in poligono.exterior.coords]
            if len(anillo) < 4:
                continue
            resultado.append({"anillo": anillo, "confianza": round(confianza, 4)})
        return resultado

    def _detectar_en_mosaico(self, mosaico: Mosaico) -> list[tuple[Polygon, float]]:
        """Recorre un mosaico en ventanas y devuelve polígonos ya en lng/lat.

        El simplificado se hace acá, en píxeles, porque la tolerancia sólo tiene
        sentido contra la resolución de este mosaico en particular.
        """
        detecciones: list[tuple[Polygon, float]] = []
        for origen_x, origen_y, recorte in self._ventanas(mosaico.imagen):
            detecciones.extend(self._detectar_en_ventana(recorte, origen_x, origen_y))

        detecciones.sort(key=lambda item: item[0].area, reverse=True)
        aceptadas: list[tuple[Polygon, float]] = []
        for poligono, confianza in detecciones:
            if any(_se_pisan(poligono, previo) for previo, _ in aceptadas):
                continue
            aceptadas.append((poligono, confianza))

        en_grados: list[tuple[Polygon, float]] = []
        for poligono, confianza in aceptadas:
            simplificado = poligono.simplify(TOLERANCIA_SIMPLIFICADO_PIXELES, preserve_topology=True)
            if simplificado.is_empty or simplificado.geom_type != "Polygon":
                continue
            anillo = [mosaico.pixel_a_lnglat(x, y) for x, y in simplificado.exterior.coords]
            if len(anillo) < 4:
                continue
            convertido = _poligono_valido_en_grados(anillo)
            if convertido is not None:
                en_grados.append((convertido, confianza))
        return en_grados

    def _ventanas(self, imagen: Image.Image):
        """Recorre la imagen en ventanas cuadradas solapadas, sin salirse del borde."""
        lado = min(self._configuracion.lado_ventana, max(imagen.width, imagen.height))
        paso = max(1, int(lado * (1 - self._configuracion.solape)))
        for origen_y in _inicios(imagen.height, lado, paso):
            for origen_x in _inicios(imagen.width, lado, paso):
                caja = (origen_x, origen_y, min(origen_x + lado, imagen.width), min(origen_y + lado, imagen.height))
                yield origen_x, origen_y, imagen.crop(caja)

    def _detectar_en_ventana(self, recorte: Image.Image, origen_x: int, origen_y: int) -> list[tuple[Polygon, float]]:
        assert self._modelo is not None  # cargar() ya corrió
        try:
            salidas = self._modelo.predict(
                source=recorte,
                imgsz=self._configuracion.lado_ventana,
                conf=self._configuracion.confianza,
                iou=self._configuracion.iou,
                device=self._dispositivo,
                retina_masks=True,
                # Nada de `augment=True`: Ultralytics lo ignora para este modelo
                # ("Model does not support 'augment=True', reverting to
                # single-scale prediction") y queda una opción que no hace nada.
                # El aumento real de cobertura viene de las múltiples escalas.
                verbose=False,
            )
        except Exception as error:  # noqa: BLE001 - falta de memoria, tensores raros, etc.
            raise ErrorModelo(f"El modelo falló durante la inferencia ({error}).") from error

        encontrados: list[tuple[Polygon, float]] = []
        for salida in salidas:
            mascaras = getattr(salida, "masks", None)
            if mascaras is None:
                continue
            confianzas = _confianzas(salida, len(mascaras.xy))
            for indice, contorno in enumerate(mascaras.xy):
                poligono = _poligono_valido(np.asarray(contorno, dtype=float) + (origen_x, origen_y))
                if poligono is not None:
                    encontrados.append((poligono, confianzas[indice]))
        return encontrados


def _inicios(largo: int, lado: int, paso: int) -> list[int]:
    if largo <= lado:
        return [0]
    posiciones = list(range(0, largo - lado + 1, paso))
    if posiciones[-1] != largo - lado:
        posiciones.append(largo - lado)
    return posiciones


def _confianzas(salida, cantidad: int) -> list[float]:
    cajas = getattr(salida, "boxes", None)
    if cajas is None or cajas.conf is None:
        return [0.0] * cantidad
    valores = [float(valor) for valor in cajas.conf.tolist()]
    return valores if len(valores) == cantidad else (valores + [0.0] * cantidad)[:cantidad]


def _poligono_valido_en_grados(anillo: list[tuple[float, float]]) -> Polygon | None:
    """Mismo saneamiento que en píxeles, pero sin filtro de área.

    En grados el área no significa nada comparable: el filtro por superficie
    real lo hace Express, en m².
    """
    poligono = Polygon(anillo)
    if poligono.is_valid:
        return None if poligono.is_empty else poligono
    reparado = make_valid(poligono)
    if reparado.geom_type == "MultiPolygon":
        reparado = max(reparado.geoms, key=lambda parte: parte.area)
    elif reparado.geom_type == "GeometryCollection":
        candidatos = [parte for parte in reparado.geoms if parte.geom_type == "Polygon"]
        if not candidatos:
            return None
        reparado = max(candidatos, key=lambda parte: parte.area)
    if reparado.geom_type != "Polygon" or reparado.is_empty:
        return None
    return reparado


def _poligono_valido(coordenadas: np.ndarray) -> Polygon | None:
    if len(coordenadas) < 3:
        return None
    poligono = Polygon(coordenadas)
    if not poligono.is_valid:
        poligono = make_valid(poligono)
        if poligono.geom_type == "GeometryCollection":
            candidatos = [parte for parte in poligono.geoms if parte.geom_type == "Polygon"]
            poligono = max(candidatos, key=lambda parte: parte.area) if candidatos else None
        elif poligono.geom_type == "MultiPolygon":
            poligono = max(poligono.geoms, key=lambda parte: parte.area)
        elif poligono.geom_type != "Polygon":
            poligono = None
    if poligono is None or poligono.is_empty or poligono.area < AREA_MINIMA_PIXELES:
        return None
    return poligono


def _se_pisan(candidato: Polygon, aceptado: Polygon) -> bool:
    """True si el candidato es sobre todo una repetición de algo ya aceptado.

    Pasa siempre en el solape entre ventanas: el mismo lote aparece dos veces,
    a veces cortado. Como se recorre de mayor a menor área, el que sobrevive es
    el más completo.
    """
    try:
        interseccion = candidato.intersection(aceptado).area
    except Exception:  # noqa: BLE001 - geometrías degeneradas de shapely
        return False
    menor = min(candidato.area, aceptado.area)
    return menor > 0 and interseccion / menor > SOLAPE_PARA_DESCARTAR
