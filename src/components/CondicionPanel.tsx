import { useState } from "react";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import type { Lote } from "../types";
import type { CategoriaCondicion, CondicionLote, ResultadoLote } from "../copernicus/types";
import {
  COLOR_CATEGORIA,
  COLOR_RADAR,
  COLOR_SIN_DATOS,
  ETIQUETA_CATEGORIA,
} from "../copernicus/presentacion";
import Panel from "./ui/Panel";
import IconoFiltro from "./ui/IconoFiltro";
import {
  MUTED,
  MUTED_SMALL,
  RANKING_LIST,
  RANKING_SIN_DATOS_TEXTO,
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

function MiniCurvaNdvi({ condicion }: { condicion: CondicionLote }) {
  const puntos = condicion.tendencia;
  if (puntos.length < 2) {
    return (
      <div className="flex h-[7.2rem] items-center justify-center rounded-xl bg-gray-50 text-center text-[0.72rem] text-gray-400">
        Todavía no hay suficiente historial para graficar NDVI
      </div>
    );
  }

  return (
    <div className="flex h-[7.2rem] items-end justify-around gap-1 rounded-xl bg-gray-50 px-3 pb-2 pt-3">
      {(() => {
        const valores = puntos.map((punto) => punto.ndvi);
        const minimo = Math.min(...valores);
        const maximo = Math.max(...valores);
        const rango = maximo - minimo || 0.1;
        return puntos.map((punto) => {
          const altura = 24 + Math.round(((punto.ndvi - minimo) / rango) * 54);
          return (
            <div key={punto.fecha} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex h-[5rem] items-end">
                <div
                  className="relative w-4 rounded-full bg-gradient-to-b from-[#4a9f54] to-[#97ea7c] transition-transform hover:scale-105"
                  style={{ height: `${altura}px` }}
                  title={`${fechaCorta(punto.fecha)} · NDVI ${punto.ndvi.toFixed(2)}`}
                >
                  <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border border-[#4a9f54] bg-white" />
                </div>
              </div>
            </div>
          );
        });
      })()}
    </div>
  );
}

function CardCondicion({
  nombre,
  condicion,
  recomendado,
  fuente,
  onSelect,
}: {
  nombre: string;
  condicion: CondicionLote;
  recomendado: boolean;
  fuente: "Sentinel-1" | "Sentinel-2";
  onSelect: () => void;
}) {
  const ultimaLectura = condicion.tendencia.at(-1);
  return (
    <div className="rounded-[1.25rem] bg-white p-[1.125rem] shadow-sm" onClick={onSelect}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-base font-bold text-[#1a1a1a]">{nombre}</span>
        <button type="button" className="whitespace-nowrap rounded-md border-[1.5px] border-gray-200 bg-white px-2 py-1 text-[0.625rem] font-semibold text-[#1a1a1a] hover:bg-gray-50" onClick={onSelect}>
          Ver detalle →
        </button>
      </div>
      <div className="mt-2">
        <span className="text-[1.7rem] font-bold tracking-tight text-[#1a1a1a]">{ETIQUETA_CATEGORIA[condicion.categoria]}</span>
        <span className="ml-1 text-xl font-light text-gray-400">condición</span>
      </div>
      <div className="mt-1 text-[0.68rem] text-gray-400">
        {recomendado ? "Recomendado para pastoreo" : "Recomendación de pastoreo"}
      </div>
      <div className="mt-4">
        <MiniCurvaNdvi condicion={condicion} />
      </div>
      <div className="mt-3 border-t-[1.5px] border-gray-100 pt-2">
        <div className="flex items-center justify-between py-2">
          <span className="text-[0.62rem] text-gray-400">{fechaCorta(ultimaLectura?.fecha ?? condicion.fecha)}</span>
          <span className="text-xs font-bold text-[#1a1a1a]">NDVI {formatoIndice(ultimaLectura?.ndvi ?? condicion.ndvi.mediana)}</span>
        </div>
        <div className="border-t-[1.5px] border-gray-100 pt-2 text-[0.62rem] text-gray-400">
          Tomado con {fuente}
        </div>
      </div>
    </div>
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
    <Panel plano>
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
            const esOk = resultado?.estado === "ok";
            const esRadar = resultado?.estado === "radar";
            const condicionOptica = esOk ? resultado.condicion : esRadar ? resultado.optico : undefined;

            return (
              <li key={lote.id} className="list-none">
                {condicionOptica ? (
                  <CardCondicion
                    nombre={nombreLote(lote)}
                    condicion={condicionOptica}
                    recomendado={lote.id === mejor?.id}
                    fuente={esRadar ? "Sentinel-1" : "Sentinel-2"}
                    onSelect={() => onSelectLote(lote.id)}
                  />
                ) : (
                  <div className="rounded-[1.25rem] bg-white p-[1.125rem] shadow-sm" onClick={() => onSelectLote(lote.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-base font-bold text-[#1a1a1a]">{nombreLote(lote)}</span>
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-[0.625rem] font-semibold text-gray-500">Sin NDVI</span>
                    </div>
                    <p className={`${MUTED_SMALL} ${RANKING_SIN_DATOS_TEXTO}`}>
                      {esRadar
                        ? "No hay observación óptica disponible para esta fecha."
                        : resultado && "mensaje" in resultado
                          ? resultado.mensaje
                          : "Sin consultar."}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

    </Panel>
  );
}
