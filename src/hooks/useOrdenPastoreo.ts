import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { obtenerOrdenPastoreo, type OrdenPastoreo } from "../api/estimacion";
import { useEstablecimiento } from "./useEstablecimiento";

export type EstadoOrdenPastoreo =
  | { estado: "cargando" }
  | { estado: "ok"; orden: OrdenPastoreo }
  | { estado: "error"; mensaje: string };

/**
 * El orden de los lotes para decidir a cuál mandar la hacienda, pedido una sola
 * vez para la sidebar y el panel de condición. `clave` cambia cuando cambian
 * los lotes, el satélite o el clima, y entonces se pide de nuevo.
 */
export function useOrdenPastoreo(habilitado: boolean, clave: unknown): EstadoOrdenPastoreo {
  const { establecimientoId } = useEstablecimiento();
  const [estado, setEstado] = useState<EstadoOrdenPastoreo>({ estado: "cargando" });

  useEffect(() => {
    if (!habilitado) return;
    let vigente = true;
    setEstado({ estado: "cargando" });
    obtenerOrdenPastoreo(establecimientoId)
      .then((orden) => { if (vigente) setEstado({ estado: "ok", orden }); })
      .catch((reason) => {
        if (vigente) setEstado({ estado: "error", mensaje: reason instanceof ApiError ? reason.message : "No se pudo armar el orden de los lotes." });
      });
    return () => { vigente = false; };
  }, [establecimientoId, habilitado, clave]);

  return estado;
}
