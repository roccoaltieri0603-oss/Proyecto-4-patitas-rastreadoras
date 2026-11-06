import { useState } from "react";
import { INGRESO_MAPA, ORDEN_INGRESO_MAPA, type IngresoMapa } from "../estimacion/presentacion";

/**
 * Leyenda del mapa: flota sobre el borde derecho. Cada lote se pinta según qué
 * tan apto está para que entren los animales hoy. Es una columna de puntos; al
 * pasar el mouse sobre uno (o con el foco del teclado, o tocándolo en pantallas
 * táctiles) se despliega a su izquierda sólo el texto de ese color.
 */
export default function MapaLeyendaCondicion() {
  const [tocado, setTocado] = useState<IngresoMapa | null>(null);
  return (
    <div className="pointer-events-none absolute top-1/2 right-3 z-[1000] -translate-y-1/2">
      <ul
        aria-label="Leyenda: aptitud de cada lote para entrar hoy"
        className="pointer-events-auto m-0 flex list-none flex-col gap-2.5 rounded-full border border-white/20 bg-panel-azul px-1.5 py-3 shadow-md backdrop-blur-sm"
      >
        {ORDEN_INGRESO_MAPA.map((tipo) => {
          const abierto = tocado === tipo;
          return (
            <li key={tipo} className="relative flex items-center justify-center">
              <button
                type="button"
                aria-label={`${INGRESO_MAPA[tipo].texto}: ${INGRESO_MAPA[tipo].detalle}`}
                aria-expanded={abierto}
                onClick={() => setTocado(abierto ? null : tipo)}
                onBlur={() => setTocado((actual) => (actual === tipo ? null : actual))}
                className="group/item flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none"
              >
                <span
                  className={`pointer-events-none absolute right-full mr-2.5 overflow-hidden rounded-xl border border-white/20 bg-panel-azul text-left whitespace-nowrap text-white shadow-md transition-all duration-200 ${
                    abierto
                      ? "max-w-[12rem] px-2.5 py-1 opacity-100"
                      : "max-w-0 px-0 py-1 opacity-0 group-hover/item:max-w-[12rem] group-hover/item:px-2.5 group-hover/item:opacity-100 group-focus-visible/item:max-w-[12rem] group-focus-visible/item:px-2.5 group-focus-visible/item:opacity-100"
                  }`}
                >
                  <span className="block text-[0.72rem] leading-tight font-semibold">{INGRESO_MAPA[tipo].texto}</span>
                  <span className="block text-[0.62rem] leading-tight text-white/75">{INGRESO_MAPA[tipo].detalle}</span>
                </span>
                <span
                  className="h-4 w-4 flex-none rounded-full border-2 border-white shadow-md transition-transform duration-200 group-hover/item:scale-125 group-focus-visible/item:scale-125"
                  style={{ background: INGRESO_MAPA[tipo].color }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
