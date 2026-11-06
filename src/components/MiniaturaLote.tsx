import { useMemo } from "react";
import L from "leaflet";
import { AttributionControl, CircleMarker, GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import type { PolygonFeature } from "../types";

/**
 * Miniatura de la ficha: sólo el lote, sobre la misma imagen satelital del mapa
 * (Esri World Imagery), quieta y encuadrada en su polígono.
 *
 * Estilo del frame "Mapa del lote" del Figma: relleno crema al 40 %, borde
 * crema de 2 px y los vértices en verde de marca. Con muchos vértices (un lote
 * dibujado a mano alzada) los puntos se omiten: serían una mancha.
 */
const MAXIMO_VERTICES_VISIBLES = 12;

export default function MiniaturaLote({ poligono, className = "" }: { poligono: PolygonFeature; className?: string }) {
  const limites = useMemo(() => L.geoJSON(poligono).getBounds(), [poligono]);
  const vertices = useMemo(() => {
    const anillo = poligono.geometry.coordinates[0] ?? [];
    // El último punto repite el primero para cerrar el anillo.
    const abiertos = anillo.length > 1 ? anillo.slice(0, -1) : anillo;
    return abiertos.length <= MAXIMO_VERTICES_VISIBLES ? abiertos : [];
  }, [poligono]);

  if (!limites.isValid()) {
    return <div className={`grid place-content-center bg-white/5 text-sm text-white/60 ${className}`}>Sin geometría para mostrar</div>;
  }

  return (
    <div className={`overflow-hidden ${className}`}>
      <MapContainer
        bounds={limites}
        boundsOptions={{ padding: [48, 48] }}
        zoomSnap={0}
        maxZoom={19}
        dragging={false}
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
        style={{ height: "100%", width: "100%", background: "#1b2420" }}
      >
        {/* El crédito de Esri no se saca: lo piden sus términos y es la fuente real de la imagen. */}
        <AttributionControl position="bottomright" prefix={false} />
        <TileLayer
          attribution="Imágenes &copy; Esri, Maxar, Earthstar Geographics"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={19}
        />
        <GeoJSON
          data={poligono}
          interactive={false}
          style={{ color: "#ffde67", weight: 2, fillColor: "#ffde67", fillOpacity: 0.4, opacity: 1 }}
        />
        {vertices.map(([lng, lat], indice) => (
          <CircleMarker
            key={`${indice}-${lat}-${lng}`}
            center={[lat, lng]}
            radius={5}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: "#79da58", fillOpacity: 1 }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
