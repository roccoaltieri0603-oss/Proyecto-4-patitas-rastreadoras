import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

interface ContextoDock {
  oculto: boolean;
  setOculto: (oculto: boolean) => void;
}

const ContextoDock = createContext<ContextoDock>({ oculto: false, setOculto: () => {} });

/** Envuelve las pantallas del establecimiento y el dock que flota sobre ellas. */
export function ProveedorDock({ children }: { children: ReactNode }) {
  const [oculto, setOculto] = useState(false);
  return <ContextoDock.Provider value={{ oculto, setOculto }}>{children}</ContextoDock.Provider>;
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
