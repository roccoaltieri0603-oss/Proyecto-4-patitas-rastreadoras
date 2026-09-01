"""Auto-chequeo de la georreferenciación, sin modelo ni red.

La conversión píxel <-> lng/lat está escrita a mano en `mosaico.py` (en vez de
usar rasterio/GDAL) y es lo que decide si los polígonos caen donde tienen que
caer. Si esto falla, las sugerencias aparecen corridas en el mapa.

    python verificar_mosaico.py
"""

from __future__ import annotations

from mosaico import (
    LADO_OBJETIVO_MOSAICO,
    LADO_TILE,
    ZOOM_MINIMO,
    bbox_de_anillo,
    elegir_zoom,
    lado_del_mosaico,
    lnglat_a_pixel,
    pixel_a_lnglat,
)

TOLERANCIA_GRADOS = 1e-9

# Un rincón de la pampa húmeda, escala de establecimiento real.
ANILLO = [
    [-61.5000, -34.6000],
    [-61.4700, -34.6000],
    [-61.4700, -34.6250],
    [-61.5000, -34.6250],
    [-61.5000, -34.6000],
]


def verificar_ida_y_vuelta() -> None:
    for zoom in range(10, 20):
        for lng, lat in [(0.0, 0.0), (-61.48, -34.61), (-58.38, -34.60), (10.5, 45.2), (-70.0, -50.0)]:
            x, y = lnglat_a_pixel(lng, lat, zoom)
            lng2, lat2 = pixel_a_lnglat(x, y, zoom)
            assert abs(lng - lng2) < TOLERANCIA_GRADOS, f"lng {lng} -> {lng2} en z{zoom}"
            assert abs(lat - lat2) < TOLERANCIA_GRADOS, f"lat {lat} -> {lat2} en z{zoom}"
    print("ok  ida y vuelta pixel <-> lng/lat en z10..z19")


def verificar_orientacion() -> None:
    """Más al este = más x; más al norte = menos y (el eje y crece hacia abajo)."""
    zoom = 17
    x_oeste, _ = lnglat_a_pixel(-61.50, -34.60, zoom)
    x_este, _ = lnglat_a_pixel(-61.47, -34.60, zoom)
    _, y_norte = lnglat_a_pixel(-61.50, -34.60, zoom)
    _, y_sur = lnglat_a_pixel(-61.50, -34.62, zoom)
    assert x_este > x_oeste, "el este tiene que caer a la derecha"
    assert y_sur > y_norte, "el sur tiene que caer más abajo"
    print("ok  orientación de los ejes")


def verificar_escala() -> None:
    """En el ecuador un tile de z0 cubre el mundo; cada zoom duplica la escala."""
    ancho_z0 = lnglat_a_pixel(180, 0, 0)[0] - lnglat_a_pixel(-180, 0, 0)[0]
    assert abs(ancho_z0 - LADO_TILE) < 1e-6, f"z0 debería medir {LADO_TILE} px, mide {ancho_z0}"
    ancho_z1 = lnglat_a_pixel(180, 0, 1)[0] - lnglat_a_pixel(-180, 0, 1)[0]
    assert abs(ancho_z1 - 2 * LADO_TILE) < 1e-6
    print("ok  escala por nivel de zoom")


def verificar_zoom_elegido() -> None:
    """El zoom apunta al tamaño de mosaico que el modelo prefiere, no al máximo detalle."""
    bbox = bbox_de_anillo(ANILLO)
    zoom = elegir_zoom(bbox, zoom_maximo=19, pixeles_maximos=2048)
    lado = lado_del_mosaico(bbox, zoom)
    assert 10 <= zoom <= 19, f"zoom fuera de rango: {zoom}"
    assert lado <= 2048, f"el mosaico se pasa del presupuesto: {lado:.0f} px"
    # Ningún otro zoom admisible puede quedar más cerca del objetivo.
    for otro in range(10, 20):
        otro_lado = lado_del_mosaico(bbox, otro)
        if otro_lado <= 2048:
            assert abs(lado - LADO_OBJETIVO_MOSAICO) <= abs(otro_lado - LADO_OBJETIVO_MOSAICO), (
                f"z{otro} ({otro_lado:.0f} px) queda más cerca del objetivo que z{zoom} ({lado:.0f} px)"
            )
    metros_por_pixel = 156543.03392 * 0.8232 / (2**zoom)  # cos(-34.6°)
    print(f"ok  zoom elegido z{zoom} -> {lado:.0f} px de lado (~{metros_por_pixel:.2f} m/píxel)")

    # Campos de tamaños muy distintos tienen que converger a un mosaico parecido:
    # eso es lo que mantiene los lotes en la escala que el modelo reconoce.
    for nombre, caja in [
        ("chico", (-61.5000, -34.6000, -61.4930, -34.5940)),
        ("mediano", (-61.5000, -34.6000, -61.4700, -34.6250)),
        ("grande", (-61.6000, -34.7000, -61.4000, -34.5500)),
    ]:
        z = elegir_zoom(caja, zoom_maximo=19, pixeles_maximos=2048)
        px = lado_del_mosaico(caja, z)
        assert 380 <= px <= 1600, f"el mosaico {nombre} quedó en {px:.0f} px (z{z}), fuera de escala útil"
        print(f"ok  {nombre}: z{z} -> {px:.0f} px de lado")

    # Una estancia de ~50.000 ha (22 km de lado) sigue entrando en el presupuesto.
    estancia = (-64.0, -36.0, -63.76, -35.80)
    z_estancia = elegir_zoom(estancia, zoom_maximo=19, pixeles_maximos=2048)
    assert lado_del_mosaico(estancia, z_estancia) <= 2048, "una estancia grande tiene que respetar el techo"
    print(f"ok  estancia de ~50.000 ha: z{z_estancia} -> {lado_del_mosaico(estancia, z_estancia):.0f} px")

    # Más allá de eso no hay zoom que alcance: se devuelve el piso y `armar_mosaico`
    # corta con un error explícito por cantidad de tiles, en vez de bajar medio país.
    absurdo = (-64.0, -36.0, -61.0, -34.0)
    assert elegir_zoom(absurdo, zoom_maximo=19, pixeles_maximos=2048) == ZOOM_MINIMO
    print(f"ok  un área imposible cae al piso z{ZOOM_MINIMO} y la corta el límite de tiles")


if __name__ == "__main__":
    verificar_ida_y_vuelta()
    verificar_orientacion()
    verificar_escala()
    verificar_zoom_elegido()
    print("\ntodo bien: la georreferenciación es consistente")
