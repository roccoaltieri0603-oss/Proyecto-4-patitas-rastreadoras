import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useCallback, useEffect, useState } from "react";
import { eliminarNotificacionLeida, marcarNotificacionLeida, marcarTodasLeidas, obtenerNotificaciones, type Notificacion } from "../api/notificaciones";

const LIMIT = 20;

/** Lo dispara quien acaba de hacer algo que pudo crear notificaciones, para no esperar al próximo minuto. */
const EVENTO_CAMBIO = "rodeo:notificaciones-cambiaron";

export function avisarCambioNotificaciones(): void {
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

export function useNotificaciones(habilitado: boolean) {
  const { establecimientoId } = useEstablecimiento();
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [accionando, setAccionando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (paginaOffset: number) => {
    if (!habilitado) return;
    setCargando(true);
    setError(null);
    try {
      const pagina = await obtenerNotificaciones(establecimientoId, { limit: LIMIT, offset: paginaOffset });
      setItems(pagina.notificaciones);
      setNoLeidas(pagina.noLeidas);
      setTotal(pagina.paginacion.total);
      setHayMas(pagina.paginacion.hayMas);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar las notificaciones.");
    } finally {
      setCargando(false);
    }
  }, [habilitado, establecimientoId]);

  useEffect(() => {
    if (!habilitado) {
      setItems([]); setNoLeidas(0); setOffset(0); setTotal(0); setHayMas(false); setError(null);
      return;
    }
    void cargar(offset);
  }, [cargar, habilitado, offset]);

  useEffect(() => {
    if (!habilitado) return;
    const recargar = () => { if (document.visibilityState === "visible") void cargar(offset); };
    // Cada minuto trae lo que generaron otros; el evento trae enseguida lo que
    // acaba de generar esta pestaña (por ejemplo, el GPS simulado al entrar a un
    // lote), y al volver a la pestaña no se espera al próximo minuto.
    const temporizador = window.setInterval(recargar, 60_000);
    window.addEventListener(EVENTO_CAMBIO, recargar);
    document.addEventListener("visibilitychange", recargar);
    return () => {
      window.clearInterval(temporizador);
      window.removeEventListener(EVENTO_CAMBIO, recargar);
      document.removeEventListener("visibilitychange", recargar);
    };
  }, [cargar, habilitado, offset]);

  async function marcarLeida(id: string) {
    const anterior = items.find((item) => item.id === id);
    if (!anterior || anterior.leida || accionando) return;
    setAccionando(true); setError(null);
    try {
      const actualizada = await marcarNotificacionLeida(establecimientoId, id);
      setItems((actuales) => actuales.map((item) => item.id === id ? actualizada : item));
      setNoLeidas((cantidad) => Math.max(0, cantidad - 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo marcar la notificación.");
    } finally { setAccionando(false); }
  }

  async function marcarTodas() {
    if (noLeidas === 0 || accionando) return;
    setAccionando(true); setError(null);
    try {
      await marcarTodasLeidas(establecimientoId);
      const ahora = new Date().toISOString();
      setItems((actuales) => actuales.map((item) => item.leida ? item : { ...item, leida: true, readAt: ahora }));
      setNoLeidas(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron marcar las notificaciones.");
    } finally { setAccionando(false); }
  }

  async function eliminarLeida(id: string) {
    const anterior = items.find((item) => item.id === id);
    // Los avisos del GPS simulado se borran aunque no estén leídos (el backend también lo permite).
    if (!anterior || (!anterior.leida && anterior.tipo !== "gps_simulado_en_lote") || accionando) return;
    setAccionando(true); setError(null);
    try {
      await eliminarNotificacionLeida(establecimientoId, id);
      const restantes = items.filter((item) => item.id !== id);
      setItems(restantes);
      setTotal((cantidad) => Math.max(0, cantidad - 1));
      if (restantes.length === 0 && offset > 0) setOffset((actual) => Math.max(0, actual - LIMIT));
      else await cargar(offset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar la notificación.");
    } finally { setAccionando(false); }
  }

  return {
    items, noLeidas, offset, total, hayMas, cargando, accionando, error,
    recargar: () => cargar(offset),
    marcarLeida,
    marcarTodas,
    eliminarLeida,
    anterior: () => setOffset((actual) => Math.max(0, actual - LIMIT)),
    siguiente: () => { if (hayMas) setOffset((actual) => actual + LIMIT); },
    limit: LIMIT,
  };
}
