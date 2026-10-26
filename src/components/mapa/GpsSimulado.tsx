import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import { actualizarDispositivo, obtenerDispositivos, type Dispositivo } from "../../api/dispositivos";
import { useEstablecimiento } from "../../hooks/useEstablecimiento";
import type { Lote } from "../../types";
const TIEMPO_DENTRO_MS = 3000;
interface Props { lotesActivos: Lote[]; onLoteConfirmado: (lote: Lote | null) => void }
export default function GpsSimulado({ lotesActivos, onLoteConfirmado }: Props) {
  const map = useMap(); const { establecimientoId, membresia } = useEstablecimiento();
  const [items, setItems] = useState<Dispositivo[]>([]); const [error, setError] = useState("");
  const itemsRef = useRef(items); itemsRef.current = items;
  const lotesRef = useRef(lotesActivos); lotesRef.current = lotesActivos;
  const loteCallbackRef = useRef(onLoteConfirmado); loteCallbackRef.current = onLoteConfirmado;
  const puedeEditar = membresia?.rol !== "VISOR";
  useEffect(() => {
    let vigente = true; let markers: L.Marker[] = []; let timeoutId: number | null = null; let loteActualId: string | null = null;
    const evaluarLote = (latlng: L.LatLng) => {
      const lote = lotesRef.current.find((item) => turf.booleanPointInPolygon(turf.point([latlng.lng, latlng.lat]), item.polygon)) ?? null;
      if (lote?.id === loteActualId) return;
      loteActualId = lote?.id ?? null;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
      loteCallbackRef.current(null);
      if (lote) timeoutId = window.setTimeout(() => loteCallbackRef.current(lote), TIEMPO_DENTRO_MS);
    };
    obtenerDispositivos(establecimientoId).then((devices) => {
    if (!vigente) return;
    setItems(devices);
    markers = devices.map((d) => {
      if (d.latitud === undefined || d.longitud === undefined || d.numero === undefined) throw new Error("GPS simulado incompleto");
      const icon = L.divIcon({ className: "gps-simulado-icon", html: `<div class="gps-simulado-punto"><span class="gps-simulado-radar"></span><span class="gps-simulado-nucleo"></span><b class="gps-simulado-numero">${d.numero}</b></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      return L.marker([d.latitud, d.longitud], { icon, draggable: puedeEditar, zIndexOffset: 1000 + d.numero }).addTo(map);
    });
    markers.forEach((marker, index) => {
      marker.on("dragstart", () => map.dragging.disable());
      if (devices[index]?.numero === 1) marker.on("drag", (event) => evaluarLote((event.target as L.Marker).getLatLng()));
      marker.on("dragend", async () => {
      map.dragging.enable();
      const device = itemsRef.current[index];
      const p = marker.getLatLng();
        if (device.numero === 1) evaluarLote(p);
      try { const updated = await actualizarDispositivo(establecimientoId, device.id, { latitud: p.lat, longitud: p.lng }); setItems((prev) => prev.map((x) => x.id === updated.id ? updated : x)); setError(""); }
      catch { setError(`No se pudo guardar la ubicación del GPS ${device.numero}.`); if (device.latitud !== undefined && device.longitud !== undefined) { marker.setLatLng([device.latitud, device.longitud]); if (device.numero === 1) evaluarLote(marker.getLatLng()); } }
      });
    });
    const primero = devices.find((device) => device.numero === 1);
    if (primero) evaluarLote(L.latLng(primero.latitud!, primero.longitud!));
    }).catch(() => { if (vigente) setError("No se pudieron cargar los GPS simulados."); });
    return () => { vigente = false; if (timeoutId !== null) window.clearTimeout(timeoutId); loteCallbackRef.current(null); map.dragging.enable(); markers.forEach((m) => m.remove()); };
  }, [map, establecimientoId, puedeEditar]);
  return error ? <div className="pointer-events-none absolute bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-md border border-red-400/50 bg-slate-900/90 px-3 py-1.5 text-xs text-red-100">{error}</div> : null;
}
