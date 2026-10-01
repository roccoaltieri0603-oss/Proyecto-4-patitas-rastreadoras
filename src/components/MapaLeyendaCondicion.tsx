import { COLOR_CATEGORIA, COLOR_RADAR, COLOR_SIN_DATOS, ETIQUETA_CATEGORIA } from "../copernicus/presentacion";

const ITEMS = [
  { clave: "excelente", etiqueta: ETIQUETA_CATEGORIA.excelente, color: COLOR_CATEGORIA.excelente },
  { clave: "buena", etiqueta: ETIQUETA_CATEGORIA.buena, color: COLOR_CATEGORIA.buena },
  { clave: "regular", etiqueta: ETIQUETA_CATEGORIA.regular, color: COLOR_CATEGORIA.regular },
  { clave: "baja", etiqueta: ETIQUETA_CATEGORIA.baja, color: COLOR_CATEGORIA.baja },
  { clave: "radar", etiqueta: "Radar (respaldo)", color: COLOR_RADAR },
  { clave: "sin-dato", etiqueta: "Sin dato", color: COLOR_SIN_DATOS },
] as const;

/** Escala de colores del mapa: flota sobre el borde derecho, como la leyenda de un mapa. */
export default function MapaLeyendaCondicion() {
  return (
    <div className="pointer-events-none absolute top-1/2 right-3 z-[1000] -translate-y-1/2">
      <div className="pointer-events-auto flex flex-col items-center gap-2.5 rounded-full border border-gray-200 bg-gray-100/90 px-1.5 py-3 shadow-md backdrop-blur-sm">
        {ITEMS.map((item) => (
          <div key={item.clave} className="group relative flex items-center justify-center">
            <span className="pointer-events-none absolute right-full mr-2 max-w-0 overflow-hidden rounded-full bg-white/95 py-1 text-[0.75rem] font-semibold whitespace-nowrap text-gray-700 opacity-0 shadow-md transition-all duration-200 group-hover:max-w-[12rem] group-hover:px-2.5 group-hover:opacity-100">
              {item.etiqueta}
            </span>
            <span
              className="h-4 w-4 flex-none rounded-full border-2 border-white shadow-md transition-transform duration-200 group-hover:scale-125"
              style={{ background: item.color }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
