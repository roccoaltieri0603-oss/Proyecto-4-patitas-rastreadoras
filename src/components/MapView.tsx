import { forwardRef } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import MapEngine, {
  type CondicionVisual,
  type MapEngineHandle,
} from "./MapEngine";
import GpsSimulado from "./mapa/GpsSimulado";
import { centroidOf } from "../geo";
import type { SugerenciaLote } from "../ia/types";
import type { Establecimiento, Lote, PolygonFeature } from "../types";

const ARGENTINA_BOUNDS = L.latLngBounds([
  [-58, -76],
  [-20.5, -52],
]);
const ARGENTINA_CENTER: [number, number] = [-38.4161, -63.6167];

interface MapViewProps {
  establecimiento: Establecimiento | null;
  lotesVisibles: Lote[];
  lotesActivos: Lote[];
  selectedLoteId: string | null;
  condicionPorLote: Record<string, CondicionVisual>;
  onEstablecimientoDrawn: (feature: PolygonFeature) => void;
  onLoteDrawn: (feature: PolygonFeature) => void;
  onBoundaryEdited: (feature: PolygonFeature) => void;
  onLoteEdited: (loteId: string, feature: PolygonFeature) => void;
  onSelectLote: (id: string) => void;
  onGpsLoteConfirmado: (lote: Lote | null) => void;
  sugerencias: SugerenciaLote[];
  sugerenciasExcluidas: string[];
  sugerenciaEnEdicionId: string | null;
  onToggleSugerencia: (id: string) => void;
  onSugerenciaEditada: (id: string, feature: PolygonFeature) => void;
}

const MapView = forwardRef<MapEngineHandle, MapViewProps>(function MapView(props, ref) {
  return (
    <MapContainer
      center={ARGENTINA_CENTER}
      zoom={5}
      minZoom={5}
      maxZoom={19}
      maxBounds={ARGENTINA_BOUNDS}
      maxBoundsViscosity={1.0}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={19}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={19}
      />
      <MapEngine
        ref={ref}
        establecimiento={props.establecimiento}
        lotesVisibles={props.lotesVisibles}
        selectedLoteId={props.selectedLoteId}
        condicionPorLote={props.condicionPorLote}
        onEstablecimientoDrawn={props.onEstablecimientoDrawn}
        onLoteDrawn={props.onLoteDrawn}
        onBoundaryEdited={props.onBoundaryEdited}
        onLoteEdited={props.onLoteEdited}
        onSelectLote={props.onSelectLote}
        sugerencias={props.sugerencias}
        sugerenciasExcluidas={props.sugerenciasExcluidas}
        sugerenciaEnEdicionId={props.sugerenciaEnEdicionId}
        onToggleSugerencia={props.onToggleSugerencia}
        onSugerenciaEditada={props.onSugerenciaEditada}
      />
      {props.establecimiento && (
        <GpsSimulado
          posicionInicial={centroidOf(props.establecimiento.polygon)}
          lotesActivos={props.lotesActivos}
          onLoteConfirmado={props.onGpsLoteConfirmado}
        />
      )}
    </MapContainer>
  );
});

export default MapView;
