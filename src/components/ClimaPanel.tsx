import type { Lote } from "../types";
import type { Clima, DiaClima, ResultadoClimaLote } from "../clima/types";
import { ETIQUETA_LLUVIA } from "../clima/interpretacion";
import Button from "./ui/Button";
import Panel from "./ui/Panel";
import { MUTED_SMALL, RANKING_HEADER, RANKING_LIST, RANKING_NOMBRE, RANKING_PUNTAJE, RANKING_PUNTAJE_SIN_DATOS, RANKING_SIN_DATOS_TEXTO, VALORES_INLINE, rankingItemClass } from "./ui/ranking";

interface ClimaPanelProps {
  lotesActivos: Lote[];
  resultados: Record<string, ResultadoClimaLote>;
  consultando: boolean;
  selectedLoteId: string | null;
  onActualizar: () => void;
  onSelectLote: (id: string) => void;
}

function nombreLote(lote: Lote): string {
  return lote.apodo ? `Lote ${lote.numero} — ${lote.apodo}` : `Lote ${lote.numero}`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function etiquetaFecha(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)} ${MESES_CORTOS[Number(mes) - 1]}`;
}

const ANCHO = 300;
const ALTO = 120;
const MARGEN = { arriba: 10, abajo: 22, izquierda: 8, derecha: 8 };
const ANCHO_PLOT = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const ALTO_PLOT = ALTO - MARGEN.arriba - MARGEN.abajo;
const COLOR_LLUVIA = "#2a78d6";
const EJE_CLASS = "text-[8px] fill-gray-400";
const EJE_HOY_CLASS = "text-[8px] font-bold fill-accent";
const VALOR_CLASS = "text-[8px] font-semibold fill-gray-800 tabular-nums";

function GraficoLluvia({ dias }: { dias: DiaClima[] }) {
  const lluviasDisponibles = dias.flatMap((dia) => dia.lluviaMm === null ? [] : [dia.lluviaMm]);
  const maxMm = Math.max(5, ...lluviasDisponibles);
  const dominioMax = maxMm * 1.15;
  const anchoColumna = ANCHO_PLOT / dias.length;
  const anchoBarra = Math.min(18, anchoColumna * 0.6);

  const alturaBarra = (mm: number): number => (mm / dominioMax) * ALTO_PLOT;
  const xCentro = (i: number): number => MARGEN.izquierda + anchoColumna * (i + 0.5);

  const indiceMax = dias.reduce(
    (mejor, dia, indice) => dia.lluviaMm !== null && (mejor === -1 || dia.lluviaMm > (dias[mejor].lluviaMm ?? -Infinity)) ? indice : mejor,
    -1,
  );
  const indiceHoy = dias.findIndex((d) => d.esPronostico);

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      role="img"
      aria-label="Lluvia diaria: últimos 7 días y pronóstico a 5 días"
      className="mt-1 block h-auto w-full"
    >
      <line
        x1={MARGEN.izquierda}
        x2={ANCHO - MARGEN.derecha}
        y1={ALTO - MARGEN.abajo}
        y2={ALTO - MARGEN.abajo}
        stroke="#c3c2b7"
        strokeWidth={1}
      />
      {dias.map((d, i) => {
        const h = d.lluviaMm === null ? 0 : alturaBarra(d.lluviaMm);
        const y = ALTO - MARGEN.abajo - h;
        return (
          <g key={d.fecha}>
            {d.lluviaMm !== null && <rect
              x={xCentro(i) - anchoBarra / 2}
              y={y}
              width={anchoBarra}
              height={Math.max(h, d.lluviaMm > 0 ? 2 : 0)}
              rx={2}
              fill={COLOR_LLUVIA}
              opacity={d.esPronostico ? 0.45 : 1}
              tabIndex={0}
              aria-label={`${etiquetaFecha(d.fecha)}${d.esPronostico ? " (pronóstico)" : ""}: ${d.lluviaMm.toFixed(1)} mm, ${d.tempMin?.toFixed(0) ?? "sin dato"}–${d.tempMax?.toFixed(0) ?? "sin dato"} °C`}
            >
              <title>
                {etiquetaFecha(d.fecha)}
                {d.esPronostico ? " (pronóstico)" : ""}: {d.lluviaMm.toFixed(1)} mm ·{" "}
                {d.tempMin?.toFixed(0) ?? "sin dato"}–{d.tempMax?.toFixed(0) ?? "sin dato"} °C
              </title>
            </rect>}
            {i === indiceMax && d.lluviaMm !== null && d.lluviaMm > 0 && (
              <text x={xCentro(i)} y={y - 4} textAnchor="middle" className={VALOR_CLASS}>
                {d.lluviaMm.toFixed(0)}
              </text>
            )}
            <text
              x={xCentro(i)}
              y={ALTO - 6}
              textAnchor="middle"
              className={i === indiceHoy ? EJE_HOY_CLASS : EJE_CLASS}
            >
              {i === indiceHoy ? "hoy" : etiquetaFecha(d.fecha).split(" ")[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DetalleClima({ clima }: { clima: Clima }) {
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-gray-200 pt-2.5">
      <GraficoLluvia dias={clima.dias} />
    </div>
  );
}

export default function ClimaPanel({
  lotesActivos,
  resultados,
  consultando,
  selectedLoteId,
  onActualizar,
  onSelectLote,
}: ClimaPanelProps) {
  const hayResultados = Object.keys(resultados).length > 0;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base">Clima por lote</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={onActualizar}
          disabled={consultando || lotesActivos.length === 0}
        >
          {consultando ? "Consultando…" : hayResultados ? "Actualizar" : "Consultar"}
        </Button>
      </div>

      {lotesActivos.length === 0 ? (
        <p className={MUTED_SMALL}>
          No hay lotes activos. Activá al menos uno para ver su lluvia.
        </p>
      ) : (
        <p className={MUTED_SMALL}>
          Open-Meteo · lluvia observada de los últimos 7 días y pronóstico a 5, por lote
          (modelo meteorológico, no una estación en el campo).
        </p>
      )}

      {hayResultados && (
        <ol className={RANKING_LIST}>
          {lotesActivos.map((lote) => {
            const resultado = resultados[lote.id];
            const seleccionado = lote.id === selectedLoteId;
            const esOk = resultado?.estado === "ok";

            return (
              <li
                key={lote.id}
                className={rankingItemClass(seleccionado)}
                onClick={() => onSelectLote(lote.id)}
              >
                <div className={RANKING_HEADER}>
                  <span className={RANKING_NOMBRE}>{nombreLote(lote)}</span>
                  {esOk && resultado.clima.lluviaUltimos7Dias !== null ? (
                    <span className={RANKING_PUNTAJE} style={{ background: COLOR_LLUVIA }}>
                      {resultado.clima.lluviaUltimos7Dias.toFixed(0)} mm
                    </span>
                  ) : (
                    <span className={RANKING_PUNTAJE_SIN_DATOS}>—</span>
                  )}
                </div>

                {esOk ? (
                  <>
                    <div className={VALORES_INLINE}>
                      <span>
                        <b>7 días</b> {resultado.clima.lluviaUltimos7Dias?.toFixed(0) ?? "Sin datos"}{resultado.clima.lluviaUltimos7Dias === null ? "" : " mm"}
                      </span>
                      <span>
                        <b>Próx.</b> {resultado.clima.lluviaProximosDias?.toFixed(0) ?? "Sin datos"}{resultado.clima.lluviaProximosDias === null ? "" : " mm"}
                      </span>
                      <span className="text-[0.75rem] font-semibold text-brand">{resultado.categoria ? ETIQUETA_LLUVIA[resultado.categoria] : "Sin categoría"}</span>
                    </div>
                    {seleccionado && <DetalleClima clima={resultado.clima} />}
                  </>
                ) : (
                  <p className={`${MUTED_SMALL} ${RANKING_SIN_DATOS_TEXTO}`}>
                    {resultado?.mensaje ?? "Sin consultar."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
