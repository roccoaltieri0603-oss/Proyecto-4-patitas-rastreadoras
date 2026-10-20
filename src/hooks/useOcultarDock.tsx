import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

interface ContextoDock {
  oculto: boolean;
  setOculto: (oculto: boolean) => void;
  sidebarOculta: boolean;
  setSidebarOculta: (oculta: boolean) => void;
}

const ContextoDock = createContext<ContextoDock>({
  oculto: false,
  setOculto: () => {},
  sidebarOculta: false,
  setSidebarOculta: () => {},
});

/**
 * Estado del cromo que flota sobre las pantallas del establecimiento: si el
 * dock se muestra y si la sidebar del mapa está escondida. Vive acá arriba
 * porque el dock se monta fuera del árbol de las pantallas (ver App.tsx) y
 * porque esconder la sidebar tiene que sobrevivir al cambio de ruta.
 */
export function ProveedorDock({ children }: { children: ReactNode }) {
  const [oculto, setOculto] = useState(false);
  const [sidebarOculta, setSidebarOculta] = useState(false);
  return (
    <ContextoDock.Provider value={{ oculto, setOculto, sidebarOculta, setSidebarOculta }}>
      {children}
    </ContextoDock.Provider>
  );
}

/**
 * Una pantalla oculta el dock mientras muestra su estado de carga o de error:
 * el dock recién aparece con la pantalla ya armada. Es layout effect para que
 * no llegue a pintarse ni un cuadro encima de la pantalla de carga.
 */
export function useOcultarDock(ocultar: boolean) {
  const { setOculto } = useContext(ContextoDock);
  useLayoutEffect(() => {
    if (!ocultar) return;
    setOculto(true);
    return () => setOculto(false);
  }, [ocultar, setOculto]);
}

export function useDockOculto(): boolean {
  return useContext(ContextoDock).oculto;
}

/**
 * La sidebar del mapa se esconde para ver el mapa entero. Lo comparten la
 * sidebar (que se corre), la pantalla del mapa (flecha de reapertura y avisos
 * de arriba) y el dock, que se recentra sobre el mapa libre.
 */
export function useSidebarOculta(): [boolean, (oculta: boolean) => void] {
  const { sidebarOculta, setSidebarOculta } = useContext(ContextoDock);
  return [sidebarOculta, setSidebarOculta];
}
