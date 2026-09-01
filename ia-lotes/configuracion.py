"""Configuración del microservicio, toda por variables de entorno.

Mismo criterio que `backend/src/configuracion`: se valida al arrancar y se
falla con un mensaje claro en vez de asumir defaults silenciosos peligrosos.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    # El .env de esta carpeta, igual que hace el backend con el suyo. Lo que ya
    # esté exportado en el entorno tiene prioridad.
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:  # pragma: no cover - sin python-dotenv se usa sólo el entorno
    pass

# Los pesos publicados por los autores de Delineate Anything. Por defecto va v2,
# que los autores miden en +103.3% de mAP@0.5 sobre el original y que en CPU
# resuelve un establecimiento típico en pocos segundos. El chico (-S) queda
# como opción si hace falta más velocidad y se acepta perder precisión.
PESOS_CONOCIDOS = ("DelineateAnything-S.pt", "DelineateAnything.pt", "DelineateAnythingv2.pt")
REPO_HUGGINGFACE = "MykolaL/DelineateAnything"


def _entero(nombre: str, defecto: int, minimo: int, maximo: int) -> int:
    crudo = os.environ.get(nombre, "").strip()
    if not crudo:
        return defecto
    if not crudo.isdigit():
        raise ValueError(f"{nombre} debe ser un entero entre {minimo} y {maximo}.")
    valor = int(crudo)
    if valor < minimo or valor > maximo:
        raise ValueError(f"{nombre} debe ser un entero entre {minimo} y {maximo}.")
    return valor


def _flotante(nombre: str, defecto: float, minimo: float, maximo: float) -> float:
    crudo = os.environ.get(nombre, "").strip()
    if not crudo:
        return defecto
    try:
        valor = float(crudo)
    except ValueError as error:
        raise ValueError(f"{nombre} debe ser un número entre {minimo} y {maximo}.") from error
    if valor < minimo or valor > maximo:
        raise ValueError(f"{nombre} debe ser un número entre {minimo} y {maximo}.")
    return valor


@dataclass(frozen=True)
class Configuracion:
    token: str
    pesos: str
    pesos_locales: str
    dispositivo: str
    confianza: float
    iou: float
    escalas: int
    lado_ventana: int
    solape: float
    zoom_maximo: int
    pixeles_maximos: int
    tiles_maximos: int
    url_tiles: str
    user_agent: str
    timeout_tile: int

    @property
    def usa_hub(self) -> bool:
        return not self.pesos_locales


def cargar_configuracion() -> Configuracion:
    pesos = os.environ.get("IA_LOTES_PESOS", "DelineateAnythingv2.pt").strip() or "DelineateAnythingv2.pt"
    if pesos not in PESOS_CONOCIDOS:
        conocidos = ", ".join(PESOS_CONOCIDOS)
        raise ValueError(f"IA_LOTES_PESOS debe ser uno de: {conocidos}.")

    dispositivo = os.environ.get("IA_LOTES_DISPOSITIVO", "auto").strip().lower() or "auto"
    if dispositivo not in ("auto", "cpu", "cuda"):
        raise ValueError("IA_LOTES_DISPOSITIVO debe ser auto, cpu o cuda.")

    return Configuracion(
        token=os.environ.get("IA_LOTES_TOKEN", "").strip(),
        pesos=pesos,
        pesos_locales=os.environ.get("IA_LOTES_PESOS_LOCALES", "").strip(),
        dispositivo=dispositivo,
        confianza=_flotante("IA_LOTES_CONFIANZA", 0.10, 0.01, 0.95),
        iou=_flotante("IA_LOTES_IOU", 0.70, 0.01, 0.95),
        escalas=_entero("IA_LOTES_ESCALAS", 3, 1, 5),
        lado_ventana=_entero("IA_LOTES_VENTANA", 512, 256, 2048),
        solape=_flotante("IA_LOTES_SOLAPE", 0.25, 0.0, 0.5),
        zoom_maximo=_entero("IA_LOTES_ZOOM_MAXIMO", 19, 10, 19),
        pixeles_maximos=_entero("IA_LOTES_PIXELES_MAXIMOS", 2048, 512, 8192),
        tiles_maximos=_entero("IA_LOTES_TILES_MAXIMOS", 144, 4, 1024),
        url_tiles=os.environ.get(
            "IA_LOTES_URL_TILES",
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ).strip(),
        user_agent=os.environ.get("IA_LOTES_USER_AGENT", "RODEO/0.1 (proyecto academico)").strip(),
        timeout_tile=_entero("IA_LOTES_TIMEOUT_TILE", 20, 5, 120),
    )
