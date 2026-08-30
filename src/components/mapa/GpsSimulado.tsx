import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import type { Lote } from "../../types";

const TIEMPO_DENTRO_MS = 3000;

const ICONO_HTML = `
  <div class="gps-simulado-punto">
    <span class="gps-simulado-radar" style="animation-delay:0s"></span>
    <span class="gps-simulado-radar" style="animation-delay:0.66s"></span>
    <span class="gps-simulado-radar" style="animation-delay:1.32s"></span>
    <span class="gps-simulado-nucleo"></span>
  </div>
`;

interface GpsSimuladoProps {
  posicionInicial: [number, number];
  lotesActivos: Lote[];
  onLoteConfirmado: (lote: Lote | null) => void;
}

/**
 * Punto de GPS simulado y arrastrable para probar la detección de lote
 * mientras no exista el dispositivo real. Es puramente visual: no llama al
 * backend ni persiste nada, así que no reemplaza al GPS/dispositivos real
 * (pausado en CLAUDE.md).
 */
export default function GpsSimulado({ posicionInicial, lotesActivos, onLoteConfirmado }: GpsSimuladoProps) {
  const map = useMap();
  // Se fija en el primer render: si se recalculara en cada uno (p. ej. el
  // centroide del establecimiento), el efecto de abajo recrearía el marker
  // y se perdería la posición arrastrada por el usuario.
  const [posicionBase] = useState(posicionInicial);
  const lotesRef = useRef(lotesActivos);
  lotesRef.current = lotesActivos;
  const onLoteConfirmadoRef = useRef(onLoteConfirmado);
  onLoteConfirmadoRef.current = onLoteConfirmado;

  useEffect(() => {
    const icon = L.divIcon({
      className: "gps-simulado-icon",
      html: ICONO_HTML,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker(posicionBase, { icon, draggable: true, zIndexOffset: 1000 }).addTo(map);

    let loteActualId: string | null = null;
    let timeoutId: number | null = null;

    function limpiarTimeout() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function evaluarPosicion(latlng: L.LatLng) {
      const punto = turf.point([latlng.lng, latlng.lat]);
      const lote = lotesRef.current.find((item) => turf.booleanPointInPolygon(punto, item.polygon));
      const nuevoId = lote?.id ?? null;
      if (nuevoId === loteActualId) return;
      loteActualId = nuevoId;
      limpiarTimeout();
      onLoteConfirmadoRef.current(null);
      if (lote) {
        timeoutId = window.setTimeout(() => {
          onLoteConfirmadoRef.current(lote);
        }, TIEMPO_DENTRO_MS);
      }
    }

    function onDragStart() {
      map.dragging.disable();
    }
    function onDrag(evento: L.LeafletEvent) {
      evaluarPosicion((evento.target as L.Marker).getLatLng());
    }
    function onDragEnd() {
      map.dragging.enable();
    }

    marker.on("dragstart", onDragStart);
    marker.on("drag", onDrag);
    marker.on("dragend", onDragEnd);
    evaluarPosicion(marker.getLatLng());

    return () => {
      limpiarTimeout();
      marker.off("dragstart", onDragStart);
      marker.off("drag", onDrag);
      marker.off("dragend", onDragEnd);
      marker.remove();
      onLoteConfirmadoRef.current(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, posicionBase]);

  return null;
}
