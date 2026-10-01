import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import Dock, { type DockItemData } from "./ui/Dock";

const ICONO = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;

function IconoInicio() {
  return (
    <svg {...ICONO}>
      <path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoDispositivos() {
  return (
    <svg {...ICONO}>
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 16.5a6.4 6.4 0 0 0 0-9M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 19.5a10.6 10.6 0 0 0 0-15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconoEquipo() {
  return (
    <svg {...ICONO}>
      <circle cx="9" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 19.5c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.9c2.1.5 3.5 2 3.5 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconoConfiguracion() {
  return (
    <svg {...ICONO}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface DockNavegacionProps {
  usuarioNombre: string;
  onLogout: () => void;
}

/**
 * Navegación flotante de las pantallas del establecimiento. Vive sobre el mapa
 * y sobre las pantallas de datos, así que se ancla a la ventana.
 */
export default function DockNavegacion({ usuarioNombre, onLogout }: DockNavegacionProps) {
  const { establecimientoId, establecimiento, membresia } = useEstablecimiento();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [configAbierta, setConfigAbierta] = useState(false);

  useEffect(() => { setConfigAbierta(false); }, [pathname]);

  useEffect(() => {
    if (!configAbierta) return;
    const cerrarConEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setConfigAbierta(false); };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [configAbierta]);

  // El onboarding es un flujo cerrado e irreversible: hasta terminarlo no hay
  // otras pantallas a las que ir, así que el dock no aparece.
  const enOnboarding = !establecimientoId || Boolean(membresia?.principal && !establecimiento?.onboardingCompleted);
  if (enOnboarding) return null;

  const base = `/establecimientos/${establecimientoId}`;
  const items: DockItemData[] = [
    { icon: <IconoInicio />, label: "Inicio", activo: pathname === base || pathname === `${base}/`, onClick: () => navigate(base) },
    { icon: <IconoDispositivos />, label: "Dispositivos", activo: pathname.startsWith(`${base}/dispositivos`), onClick: () => navigate(`${base}/dispositivos`) },
    { icon: <IconoEquipo />, label: "Equipo", activo: pathname.startsWith(`${base}/equipo`), onClick: () => navigate(`${base}/equipo`) },
    { icon: <IconoConfiguracion />, label: "Configuración", activo: configAbierta, onClick: () => setConfigAbierta((v) => !v) },
  ];

  return (
    <>
      {configAbierta && (
        <>
          <div className="fixed inset-0 z-[1450]" aria-hidden="true" onClick={() => setConfigAbierta(false)} />
          <div
            role="menu"
            className="fixed bottom-24 left-1/2 z-[1500] flex w-64 -translate-x-1/2 flex-col gap-1 rounded-2xl bg-white p-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
          >
            <div className="flex min-w-0 flex-col gap-0.5 border-b border-gray-200 pb-2">
              <span className="text-[0.7rem] uppercase tracking-[0.05em] text-slate-400">Sesión activa</span>
              <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-700">{usuarioNombre}</strong>
              {establecimiento && <span className="truncate text-[0.78rem] text-slate-500">{establecimiento.nombre}</span>}
            </div>
            <Link role="menuitem" to="/" className="rounded-md px-2 py-2 font-semibold text-brand hover:bg-gray-100">
              Mis establecimientos
            </Link>
            <button
              role="menuitem"
              type="button"
              className="cursor-pointer rounded-md border-0 border-t border-gray-200 bg-transparent px-2 py-2 text-left font-semibold text-red-700 hover:bg-gray-100"
              onClick={onLogout}
            >
              Cerrar sesión
            </button>
          </div>
        </>
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1400] flex justify-center">
        <Dock items={items} />
      </div>
    </>
  );
}
