import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import type { SugerenciaLote } from "../ia/types";
import type { Establecimiento, Lote, PolygonFeature } from "../types";

type DrawTarget = "establecimiento" | "lote" | null;
type EditTarget =
  | { type: "establecimiento" }
  | { type: "lote"; id: string }
  | { type: "sugerencia"; id: string }
  | null;

export interface MapEngineHandle {
  startDrawEstablecimiento(): void;
  startDrawLote(): void;
  cancelDraw(): void;
  startEditBoundary(): void;
  saveEditBoundary(): void;
  cancelEditBoundary(): void;
  startEditLote(loteId: string): void;
  saveEditLote(): void;
  cancelEditLote(): void;
  startEditSugerencia(sugerenciaId: string): void;
  saveEditSugerencia(): void;
  cancelEditSugerencia(): void;
  flyTo(polygon: PolygonFeature): void;
}

/** Cómo pintar y rotular un lote según su condición satelital. */
export interface CondicionVisual {
  color: string;
  etiqueta: string;
}

interface MapEngineProps {
  establecimiento: Establecimiento | null;
  lotesVisibles: Lote[];
  selectedLoteId: string | null;
  condicionPorLote: Record<string, CondicionVisual>;
  onEstablecimientoDrawn: (feature: PolygonFeature) => void;
  onLoteDrawn: (feature: PolygonFeature) => void;
  onBoundaryEdited: (feature: PolygonFeature) => void;
  onLoteEdited: (loteId: string, feature: PolygonFeature) => void;
  onSelectLote: (id: string) => void;
  /** Borrador propuesto por la IA. No es un lote hasta que el usuario confirma. */
  sugerencias: SugerenciaLote[];
  sugerenciasExcluidas: string[];
  sugerenciaEnEdicionId: string | null;
  onToggleSugerencia: (id: string) => void;
  onSugerenciaEditada: (id: string, feature: PolygonFeature) => void;
}

const ESTABLECIMIENTO_COLOR = "#ffd60a";
const LOTE_COLOR = "#22c55e";
const LOTE_SELECTED_COLOR = "#f43f5e";
const SUGERENCIA_COLOR = "#a855f7";
const SUGERENCIA_EXCLUIDA_COLOR = "#94a3b8";

/** Punteado y violeta: tiene que leerse distinto de un lote guardado. */
function sugerenciaStyle(excluida: boolean, editando: boolean): L.PathOptions {
  const color = excluida ? SUGERENCIA_EXCLUIDA_COLOR : SUGERENCIA_COLOR;
  return {
    color,
    weight: editando ? 4 : 2.5,
    dashArray: editando ? undefined : "6 6",
    fillColor: color,
    fillOpacity: excluida ? 0.05 : 0.3,
  };
}

const ESTABLECIMIENTO_STYLE: L.PathOptions = {
  color: ESTABLECIMIENTO_COLOR,
  weight: 4,
  opacity: 0.95,
  fillColor: ESTABLECIMIENTO_COLOR,
  fillOpacity: 0.06,
};

function loteStyle(
  lote: Lote,
  selected: boolean,
  condicion: CondicionVisual | undefined,
): L.PathOptions {
  // El relleno comunica la condición; el borde, la selección.
  const relleno = condicion?.color ?? LOTE_COLOR;
  return {
    color: selected ? LOTE_SELECTED_COLOR : relleno,
    weight: selected ? 4 : 2.5,
    fillColor: relleno,
    fillOpacity: lote.activo ? (condicion ? 0.45 : 0.25) : 0.08,
    dashArray: lote.activo ? undefined : "4 4",
  };
}

function createEditHandler(map: L.Map, layer: L.Polygon): L.EditToolbar.Edit {
  const featureGroup = new L.FeatureGroup([layer]);
  return new L.EditToolbar.Edit(map as unknown as L.DrawMap, { featureGroup });
}

const MapEngine = forwardRef<MapEngineHandle, MapEngineProps>(function MapEngine(
  props,
  ref,
) {
  const map = useMap();
  const establecimientoLayerRef = useRef<L.Polygon | null>(null);
  const lotesLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const sugerenciasLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const drawHandlerRef = useRef<L.Draw.Polygon | null>(null);
  const editHandlerRef = useRef<L.EditToolbar.Edit | null>(null);
  const loteLayersRef = useRef<Record<string, L.Polygon>>({});
  const sugerenciaLayersRef = useRef<Record<string, L.Polygon>>({});
  const editTargetRef = useRef<EditTarget>(null);
  const pendingTargetRef = useRef<DrawTarget>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const group = lotesLayerGroupRef.current;
    const grupoSugerencias = sugerenciasLayerGroupRef.current;
    group.addTo(map);
    grupoSugerencias.addTo(map);
    return () => {
      group.remove();
      grupoSugerencias.remove();
    };
  }, [map]);

  useEffect(() => {
    const handler = (evt: L.LeafletEvent) => {
      const e = evt as L.DrawEvents.Created;
      const layer = e.layer as L.Polygon;
      const feature = layer.toGeoJSON() as PolygonFeature;
      const target = pendingTargetRef.current;
      pendingTargetRef.current = null;
      drawHandlerRef.current = null;
      if (target === "establecimiento") {
        propsRef.current.onEstablecimientoDrawn(feature);
      } else if (target === "lote") {
        propsRef.current.onLoteDrawn(feature);
      }
    };
    map.on(L.Draw.Event.CREATED, handler);
    return () => {
      map.off(L.Draw.Event.CREATED, handler);
    };
  }, [map]);

  useEffect(() => {
    if (establecimientoLayerRef.current) {
      establecimientoLayerRef.current.remove();
      establecimientoLayerRef.current = null;
    }
    if (props.establecimiento) {
      const geoLayer = L.geoJSON(props.establecimiento.polygon, {
        style: ESTABLECIMIENTO_STYLE,
      }).addTo(map);
      establecimientoLayerRef.current = geoLayer.getLayers()[0] as L.Polygon;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.establecimiento]);

  useEffect(() => {
    const group = lotesLayerGroupRef.current;
    group.clearLayers();
    loteLayersRef.current = {};
    for (const lote of props.lotesVisibles) {
      const selected = lote.id === props.selectedLoteId;
      const condicion = props.condicionPorLote[lote.id];
      const layer = L.geoJSON(lote.polygon, {
        style: loteStyle(lote, selected, condicion),
      });
      const base = lote.apodo ? `Lote ${lote.numero} — ${lote.apodo}` : `Lote ${lote.numero}`;
      layer.bindTooltip(condicion ? `${base}<br>${condicion.etiqueta}` : base);
      layer.on("click", () => propsRef.current.onSelectLote(lote.id));
      layer.addTo(group);
      const polygonLayer = layer.getLayers()[0];
      if (polygonLayer instanceof L.Polygon) loteLayersRef.current[lote.id] = polygonLayer;
    }
  }, [props.lotesVisibles, props.selectedLoteId, props.condicionPorLote]);

  useEffect(() => {
    // Mientras se está editando una sugerencia, el handler de Leaflet Draw es
    // dueño de esa capa: rehacer el grupo le sacaría el polígono de abajo.
    if (props.sugerenciaEnEdicionId) return;
    const group = sugerenciasLayerGroupRef.current;
    group.clearLayers();
    sugerenciaLayersRef.current = {};
    const excluidas = new Set(props.sugerenciasExcluidas);
    for (const sugerencia of props.sugerencias) {
      const excluida = excluidas.has(sugerencia.id);
      const layer = L.geoJSON(sugerencia.polygon, { style: sugerenciaStyle(excluida, false) });
      layer.bindTooltip(
        `Sugerencia · ${sugerencia.hectareas.toFixed(2)} ha<br>${excluida ? "Descartada" : "Se va a crear"} · click para cambiar`,
      );
      layer.on("click", () => propsRef.current.onToggleSugerencia(sugerencia.id));
      layer.addTo(group);
      const polygonLayer = layer.getLayers()[0];
      if (polygonLayer instanceof L.Polygon) sugerenciaLayersRef.current[sugerencia.id] = polygonLayer;
    }
  }, [props.sugerencias, props.sugerenciasExcluidas, props.sugerenciaEnEdicionId]);

  useImperativeHandle(
    ref,
    () => ({
      startDrawEstablecimiento() {
        drawHandlerRef.current?.disable();
        pendingTargetRef.current = "establecimiento";
        const handler = new L.Draw.Polygon(map as unknown as L.DrawMap, {
          shapeOptions: {
            color: ESTABLECIMIENTO_COLOR,
            weight: 4,
            fillColor: ESTABLECIMIENTO_COLOR,
            fillOpacity: 0.12,
          },
          allowIntersection: false,
          showArea: false,
        });
        drawHandlerRef.current = handler;
        handler.enable();
      },
      startDrawLote() {
        drawHandlerRef.current?.disable();
        pendingTargetRef.current = "lote";
        const establecimiento = propsRef.current.establecimiento;
        if (establecimiento) {
          const bounds = L.geoJSON(establecimiento.polygon).getBounds();
          map.flyToBounds(bounds, { maxZoom: 17, duration: 0.6, padding: [40, 40] });
        }
        const handler = new L.Draw.Polygon(map as unknown as L.DrawMap, {
          shapeOptions: {
            color: LOTE_COLOR,
            weight: 3,
            fillColor: LOTE_COLOR,
            fillOpacity: 0.15,
          },
          allowIntersection: false,
          showArea: false,
        });
        drawHandlerRef.current = handler;
        handler.enable();
      },
      cancelDraw() {
        drawHandlerRef.current?.disable();
        drawHandlerRef.current = null;
        pendingTargetRef.current = null;
      },
      startEditBoundary() {
        const layer = establecimientoLayerRef.current;
        if (!layer) return;
        editHandlerRef.current?.disable();
        const handler = createEditHandler(map, layer);
        editTargetRef.current = { type: "establecimiento" };
        editHandlerRef.current = handler;
        handler.enable();
      },
      saveEditBoundary() {
        const layer = establecimientoLayerRef.current;
        editHandlerRef.current?.save();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
        if (layer) {
          const feature = layer.toGeoJSON() as PolygonFeature;
          propsRef.current.onBoundaryEdited(feature);
        }
      },
      cancelEditBoundary() {
        editHandlerRef.current?.revertLayers();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
      },
      startEditLote(loteId: string) {
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        const layer = loteLayersRef.current[loteId];
        if (!layer) return;
        const handler = createEditHandler(map, layer);
        editTargetRef.current = { type: "lote", id: loteId };
        editHandlerRef.current = handler;
        handler.enable();
      },
      saveEditLote() {
        const target = editTargetRef.current;
        const loteId = target?.type === "lote" ? target.id : null;
        const layer = loteId ? loteLayersRef.current[loteId] : undefined;
        editHandlerRef.current?.save();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
        if (loteId && layer) {
          propsRef.current.onLoteEdited(loteId, layer.toGeoJSON() as PolygonFeature);
        }
      },
      cancelEditLote() {
        editHandlerRef.current?.revertLayers();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
      },
      startEditSugerencia(sugerenciaId: string) {
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        const layer = sugerenciaLayersRef.current[sugerenciaId];
        if (!layer) return;
        layer.setStyle(sugerenciaStyle(false, true));
        const handler = createEditHandler(map, layer);
        editTargetRef.current = { type: "sugerencia", id: sugerenciaId };
        editHandlerRef.current = handler;
        handler.enable();
      },
      saveEditSugerencia() {
        const target = editTargetRef.current;
        const sugerenciaId = target?.type === "sugerencia" ? target.id : null;
        const layer = sugerenciaId ? sugerenciaLayersRef.current[sugerenciaId] : undefined;
        editHandlerRef.current?.save();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
        if (sugerenciaId && layer) {
          propsRef.current.onSugerenciaEditada(sugerenciaId, layer.toGeoJSON() as PolygonFeature);
        }
      },
      cancelEditSugerencia() {
        editHandlerRef.current?.revertLayers();
        editHandlerRef.current?.disable();
        editHandlerRef.current = null;
        editTargetRef.current = null;
      },
      flyTo(polygon: PolygonFeature) {
        const bounds = L.geoJSON(polygon).getBounds();
        map.flyToBounds(bounds, { maxZoom: 16, duration: 0.6 });
      },
    }),
    [map],
  );

  return null;
});

export default MapEngine;
