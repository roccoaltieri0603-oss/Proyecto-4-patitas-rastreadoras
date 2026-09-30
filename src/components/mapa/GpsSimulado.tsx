import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import { guardarPosicionGpsSimulado, obtenerPosicionGpsSimulado } from "../../api/gpsSimulado";
import { useEstablecimiento } from "../../hooks/useEstablecimiento";
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
 * mientras no exista el dispositivo real. Sigue siendo una simulación: lo único
 * que persiste es dónde quedó el marcador, para que al volver a entrar aparezca
 * ahí en vez de saltar al centroide. No hay recorrido, tramos ni jornadas, y
 * esto no reemplaza al GPS/dispositivos real (pausado en CLAUDE.md).
 */
export default function GpsSimulado({ posicionInicial, lotesActivos, onLoteConfirmado }: GpsSimuladoProps) {
  const map = useMap();
  const { establecimientoId, membresia } = useEstablecimiento();
  // El Visor es de sólo lectura sobre lo compartido: puede mover el punto en su
  // pantalla, pero el backend no le acepta la escritura, así que ni la intenta.
  // En un ref porque el efecto del marker no se rehace: la membresía puede
  // llegar después y el handler tiene que ver el valor actual, no el del montaje.
  const puedeGuardarRef = useRef(false);
  puedeGuardarRef.current = !!establecimientoId && membresia?.rol !== "VISOR";
  // El centroide se recalcula en cada render del mapa; si el efecto de abajo
  // dependiera de él, recrearía el marker y perdería la posición arrastrada.
  const centroideRef = useRef(posicionInicial);
  // `null` mientras no se sabe dónde arranca el punto. El marker no se monta
  // hasta entonces, así que no se ve un salto del centroide a la guardada.
  const [posicionBase, setPosicionBase] = useState<[number, number] | null>(null);
  const [errorGuardado, setErrorGuardado] = useState(false);
  const lotesRef = useRef(lotesActivos);
  lotesRef.current = lotesActivos;
  const onLoteConfirmadoRef = useRef(onLoteConfirmado);
  onLoteConfirmadoRef.current = onLoteConfirmado;

  useEffect(() => {
    let vigente = true;
    if (!establecimientoId) {
      setPosicionBase(centroideRef.current);
      return;
    }
    // Si la lectura falla se arranca en el centroide, como antes de que esto
    // existiera: el mapa no se rompe y no se muestra una posición inventada.
    obtenerPosicionGpsSimulado(establecimientoId)
      .then((posicion) => {
        if (vigente) setPosicionBase(posicion ? [posicion.latitud, posicion.longitud] : centroideRef.current);
      })
      .catch(() => {
        if (vigente) setPosicionBase(centroideRef.current);
      });
    return () => { vigente = false; };
  }, [establecimientoId]);

  useEffect(() => {
    if (!posicionBase) return;
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
    function onDragEnd(evento: L.LeafletEvent) {
      map.dragging.enable();
      if (!puedeGuardarRef.current) return;
      // No bloquea la interacción: el punto ya quedó donde lo soltaron y el
      // guardado viaja aparte. Si falla se avisa, no se reubica el marcador.
      const { lat, lng } = (evento.target as L.Marker).getLatLng();
      guardarPosicionGpsSimulado(establecimientoId, lat, lng)
        .then(() => setErrorGuardado(false))
        .catch(() => setErrorGuardado(true));
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

  if (!errorGuardado) return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-md border border-amber-400/40 bg-slate-900/90 px-3 py-1.5 text-[0.7rem] font-medium text-amber-200 shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
      No se pudo guardar la posición del GPS simulado.
    </div>
  );
}
