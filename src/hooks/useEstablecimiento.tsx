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
    const sesionPerdida = () => { if (vigente) { setDatos(null); setError('Otra persona tomó esta cuenta operativa o la sesión venció. Volvé a mis establecimientos para entrar nuevamente.'); } };
    window.addEventListener('rodeo:sesion-operativa-perdida', sesionPerdida);
    return () => { vigente = false; window.removeEventListener('focus', cargar); window.removeEventListener('rodeo:sesion-operativa-perdida', sesionPerdida); window.clearInterval(timer); };
  }, [establecimientoId, nuevo]);
  if (error) return (
    <main className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6">
      <p role="alert" className="m-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-normal text-amber-900">{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={recargar} className="cursor-pointer rounded-full border-0 bg-[var(--color-campo-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-campo-600)]">Reintentar</button>
        <Link to="/" className="rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 no-underline hover:bg-gray-200">Mis establecimientos</Link>
      </div>
    </main>
  );
  if (!nuevo && !datos) return <p className="p-6">Cargando establecimiento…</p>;
  return <ContextoEstablecimiento.Provider value={{ establecimientoId: nuevo ? '' : establecimientoId, membresia: datos?.membresia ?? null, establecimiento: datos?.establecimiento ?? null, recargar }}>{children}</ContextoEstablecimiento.Provider>;
}
