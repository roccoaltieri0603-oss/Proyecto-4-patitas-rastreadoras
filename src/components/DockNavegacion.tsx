import { useEffect, useState, type ComponentProps } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { salirDelEstablecimiento } from "../api/establecimientos";
import { useDockOculto, useSidebarOculta } from "../hooks/useOcultarDock";
import PillNav, { type PillNavItem } from "./ui/PillNav";

interface DockNavegacionProps {
  usuarioNombre: string;
  onLogout: () => void;
}

/**
 * PillNav pasa `href` a su componente de enlace; el `Link` de react-router
 * espera `to`. Este envoltorio traduce uno en el otro para que las pastillas
 * sigan siendo anclas de verdad (botón del medio, abrir en pestaña nueva).
 */
function EnlaceDock({ href = "", ...resto }: { href?: string } & Omit<ComponentProps<typeof Link>, "to">) {
  return <Link to={href} {...resto} />;
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
  const [errorSalida, setErrorSalida] = useState('');
  const dockOculto = useDockOculto();
  const [sidebarOculta] = useSidebarOculta();

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
  // Configuración va sin href a propósito: PillNav la dibuja como <button> y
  // el clic abre el menú de sesión en lugar de navegar.
  const items: PillNavItem[] = [
    { label: "Mi campo", href: base },
    { label: "Registro de uso", href: `${base}/registro-usos` },
    ...(membresia?.rol === "VISOR" ? [] : [{ label: "Mis dispositivos", href: `${base}/dispositivos` }]),
    { label: "Equipo", href: `${base}/equipo` },
    { label: "Configuración" },
  ];

  // La ruta más larga que coincide gana, así la ficha de lote deja marcado
  // "Mi campo" y /registro-usos no se confunde con la raíz.
  const activeHref = items
    .filter((item): item is PillNavItem & { href: string } => Boolean(item.href))
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // En el mapa la sidebar ocupa la izquierda: el dock se centra sobre lo que
  // queda de mapa (ancho de la sidebar más sus márgenes). Si la sidebar está
  // escondida vuelve al centro de la pantalla, animando `left`.
  const posicion = enMapa && !sidebarOculta ? "md:left-[calc(var(--ancho-sidebar)+1.5rem)]" : "";

  return (
    <>
      {configAbierta && <div className="fixed inset-0 z-[1450]" aria-hidden="true" onClick={() => setConfigAbierta(false)} />}
      <div className={`pointer-events-none fixed inset-x-0 bottom-3 z-[1500] flex justify-center px-3 transition-[left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${posicion}`}>
        <div className="pointer-events-auto relative flex w-full items-end justify-center">
          {configAbierta && (
            <div
              role="menu"
              className="absolute bottom-full left-1/2 mb-2 flex w-72 -translate-x-1/2 flex-col rounded-2xl bg-white p-1.5 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
            >
              <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2.5">
                <span className="text-[0.68rem] font-semibold tracking-[0.08em] text-slate-400 uppercase">Sesión activa</span>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-800">{membresia?.nombreOperativo ?? usuarioNombre}</strong>
                {establecimiento && <span className="truncate text-[0.78rem] text-slate-500">{establecimiento.nombre}</span>}
              </div>
              <button role="menuitem" type="button" className="cursor-pointer rounded-lg border-0 border-t border-gray-200 bg-transparent px-2.5 py-2.5 text-left font-medium text-gray-900 hover:bg-gray-100"
                onClick={async () => { try { await salirDelEstablecimiento(establecimientoId); navigate('/'); }
                  catch (reason) { setErrorSalida(reason instanceof Error ? reason.message : 'No se pudo salir del establecimiento.'); } }}>
                Salir del establecimiento
              </button>
              {errorSalida && <p role="alert" className="px-2.5 text-sm text-red-700">{errorSalida}</p>}
              <button
                role="menuitem"
                type="button"
                className="cursor-pointer rounded-lg border-0 border-t border-gray-200 bg-transparent px-2.5 py-2.5 text-left font-medium text-red-700 hover:bg-gray-100"
                onClick={onLogout}
              >
                Cerrar sesión
              </button>
            </div>
          )}

          {/* El menú colapsado de PillNav se abre hacia abajo, y acá el dock está
              pegado al borde de abajo: quedaría fuera de la pantalla. Así que no
              colapsa nunca y en pantallas angostas la barra se desliza con el
              dedo. El scroll va en este contenedor y no en el de arriba, que
              tiene que poder dejar salir el menú de Configuración. */}
          <div className="sin-barra-scroll max-w-full overflow-x-auto">
            <div className="w-max">
              <PillNav
                items={items}
                activeHref={activeHref}
                linkComponent={EnlaceDock}
                onItemClick={(item, _indice, evento) => {
                  if (item.href) return;
                  evento.preventDefault();
                  setConfigAbierta((abierta) => !abierta);
                }}
                theme="light"
                layout="joined"
                size="sm"
                surface="glass"
                itemStyle="pill"
                hoverEffect="fill"
                indicator="pill"
                barColor="var(--color-vidrio-claro)"
                textColor="#111827"
                highlightColor="#79da58"
                collapse="never"
                ariaLabel="Navegación principal"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
