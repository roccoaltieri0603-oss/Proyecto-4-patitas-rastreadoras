import { useState } from "react";
import type { CondicionLote } from "../copernicus/types";

type PuntoTendencia = CondicionLote["tendencia"][number];
type ClaveIndice = "ndvi" | "ndmi" | "evi" | "ndwi";

interface Serie {
  clave: ClaveIndice;
  nombre: string;
  color: string;
}

// Primeros 4 slots de la paleta categórica: orden fijo, validado contra
// confusión de color (CVD) para líneas adyacentes. No se elige a ojo.
const SERIES: Serie[] = [
  { clave: "ndvi", nombre: "NDVI", color: "#2a78d6" },
  { clave: "ndmi", nombre: "NDMI", color: "#eb6834" },
  { clave: "evi", nombre: "EVI", color: "#1baf7a" },
  { clave: "ndwi", nombre: "NDWI", color: "#eda100" },
];

const ANCHO = 300;
const ALTO = 150;
const MARGEN = { arriba: 12, abajo: 22, izquierda: 30, derecha: 10 };
const ANCHO_PLOT = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const ALTO_PLOT = ALTO - MARGEN.arriba - MARGEN.abajo;

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function etiquetaFecha(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)} ${MESES_CORTOS[Number(mes) - 1]}`;
}

interface TendenciaChartProps {
  tendencia: PuntoTendencia[];
}

/** Evolución de NDVI/NDMI/EVI/NDWI en las últimas fechas despejadas del lote. */
export default function TendenciaChart({ tendencia }: TendenciaChartProps) {
  const [activo, setActivo] = useState<number | null>(null);

  if (tendencia.length < 2) {
    return (
      <p className="muted small tendencia-vacia">
        Todavía no hay suficiente historial despejado para graficar la evolución.
      </p>
    );
  }

  const valores = tendencia.flatMap((p) => SERIES.map((s) => p[s.clave]));
  const dataMin = Math.min(0, ...valores);
  const dataMax = Math.max(0, ...valores);
  const colchon = (dataMax - dataMin || 1) * 0.15;
  const dominioMin = dataMin - colchon;
  const dominioMax = dataMax + colchon;

  const x = (i: number): number =>
    tendencia.length === 1
      ? MARGEN.izquierda + ANCHO_PLOT / 2
      : MARGEN.izquierda + (i / (tendencia.length - 1)) * ANCHO_PLOT;
  const y = (v: number): number =>
    MARGEN.arriba + ALTO_PLOT - ((v - dominioMin) / (dominioMax - dominioMin)) * ALTO_PLOT;

  const anchoColumna = ANCHO_PLOT / tendencia.length;
  const puntoActivo = activo !== null ? tendencia[activo] : null;
  const pctTooltip = activo !== null ? Math.min(85, Math.max(15, (x(activo) / ANCHO) * 100)) : 0;

  return (
    <div className="tendencia-chart">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        role="img"
        aria-label="Evolución de NDVI, NDMI, EVI y NDWI en las últimas fechas despejadas"
      >
        <line
          x1={MARGEN.izquierda}
          x2={ANCHO - MARGEN.derecha}
          y1={y(0)}
          y2={y(0)}
          stroke="#c3c2b7"
          strokeWidth={1}
        />
        <text x={MARGEN.izquierda - 4} y={MARGEN.arriba + 4} textAnchor="end" className="tendencia-eje">
          {dominioMax.toFixed(1)}
        </text>
        <text x={MARGEN.izquierda - 4} y={ALTO - MARGEN.abajo} textAnchor="end" className="tendencia-eje">
          {dominioMin.toFixed(1)}
        </text>

        {SERIES.map((s) => (
          <polyline
            key={s.clave}
            points={tendencia.map((p, i) => `${x(i)},${y(p[s.clave])}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {SERIES.map((s) =>
          tendencia.map((p, i) => (
            <circle
              key={`${s.clave}-${p.fecha}`}
              cx={x(i)}
              cy={y(p[s.clave])}
              r={4}
              fill={s.color}
              stroke="#f9fafb"
              strokeWidth={2}
            />
          )),
        )}

        {activo !== null && (
          <line
            x1={x(activo)}
            x2={x(activo)}
            y1={MARGEN.arriba}
            y2={ALTO - MARGEN.abajo}
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {tendencia.map((p, i) => (
          <g key={p.fecha}>
            <text x={x(i)} y={ALTO - 6} textAnchor="middle" className="tendencia-eje">
              {etiquetaFecha(p.fecha)}
            </text>
            {/* Columna invisible: el objetivo de hover es la fecha entera, no cada punto suelto. */}
            <rect
              x={MARGEN.izquierda + i * anchoColumna}
              y={MARGEN.arriba}
              width={anchoColumna}
              height={ALTO_PLOT}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${etiquetaFecha(p.fecha)}: ${SERIES.map((s) => `${s.nombre} ${p[s.clave].toFixed(2)}`).join(", ")}`}
              onMouseEnter={() => setActivo(i)}
              onMouseLeave={() => setActivo(null)}
              onFocus={() => setActivo(i)}
              onBlur={() => setActivo(null)}
            />
          </g>
        ))}
      </svg>

      {puntoActivo && (
        <div className="tendencia-tooltip" style={{ left: `${pctTooltip}%` }}>
          <b>{etiquetaFecha(puntoActivo.fecha)}</b>
          {SERIES.map((s) => (
            <span key={s.clave}>
              <i style={{ background: s.color }} />
              {s.nombre} {puntoActivo[s.clave].toFixed(2)}
            </span>
          ))}
        </div>
      )}

      <div className="tendencia-leyenda">
        {SERIES.map((s) => (
          <span key={s.clave} className="tendencia-leyenda-item">
            <i style={{ background: s.color }} />
            {s.nombre} <b>{tendencia[tendencia.length - 1][s.clave].toFixed(2)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
