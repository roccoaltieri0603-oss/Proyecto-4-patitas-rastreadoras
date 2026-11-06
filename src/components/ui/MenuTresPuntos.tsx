import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface OpcionMenu {
  etiqueta: string;
  onSelect: () => void;
  icono?: ReactNode;
  disabled?: boolean;
  /** Aclaración al pasar el mouse, por ejemplo por qué está deshabilitada. */
  title?: string;
}

/**
 * Botón "⋯" que despliega acciones secundarias. Se cierra al elegir, al hacer
 * clic afuera o con Escape (y vuelve el foco al botón). Si no hay opciones, no
 * se dibuja: un menú vacío sería un botón que no hace nada.
 */
export default function MenuTresPuntos({ opciones, etiqueta = "Más acciones", className = "" }: {
  opciones: OpcionMenu[];
  etiqueta?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();

  useEffect(() => {
    if (!abierto) return;
    const alTocarAfuera = (evento: PointerEvent) => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    const alApretarTecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") { setAbierto(false); boton.current?.focus(); }
    };
    document.addEventListener("pointerdown", alTocarAfuera);
    document.addEventListener("keydown", alApretarTecla);
    // Al abrir, el foco va a la primera opción habilitada.
    contenedor.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener("pointerdown", alTocarAfuera);
      document.removeEventListener("keydown", alApretarTecla);
    };
  }, [abierto]);

  if (opciones.length === 0) return null;

  /** Flechas arriba y abajo recorren las opciones, como en un menú nativo. */
  function moverFoco(evento: React.KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") return;
    evento.preventDefault();
    const items = [...(contenedor.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const actual = items.indexOf(document.activeElement as HTMLButtonElement);
    const siguiente = evento.key === "ArrowDown" ? (actual + 1) % items.length : (actual - 1 + items.length) % items.length;
    items[siguiente]?.focus();
  }

  return (
    <div ref={contenedor} className={`relative ${className}`}>
      <button
        ref={boton}
        type="button"
        aria-label={etiqueta}
        title={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto((valor) => !valor)}
        className={`foco-campo flex size-10 flex-none cursor-pointer items-center justify-center rounded-full border-2 bg-white text-gray-800 shadow-sm transition-colors hover:bg-gray-50 ${abierto ? "border-[var(--color-campo-600)]" : "border-gray-300"}`}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.8" />
          <circle cx="10" cy="10" r="1.8" />
          <circle cx="16" cy="10" r="1.8" />
        </svg>
      </button>
      {abierto && (
        <div
          id={idMenu}
          role="menu"
          aria-label={etiqueta}
          onKeyDown={moverFoco}
          className="absolute top-full left-0 z-[1000] mt-2 flex min-w-[210px] flex-col gap-0.5 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,26,20,0.18)]"
        >
          {opciones.map((opcion) => (
            <button
              key={opcion.etiqueta}
              type="button"
              role="menuitem"
              disabled={opcion.disabled}
              title={opcion.title}
              onClick={() => { setAbierto(false); opcion.onSelect(); }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium text-gray-900 transition-colors hover:bg-[var(--color-campo-50)] focus-visible:bg-[var(--color-campo-50)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            >
              {opcion.icono && <span className="flex size-5 flex-none items-center justify-center text-[var(--color-campo-700)]">{opcion.icono}</span>}
              {opcion.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
