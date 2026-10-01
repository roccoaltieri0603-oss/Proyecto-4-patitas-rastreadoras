import { useState } from "react";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import type { Lote } from "../types";
import type { CategoriaCondicion, CondicionLote, ProyeccionTendencia, ResultadoLote } from "../copernicus/types";
import {
  COLOR_CATEGORIA,
  COLOR_RADAR,
  COLOR_SIN_DATOS,
  ETIQUETA_CATEGORIA,
} from "../copernicus/presentacion";
import TendenciaChart from "./TendenciaChart";
import Panel from "./ui/Panel";
import {
  BADGE_RECOMENDADO,
  CATEGORIA_CHIP,
  MUTED,
  MUTED_SMALL,
  RANKING_HEADER,
  RANKING_LIST,
  RANKING_NOMBRE,
  RANKING_PUNTAJE,
  RANKING_PUNTAJE_SIN_DATOS,
  RANKING_SIN_DATOS_TEXTO,
  RANKING_SUB,
  antiguedadClass,
  categoriaChipStyle,
  rankingItemClass,
} from "./ui/ranking";

interface CondicionPanelProps {
  lotesActivos: Lote[];
  resultados: Record<string, ResultadoLote>;
  analizando: boolean;
  ultimoAnalisis: number | null;
  errorGlobal: string | null;
  credencialesOk: boolean | null;
  selectedLoteId: string | null;
  onAnalizar: () => void;
  onSelectLote: (id: string) => void;
}

/** Clave de agrupación para el filtro: las 4 categorías ópticas + radar + sin dato. */
type ClaveFiltro = CategoriaCondicion | "radar" | "sin-dato";

const OPCIONES_FILTRO: { clave: ClaveFiltro; etiqueta: string; color: string }[] = [
  { clave: "excelente", etiqueta: ETIQUETA_CATEGORIA.excelente, color: COLOR_CATEGORIA.excelente },
  { clave: "buena", etiqueta: ETIQUETA_CATEGORIA.buena, color: COLOR_CATEGORIA.buena },
  { clave: "regular", etiqueta: ETIQUETA_CATEGORIA.regular, color: COLOR_CATEGORIA.regular },
  { clave: "baja", etiqueta: ETIQUETA_CATEGORIA.baja, color: COLOR_CATEGORIA.baja },
  { clave: "radar", etiqueta: "Radar (respaldo)", color: COLOR_RADAR },
  { clave: "sin-dato", etiqueta: "Sin dato", color: COLOR_SIN_DATOS },
];

function nombreLote(lote: Lote): string {
  return lote.apodo ? `Lote ${lote.numero} — ${lote.apodo}` : `Lote ${lote.numero}`;
}

function formatoIndice(valor: number): string {
  return valor.toFixed(2);
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]}`;
}

function antiguedad(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/** Relativo mientras es reciente ("hace 4 días"); más allá de una semana, la fecha sola. */
function fechaOAntiguedad(fecha: string, dias: number): string {
  return dias <= 7 ? antiguedad(dias) : fechaCorta(fecha);
}

/** Naranja/rojo cuando el dato ya tiene varios días encima. */
function claseAntiguedad(dias: number): "fresco" | "tibio" | "viejo" {
  if (dias <= 7) return "fresco";
  if (dias <= 14) return "tibio";
  return "viejo";
}

/** Compara la última mediana de NDVI contra la anterior de la serie. */
function tendenciaNdvi(condicion: CondicionLote): { texto: string; signo: string } | null {
  const serie = condicion.tendencia;
  if (serie.length < 2) return null;
  const delta = serie[serie.length - 1].ndvi - serie[serie.length - 2].ndvi;
  if (Math.abs(delta) < 0.02) return { texto: "estable", signo: "→" };
  return delta > 0
    ? { texto: `+${delta.toFixed(2)} vs. ${fechaCorta(serie[serie.length - 2].fecha)}`, signo: "↑" }
    : { texto: `${delta.toFixed(2)} vs. ${fechaCorta(serie[serie.length - 2].fecha)}`, signo: "↓" };
}

/**
 * Texto de la proyección lineal que calcula el backend sobre el puntaje
 * histórico, o null si no vino (hacen falta al menos tres fechas despejadas).
 */
function textoProyeccion(proyeccion: ProyeccionTendencia): string {
  if (proyeccion.direccion === "estable") {
    return "Tendencia de fondo: estable en las últimas lecturas.";
  }

  const base = `Tendencia de fondo: ${proyeccion.direccion} ~${Math.abs(proyeccion.pendienteSemanal).toFixed(0)} puntos/semana`;
  if (!proyeccion.proximoCambio) return `${base}.`;

  const { categoria, dias } = proyeccion.proximoCambio;
  return `${base}. A ese ritmo, entraría en categoría "${ETIQUETA_CATEGORIA[categoria]}" en ~${dias} días.`;
}

/** Fila de índices: siempre visible, pero deliberadamente chica — el dato que importa es el puntaje. */
const INDICES_CLASS = "mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[0.7rem] text-gray-400 tabular-nums";
const INDICES_LABEL = "font-semibold text-gray-500";

function DetalleCondicion({ condicion }: { condicion: CondicionLote }) {
  const tendencia = tendenciaNdvi(condicion);
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-[var(--color-campo-100)] pt-2">
      <p className={`m-0 ${INDICES_CLASS}`}>
        <span>
          <span className={INDICES_LABEL}>NDVI</span> {formatoIndice(condicion.ndvi.mediana)}{" "}
          ({formatoIndice(condicion.ndvi.min)}–{formatoIndice(condicion.ndvi.max)})
        </span>
        <span>
          <span className={INDICES_LABEL}>NDMI</span> {formatoIndice(condicion.ndmi.media)}
        </span>
        <span>
          <span className={INDICES_LABEL}>EVI</span> {formatoIndice(condicion.evi.media)}
        </span>
        <span>
          <span className={INDICES_LABEL}>NDWI</span> {formatoIndice(condicion.ndwi.media)}
        </span>
      </p>

      <p className={MUTED_SMALL}>
        Sentinel-2 · {fechaOAntiguedad(condicion.fecha, condicion.diasDesde)}
        {tendencia && (
          <>
            {" · NDVI "}
            {tendencia.signo} {tendencia.texto}
          </>
        )}
      </p>

      <TendenciaChart tendencia={condicion.tendencia} />
      {condicion.proyeccion && (
        <p
          className={MUTED_SMALL}
          title="Proyección lineal simple sobre los puntajes históricos del lote — no es un modelo calibrado ni entrenado, sólo la recta que mejor ajusta los puntos de arriba."
        >
          {textoProyeccion(condicion.proyeccion)}
        </p>
      )}

      {condicion.alertas.length > 0 && (
        <ul className="m-0 flex flex-col gap-[3px] pl-[18px]">
          {condicion.alertas.map((alerta) => (
            <li key={alerta} className="text-[0.78rem] leading-[1.35] text-amber-800">{alerta}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Icono de embudo: el filtro, sin emoji. */
function IconoFiltro() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3h12l-4.5 5.5v4L6.5 14v-5.5L2 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Icono de refresco/consulta: reemplaza el texto plano del botón primario. */
function IconoActualizar({ girando }: { girando: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={girando ? "animate-spin" : ""}>
      <path
        d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 1.5V5H10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CondicionPanel({
  lotesActivos,
  resultados,
  analizando,
  ultimoAnalisis,
  errorGlobal,
  credencialesOk,
  selectedLoteId,
  onAnalizar,
  onSelectLote,
}: CondicionPanelProps) {
  const { puede } = useEstablecimiento();
  const [ocultas, setOcultas] = useState<Set<ClaveFiltro>>(new Set());

  // Mejor puntaje primero; los lotes sin dato quedan al final.
  const ranking = [...lotesActivos].sort((a, b) => {
    const ra = resultados[a.id];
    const rb = resultados[b.id];
    const pa = ra?.estado === "ok" ? ra.condicion.puntaje : -1;
    const pb = rb?.estado === "ok" ? rb.condicion.puntaje : -1;
    if (pa !== pb) return pb - pa;
    return a.numero - b.numero;
  });

  const hayResultados = Object.keys(resultados).length > 0;
  const mejor = ranking.find((l) => resultados[l.id]?.estado === "ok");
  const avisoClass = "m-0 rounded-md border border-amber-300 bg-amber-100 p-2.5 text-[0.82rem] leading-normal text-amber-800 [&_code]:rounded [&_code]:bg-black/[0.07] [&_code]:px-1 [&_code]:text-[0.78rem]";

  function claveDe(resultado: ResultadoLote | undefined): ClaveFiltro {
    if (resultado?.estado === "ok") return resultado.condicion.categoria;
    if (resultado?.estado === "radar") return "radar";
    return "sin-dato";
  }

  function alternarFiltro(clave: ClaveFiltro) {
    setOcultas((actual) => {
      const siguiente = new Set(actual);
      siguiente.has(clave) ? siguiente.delete(clave) : siguiente.add(clave);
      return siguiente;
    });
  }

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base">Condición para pastoreo</h3>
        <div className="flex items-center gap-1.5">
          <details className="group relative">
            <summary
              aria-label="Filtrar por condición"
              title="Filtrar"
              className="flex h-7 w-7 list-none items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 transition-colors marker:content-none hover:border-[var(--color-campo-600)] hover:text-[var(--color-campo-700)] [&::-webkit-details-marker]:hidden"
            >
              <IconoFiltro />
            </summary>
            <div className="absolute right-0 z-20 mt-1.5 flex w-44 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              {OPCIONES_FILTRO.map((op) => (
                <label key={op.clave} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[0.78rem] text-gray-700 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={!ocultas.has(op.clave)}
                    onChange={() => alternarFiltro(op.clave)}
                  />
                  <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: op.color }} />
                  {op.etiqueta}
                </label>
              ))}
            </div>
          </details>

          <button
            type="button"
            onClick={onAnalizar}
            disabled={!puede("actualizar_satelite") || analizando || lotesActivos.length === 0}
            className="flex items-center gap-1.5 rounded-full border-0 bg-[var(--color-campo-700)] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:enabled:bg-[var(--color-campo-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconoActualizar girando={analizando} />
            {analizando ? "Consultando…" : hayResultados ? "Actualizar" : "Analizar"}
          </button>
        </div>
      </div>

      {credencialesOk === false && (
        <p className={avisoClass}>
          Copernicus no está configurado. Agregá las variables del servicio en{" "}
          <code>backend/.env</code> y reiniciá el backend.
        </p>
      )}

      {lotesActivos.length === 0 && (
        <p className={MUTED}>
          No hay lotes activos. Activá al menos uno para consultar su condición.
        </p>
      )}

      {errorGlobal && <p className={avisoClass}>{errorGlobal}</p>}

      {ultimoAnalisis && !analizando && (
        <p className={MUTED_SMALL}>
          Consultado a las{" "}
          {new Date(ultimoAnalisis).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      {hayResultados && (
        <ol className={RANKING_LIST}>
          {ranking.map((lote) => {
            const resultado = resultados[lote.id];
            if (ocultas.has(claveDe(resultado))) return null;
            const seleccionado = lote.id === selectedLoteId;
            const esOk = resultado?.estado === "ok";
            const esRadar = resultado?.estado === "radar";
            const color = esOk
              ? COLOR_CATEGORIA[resultado.condicion.categoria]
              : esRadar
                ? COLOR_RADAR
                : COLOR_SIN_DATOS;

            return (
              <li
                key={lote.id}
                className={rankingItemClass(seleccionado, true)}
                onClick={() => onSelectLote(lote.id)}
              >
                <div className={RANKING_HEADER}>
                  <span className={RANKING_NOMBRE}>{nombreLote(lote)}</span>
                  {esOk ? (
                    <span className={RANKING_PUNTAJE} style={{ background: color }}>
                      {resultado.condicion.puntaje}
                    </span>
                  ) : esRadar ? (
                    <span className={RANKING_PUNTAJE} style={{ background: color }} title="Radar Sentinel-1, no comparable con el puntaje óptico">
                      SAR
                    </span>
                  ) : (
                    <span className={RANKING_PUNTAJE_SIN_DATOS}>—</span>
                  )}
                </div>

                {esOk ? (
                  <>
                    <div className={RANKING_SUB}>
                      <span className={CATEGORIA_CHIP} style={categoriaChipStyle(color)}>
                        {ETIQUETA_CATEGORIA[resultado.condicion.categoria]}
                      </span>
                      {lote.id === mejor?.id && (
                        <span className={BADGE_RECOMENDADO}>Recomendado</span>
                      )}
                      <span className={antiguedadClass(claseAntiguedad(resultado.condicion.diasDesde))}>
                        {fechaOAntiguedad(resultado.condicion.fecha, resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    <div className={INDICES_CLASS}>
                      <span><span className={INDICES_LABEL}>NDVI</span> {formatoIndice(resultado.condicion.ndvi.mediana)}</span>
                      <span><span className={INDICES_LABEL}>NDMI</span> {formatoIndice(resultado.condicion.ndmi.media)}</span>
                      <span><span className={INDICES_LABEL}>EVI</span> {formatoIndice(resultado.condicion.evi.media)}</span>
                      <span>{Math.round(resultado.condicion.coberturaValida * 100)}% despejado</span>
                    </div>

                    {seleccionado && <DetalleCondicion condicion={resultado.condicion} />}
                  </>
                ) : esRadar ? (
                  <>
                    <div className={RANKING_SUB}>
                      <span className={CATEGORIA_CHIP} style={categoriaChipStyle(color)}>
                        Radar Sentinel-1
                      </span>
                      <span className={antiguedadClass(claseAntiguedad(resultado.condicion.diasDesde))}>
                        {fechaOAntiguedad(resultado.condicion.fecha, resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    <div className={INDICES_CLASS}>
                      <span><span className={INDICES_LABEL}>RVI</span> {formatoIndice(resultado.condicion.rvi.mediana)}</span>
                      <span>vegetación por radar, no comparable con NDVI</span>
                    </div>

                    <p className={`${MUTED_SMALL} ${RANKING_SIN_DATOS_TEXTO}`}>{resultado.mensaje}</p>

                    {resultado.optico && (
                      <>
                        <div className={RANKING_SUB}>
                          <span className={CATEGORIA_CHIP} style={categoriaChipStyle(COLOR_CATEGORIA[resultado.optico.categoria])}>
                            Óptica Sentinel-2 ({ETIQUETA_CATEGORIA[resultado.optico.categoria]}
                            {" · "}
                            {resultado.optico.puntaje})
                          </span>
                          <span className={antiguedadClass(claseAntiguedad(resultado.optico.diasDesde))}>
                            {fechaOAntiguedad(resultado.optico.fecha, resultado.optico.diasDesde)}
                          </span>
                        </div>

                        <div className={INDICES_CLASS}>
                          <span><span className={INDICES_LABEL}>NDVI</span> {formatoIndice(resultado.optico.ndvi.mediana)}</span>
                          <span><span className={INDICES_LABEL}>NDMI</span> {formatoIndice(resultado.optico.ndmi.media)}</span>
                          <span><span className={INDICES_LABEL}>EVI</span> {formatoIndice(resultado.optico.evi.media)}</span>
                          <span>{Math.round(resultado.optico.coberturaValida * 100)}% despejado</span>
                        </div>

                        {seleccionado && <DetalleCondicion condicion={resultado.optico} />}
                      </>
                    )}
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
