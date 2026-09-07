import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cargarEstablecimiento, puede, type Membresia, type PermisoAdmin } from '../api/establecimientos';
import type { Establecimiento } from '../types';

interface Contexto {
  establecimientoId: string;
  membresia: Membresia | null;
  establecimiento: Establecimiento | null;
  recargar: () => Promise<void>;
}
const ContextoEstablecimiento = createContext<Contexto | null>(null);
export function useEstablecimiento() {
  const valor = useContext(ContextoEstablecimiento);
  if (!valor) throw new Error('Falta el contexto explícito del establecimiento.');
  return { ...valor, puede: (permiso: PermisoAdmin) => puede(valor.membresia, permiso) };
}
export function ProveedorEstablecimiento({ children, nuevo = false }: { children: ReactNode; nuevo?: boolean }) {
  const { establecimientoId = '' } = useParams();
  return <ProveedorPorId key={nuevo ? 'nuevo' : establecimientoId} nuevo={nuevo}>{children}</ProveedorPorId>;
}
function ProveedorPorId({ children, nuevo = false }: { children: ReactNode; nuevo?: boolean }) {
  const { establecimientoId = '' } = useParams();
  const [datos, setDatos] = useState<{ establecimiento: Establecimiento; membresia: Membresia } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function recargar() {
    if (nuevo) return;
    try { setDatos(await cargarEstablecimiento(establecimientoId)); setError(null); }
    catch (e) { setDatos(null); setError(e instanceof Error ? e.message : 'No se pudo cargar el establecimiento.'); }
  }
  useEffect(() => {
    let vigente = true;
    const cargar = () => { if (!nuevo) cargarEstablecimiento(establecimientoId).then(d => { if (vigente) { setDatos(d); setError(null); } }).catch(e => { if (vigente) { setDatos(null); setError(e.message); } }); };
    cargar();
    window.addEventListener('focus', cargar);
    const timer = window.setInterval(cargar, 30000);
    return () => { vigente = false; window.removeEventListener('focus', cargar); window.clearInterval(timer); };
  }, [establecimientoId, nuevo]);
  if (error) return <main className="p-6"><p role="alert">{error}</p><Link to="/">Mis establecimientos</Link><button onClick={recargar}>Reintentar</button></main>;
  if (!nuevo && !datos) return <p className="p-6">Cargando establecimiento…</p>;
  return <ContextoEstablecimiento.Provider value={{ establecimientoId: nuevo ? '' : establecimientoId, membresia: datos?.membresia ?? null, establecimiento: datos?.establecimiento ?? null, recargar }}>{children}</ContextoEstablecimiento.Provider>;
}
