import { useCallback, useEffect, useState } from 'react';
import { eliminarNotificacionPersonalLeida, marcarNotificacionPersonalLeida, marcarTodasPersonalesLeidas, obtenerNotificacionesPersonales, type NotificacionPersonal } from '../api/notificaciones';
import { EVENTO_CAMBIO_NOTIFICACIONES } from './useNotificaciones';

const LIMIT = 20;

export function useNotificacionesPersonales() {
  const [items, setItems] = useState<NotificacionPersonal[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [accionando, setAccionando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async (paginaOffset = offset) => {
    setCargando(true); setError(null);
    try {
      const pagina = await obtenerNotificacionesPersonales({ limit: LIMIT, offset: paginaOffset });
      setItems(pagina.notificaciones); setNoLeidas(pagina.noLeidas);
      setTotal(pagina.paginacion.total); setHayMas(pagina.paginacion.hayMas);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar tus avisos personales.'); }
    finally { setCargando(false); }
  }, [offset]);
  useEffect(() => { void cargar(offset); }, [cargar, offset]);
  useEffect(() => {
    const actualizar = () => { if (document.visibilityState === 'visible') void cargar(offset); };
    window.addEventListener(EVENTO_CAMBIO_NOTIFICACIONES, actualizar);
    return () => window.removeEventListener(EVENTO_CAMBIO_NOTIFICACIONES, actualizar);
  }, [cargar, offset]);
  async function marcarLeida(id: string) {
    const item = items.find((actual) => actual.id === id);
    if (!item || item.leida || accionando) return;
    setAccionando(true); setError(null);
    try {
      await marcarNotificacionPersonalLeida(id);
      setItems((actuales) => actuales.map((actual) => actual.id === id ? { ...actual, leida: true, readAt: new Date().toISOString() } : actual));
      setNoLeidas((actual) => Math.max(0, actual - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar el aviso como leído.');
    } finally { setAccionando(false); }
  }
  async function marcarTodas() {
    if (!noLeidas || accionando) return;
    setAccionando(true); setError(null);
    try {
      await marcarTodasPersonalesLeidas();
      setItems((actuales) => actuales.map((actual) => actual.leida ? actual : { ...actual, leida: true, readAt: new Date().toISOString() }));
      setNoLeidas(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron marcar los avisos como leídos.');
    } finally { setAccionando(false); }
  }
  async function eliminarLeida(id: string) {
    const item = items.find((actual) => actual.id === id);
    if (!item || !item.leida || accionando) return;
    setAccionando(true); setError(null);
    try {
      await eliminarNotificacionPersonalLeida(id);
      const restantes = items.filter((actual) => actual.id !== id);
      setItems(restantes); setTotal((actual) => Math.max(0, actual - 1));
      if (restantes.length === 0 && offset > 0) setOffset((actual) => Math.max(0, actual - LIMIT));
      else await cargar(offset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ocultar el aviso.');
    } finally { setAccionando(false); }
  }
  return {
    items, noLeidas, offset, total, hayMas, limit: LIMIT, cargando, accionando, error,
    recargar: () => cargar(offset), marcarLeida, marcarTodas, eliminarLeida,
    anterior: () => setOffset((actual) => Math.max(0, actual - LIMIT)),
    siguiente: () => { if (hayMas) setOffset((actual) => actual + LIMIT); },
  };
}
