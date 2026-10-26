import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AvisoInfoProps {
  /** Lo que se lee al pasar el cursor o al tocar el círculo. */
  children: ReactNode;
  /** Para lectores de pantalla y como título del globo. */
  titulo?: string;
  /** `aviso`: círculo amarillo con "!", algo a tener en cuenta. `info`: círculo gris con "i", una aclaración. */
  tono?: "aviso" | "info";
  className?: string;
}

const ANCHO = 272;
const MARGEN = 12;

const CIRCULO = {
  aviso: "bg-amber-400 text-amber-950 hover:bg-amber-500",
  info: "bg-gray-200 text-gray-600 hover:bg-gray-300",
};

/**
 * Un círculo chico en lugar de un párrafo: el texto aparece al pasar el cursor,
 * al enfocarlo con el teclado o al tocarlo, y se cierra al salir, con Escape o
 * tocando afuera. El globo va al body para que la sidebar, con su scroll y su
 * backdrop-filter, no lo recorte.
 */
export default function AvisoInfo({ children, titulo, tono = "aviso", className = "" }: AvisoInfoProps) {
  const id = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const cierre = useRef<number | null>(null);
  const [fijo, setFijo] = useState(false);
  const [encima, setEncima] = useState(false);
  const [posicion, setPosicion] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const abierto = fijo || encima;

  function ubicar() {
    const caja = boton.current?.getBoundingClientRect();
    if (!caja) return;
    const ancho = Math.min(ANCHO, window.innerWidth - 2 * MARGEN);
    const left = Math.min(Math.max(caja.left + caja.width / 2 - ancho / 2, MARGEN), window.innerWidth - ancho - MARGEN);
    // Abajo del círculo, salvo que esté en la parte baja de la pantalla.
    setPosicion(caja.bottom > window.innerHeight * 0.6
      ? { left, bottom: window.innerHeight - caja.top + 8 }
      : { left, top: caja.bottom + 8 });
  }

  useLayoutEffect(() => { if (abierto) ubicar(); }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (evento: PointerEvent) => {
      const objetivo = evento.target as Node;
      if (!boton.current?.contains(objetivo) && !globo.current?.contains(objetivo)) { setFijo(false); setEncima(false); }
    };
    const tecla = (evento: KeyboardEvent) => { if (evento.key === "Escape") { setFijo(false); setEncima(false); } };
    document.addEventListener("pointerdown", afuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("pointerdown", afuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", ubicar, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [abierto]);

  useEffect(() => () => { if (cierre.current) window.clearTimeout(cierre.current); }, []);

  // Un respiro al salir, para poder pasar del círculo al globo sin que se cierre.
  function entrar() {
    if (cierre.current) window.clearTimeout(cierre.current);
    setEncima(true);
  }
  function salir() {
    cierre.current = window.setTimeout(() => setEncima(false), 150);
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label={titulo ?? (tono === "aviso" ? "Ver aviso" : "Ver aclaración")}
        aria-expanded={abierto}
        aria-describedby={abierto ? id : undefined}
        className={`foco-campo inline-flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-full border-0 p-0 align-middle text-[0.7rem] leading-none font-bold transition-colors ${CIRCULO[tono]} ${className}`}
        onClick={(evento) => { evento.stopPropagation(); setFijo((actual) => !actual); }}
        onMouseEnter={entrar}
        onMouseLeave={salir}
        onFocus={entrar}
        onBlur={salir}
      >
        <span aria-hidden="true">{tono === "aviso" ? "!" : "i"}</span>
      </button>
      {abierto && posicion && createPortal(
        <div
          ref={globo}
          id={id}
          role="tooltip"
          className="fixed z-[2500] rounded-xl border border-gray-200 bg-white p-3 text-left text-[0.8rem] leading-snug font-normal text-gray-700 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
          style={{ ...posicion, width: Math.min(ANCHO, window.innerWidth - 2 * MARGEN) }}
          onMouseEnter={entrar}
          onMouseLeave={salir}
          onClick={(evento) => evento.stopPropagation()}
        >
          {titulo && <strong className={`mb-1 block text-[0.78rem] ${tono === "aviso" ? "text-amber-800" : "text-gray-900"}`}>{titulo}</strong>}
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
