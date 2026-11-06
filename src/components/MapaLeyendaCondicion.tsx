import { COLOR_RADAR, COLOR_SIN_DATOS, DEGRADADO_NDVI, ESCALA_NDVI, formatoNdvi } from "../copernicus/presentacion";

/**
 * Escala de colores del mapa: flota sobre el borde derecho, como la leyenda de
 * un mapa. Es continua, por la mediana de NDVI, sin categorías. El radar va
 * aparte, con su propio color: el RVI no entra en la escala de NDVI.
 */
export default function MapaLeyendaCondicion() {
  return (
    <div className="pointer-events-none absolute top-1/2 right-3 z-[1000] -translate-y-1/2">
      <div
        role="img"
        aria-label={`Escala de NDVI de ${formatoNdvi(ESCALA_NDVI.minimo)} a ${formatoNdvi(ESCALA_NDVI.maximo)}; aparte, radar Sentinel-1 sin NDVI y gris sin datos`}
        className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-full border border-white/20 bg-panel-azul px-1.5 py-3 text-[0.62rem] font-semibold text-white shadow-md backdrop-blur-sm"
      >
        <span>NDVI</span>
        <span>{formatoNdvi(ESCALA_NDVI.maximo)}</span>
        <span className="h-28 w-3.5 rounded-full border-2 border-white shadow-md" style={{ background: DEGRADADO_NDVI }} />
        <span>{formatoNdvi(ESCALA_NDVI.minimo)}</span>
        <span title="Radar Sentinel-1: sin imagen óptica" className="mt-1 h-3.5 w-3.5 flex-none rounded-full border-2 border-white shadow-md" style={{ background: COLOR_RADAR }} />
        <span className="w-10 text-center text-[0.55rem] leading-tight">Radar (respaldo)</span>
        <span title="Sin datos" className="mt-1 h-3.5 w-3.5 flex-none rounded-full border-2 border-white shadow-md" style={{ background: COLOR_SIN_DATOS }} />
        <span className="text-[0.55rem] leading-none">sin datos</span>
      </div>
    </div>
  );
}
