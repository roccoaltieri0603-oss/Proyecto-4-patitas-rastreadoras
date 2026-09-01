"""Dibuja las detecciones sobre la imagen satelital, para poder mirarlas.

Sin esto, calibrar el modelo es adivinar: los números de salida no dicen si los
bordes caen sobre los alambrados o dos cuadros más allá. Este script guarda un
PNG con los contornos encima de la misma imagen que vio el modelo.

    python depurar_deteccion.py
    python depurar_deteccion.py --bbox -63.60,-33.20,-63.55,-33.16 --salida otra.png

No es parte del servicio: es herramienta de calibración.
"""

from __future__ import annotations

import argparse
import dataclasses
import time

from PIL import ImageDraw

from configuracion import PESOS_CONOCIDOS, cargar_configuracion
from modelo import DetectorLotes
from mosaico import armar_mosaico, bbox_de_anillo, elegir_zoom, escalas_de_zoom, lnglat_a_pixel

# Campo de la pampa húmeda con división en cuadros visible (Lincoln, Bs. As.).
ANILLO_POR_DEFECTO = [
    [-61.5000, -34.6000],
    [-61.4700, -34.6000],
    [-61.4700, -34.6250],
    [-61.5000, -34.6250],
    [-61.5000, -34.6000],
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pesos", choices=PESOS_CONOCIDOS, default=None)
    parser.add_argument("--ventana", type=int, default=None)
    parser.add_argument("--solape", type=float, default=None)
    parser.add_argument("--conf", type=float, default=None)
    parser.add_argument("--iou", type=float, default=None)
    parser.add_argument("--zoom", type=int, default=None, help="fuerza un zoom único en vez de elegir escalas")
    parser.add_argument("--zoom-maximo", type=int, default=None)
    parser.add_argument("--pixeles-maximos", type=int, default=None)
    parser.add_argument("--escalas", type=int, default=None, help="cuántos zooms mirar (1 = una sola escala)")
    parser.add_argument("--bbox", default=None, help="minlng,minlat,maxlng,maxlat de otra zona a probar")
    parser.add_argument("--salida", default="deteccion.png")
    args = parser.parse_args()

    if args.bbox:
        minlng, minlat, maxlng, maxlat = (float(valor) for valor in args.bbox.split(","))
        anillo = [
            [minlng, minlat], [maxlng, minlat], [maxlng, maxlat], [minlng, maxlat], [minlng, minlat],
        ]
    else:
        anillo = ANILLO_POR_DEFECTO

    base = cargar_configuracion()
    cambios = {
        "pesos": args.pesos,
        "lado_ventana": args.ventana,
        "solape": args.solape,
        "confianza": args.conf,
        "iou": args.iou,
        "zoom_maximo": args.zoom_maximo,
        "pixeles_maximos": args.pixeles_maximos,
        "escalas": args.escalas,
    }
    configuracion = dataclasses.replace(base, **{k: v for k, v in cambios.items() if v is not None})

    bbox = bbox_de_anillo(anillo)
    if args.zoom:
        zooms = [args.zoom]
    else:
        base = elegir_zoom(bbox, configuracion.zoom_maximo, configuracion.pixeles_maximos)
        zooms = escalas_de_zoom(
            bbox, base, configuracion.escalas, configuracion.zoom_maximo,
            configuracion.pixeles_maximos, configuracion.tiles_maximos,
        )

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
    for item in mosaicos:
        print(f"mosaico z{item.zoom}  {item.imagen.width}x{item.imagen.height} px  "
              f"~{item.metros_por_pixel:.2f} m/px  {item.tiles} tiles")

    detector = DetectorLotes(configuracion)
    comenzo = time.monotonic()
    detecciones = detector.detectar(mosaicos)
    segundos = time.monotonic() - comenzo
    print(f"modelo {configuracion.pesos}  ventana {configuracion.lado_ventana}  "
          f"conf {configuracion.confianza}  iou {configuracion.iou}  "
          f"escalas {zooms}")
    print(f"{len(detecciones)} poligonos en {segundos:.1f} s")

    # Se dibuja sobre el mosaico más detallado, para que se vea el ajuste fino.
    mosaico = mosaicos[-1]

    lienzo = mosaico.imagen.convert("RGB")
    dibujo = ImageDraw.Draw(lienzo, "RGBA")
    for deteccion in detecciones:
        puntos = []
        for lng, lat in deteccion["anillo"]:
            x, y = lnglat_a_pixel(lng, lat, mosaico.zoom)
            puntos.append((x - mosaico.origen_x, y - mosaico.origen_y))
        if len(puntos) >= 3:
            dibujo.polygon(puntos, fill=(168, 85, 247, 45), outline=(255, 40, 200, 255), width=3)
    lienzo.save(args.salida)
    print(f"guardado en {args.salida}")


if __name__ == "__main__":
    main()
