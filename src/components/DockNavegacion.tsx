import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useDockOculto } from "../hooks/useOcultarDock";

interface ItemDock {
  etiqueta: string;
  activo: boolean;
  onClick: () => void;
}

const PASTILLA = "foco-campo cursor-pointer whitespace-nowrap rounded-full border-0 px-4 py-1.5 text-[0.85rem] font-medium text-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-colors duration-150";

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
  const dockOculto = useDockOculto();

  useEffect(() => { setConfigAbierta(false); }, [pathname]);

  useEffect(() => {
    if (!configAbierta) return;
    const cerrarConEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setConfigAbierta(false); };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [configAbierta]);

  // El onboarding es un flujo cerrado e irreversible: hasta terminarlo no hay
  // otras pantallas a las que ir, así que el dock no aparece. Tampoco mientras
  // la pantalla actual está cargando (useOcultarDock).
  const enOnboarding = !establecimientoId || Boolean(membresia?.principal && !establecimiento?.onboardingCompleted);
  if (enOnboarding || dockOculto) return null;

  const base = `/establecimientos/${establecimientoId}`;
  const enMapa = pathname === base || pathname === `${base}/`;
  const items: ItemDock[] = [
    { etiqueta: "Mi campo", activo: enMapa, onClick: () => navigate(base) },
    { etiqueta: "Mis dispositivos", activo: pathname.startsWith(`${base}/dispositivos`), onClick: () => navigate(`${base}/dispositivos`) },
    { etiqueta: "Equipo", activo: pathname.startsWith(`${base}/equipo`), onClick: () => navigate(`${base}/equipo`) },
  ];

  // En el mapa la sidebar ocupa la izquierda: el dock se centra sobre lo que
  // queda de mapa (ancho de la sidebar más sus márgenes).
  const posicion = enMapa ? "md:left-[calc(var(--ancho-sidebar)+1.5rem)]" : "";

  return (
    <>
      {configAbierta && <div className="fixed inset-0 z-[1450]" aria-hidden="true" onClick={() => setConfigAbierta(false)} />}
      <div className={`pointer-events-none fixed inset-x-0 bottom-3 z-[1500] flex justify-center px-3 ${posicion}`}>
        <nav
          aria-label="Navegación principal"
          className="pointer-events-auto relative flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full bg-vidrio-claro p-1.5 backdrop-blur-[14px]"
        >
          {items.map((item) => (
            <button
              key={item.etiqueta}
              type="button"
              aria-current={item.activo ? "page" : undefined}
              onClick={item.onClick}
              className={`${PASTILLA} ${item.activo ? "bg-[var(--color-lima)] hover:bg-[var(--color-verde-accion)]" : "bg-white hover:bg-gray-100"}`}
            >
              {item.etiqueta}
            </button>
          ))}
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={configAbierta}
            onClick={() => setConfigAbierta((v) => !v)}
            className={`${PASTILLA} ${configAbierta ? "bg-[var(--color-lima)] hover:bg-[var(--color-verde-accion)]" : "bg-white hover:bg-gray-100"}`}
          >
            Configuración
          </button>

          {configAbierta && (
            <div
              role="menu"
              className="absolute right-0 bottom-full mb-2 flex w-64 flex-col gap-1 rounded-2xl bg-white p-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
            >
              <div className="flex min-w-0 flex-col gap-0.5 border-b border-gray-200 pb-2">
                <span className="text-[0.7rem] uppercase tracking-[0.05em] text-slate-400">Sesión activa</span>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-700">{usuarioNombre}</strong>
                {establecimiento && <span className="truncate text-[0.78rem] text-slate-500">{establecimiento.nombre}</span>}
              </div>
              <Link role="menuitem" to="/" className="rounded-md px-2 py-2 font-semibold text-gray-900 hover:bg-gray-100">
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
          )}
        </nav>
      </div>
    </>
  );
}
