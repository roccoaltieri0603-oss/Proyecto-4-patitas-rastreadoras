import { useCallback, useEffect, useState } from "react";
import { marcarNotificacionLeida, marcarTodasLeidas, obtenerNotificaciones, type Notificacion } from "../api/notificaciones";

const LIMIT = 20;

export function useNotificaciones(habilitado: boolean) {
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
      const pagina = await obtenerNotificaciones({ limit: LIMIT, offset: paginaOffset });
      setItems(pagina.notificaciones);
      setNoLeidas(pagina.noLeidas);
      setTotal(pagina.paginacion.total);
      setHayMas(pagina.paginacion.hayMas);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar las notificaciones.");
    } finally {
      setCargando(false);
    }
  }, [habilitado]);

  useEffect(() => {
    if (!habilitado) {
      setItems([]); setNoLeidas(0); setOffset(0); setTotal(0); setHayMas(false); setError(null);
      return;
    }
    void cargar(offset);
  }, [cargar, habilitado, offset]);

  async function marcarLeida(id: string) {
    const anterior = items.find((item) => item.id === id);
    if (!anterior || anterior.leida || accionando) return;
    setAccionando(true); setError(null);
    try {
      const actualizada = await marcarNotificacionLeida(id);
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
      await marcarTodasLeidas();
      const ahora = new Date().toISOString();
      setItems((actuales) => actuales.map((item) => item.leida ? item : { ...item, leida: true, readAt: ahora }));
      setNoLeidas(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron marcar las notificaciones.");
    } finally { setAccionando(false); }
  }

  return {
    items, noLeidas, offset, total, hayMas, cargando, accionando, error,
    recargar: () => cargar(offset),
    marcarLeida,
    marcarTodas,
    anterior: () => setOffset((actual) => Math.max(0, actual - LIMIT)),
    siguiente: () => { if (hayMas) setOffset((actual) => actual + LIMIT); },
    limit: LIMIT,
  };
}
