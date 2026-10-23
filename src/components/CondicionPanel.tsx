import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { obtenerEstimacionesForraje, type CondicionPastoreo, type DiaCondicion, type EstimacionForraje } from "../api/estimacion";
import { CONDICION_PASTOREO, ORDEN_CONDICION, esPiso, fechaCorta, resumirCondicion, type ResumenCondicion } from "../estimacion/presentacion";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { NOMBRES_PASTURA, type Lote } from "../types";
import Panel from "./ui/Panel";
import IconoFiltro from "./ui/IconoFiltro";
import { MUTED, MUTED_SMALL, RANKING_LIST } from "./ui/ranking";

interface CondicionPanelProps {
  lotesActivos: Lote[];
  analizando: boolean;
  ultimoAnalisis: number | null;
  errorGlobal: string | null;
  credencialesOk: boolean | null;
  selectedLoteId: string | null;
  /** Cambia cuando se actualiza el clima, para volver a pedir las estimaciones. */
  refresco?: unknown;
  onAnalizar: () => void;
  onSelectLote: (id: string) => void;
}

type ClaveFiltro = CondicionPastoreo | "sin-estimacion";

const GRIS = "#9ca3af";

const OPCIONES_FILTRO: { clave: ClaveFiltro; etiqueta: string; color: string }[] = [
  ...ORDEN_CONDICION.map((clave) => ({ clave, etiqueta: CONDICION_PASTOREO[clave].texto, color: CONDICION_PASTOREO[clave].color })),
  { clave: "sin-estimacion", etiqueta: "Sin etiqueta", color: GRIS },
];

type EstadoEstimacion = { estado: "ok"; estimacion: EstimacionForraje } | { estado: "error"; mensaje: string };

function nombreLote(lote: Lote): string {
  return lote.apodo ? `Lote ${lote.numero} — ${lote.apodo}` : `Lote ${lote.numero}`;
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function resumenDe(lote: Lote, estado: EstadoEstimacion | undefined, dia: string): ResumenCondicion {
  if (estado?.estado === "error") return { condicion: null, prefijo: null, titulo: "Sin estimación", frase: estado.mensaje, nota: null };
  return resumirCondicion(lote, estado?.estimacion ?? null, dia);
}

/** Hoy y los próximos días en colores: se entiende sin leer números. */
function TiraDias({ condiciones, dia, esMinimo }: { condiciones: DiaCondicion[]; dia: string; esMinimo: boolean }) {
  const dias = condiciones.filter((condicion) => condicion.fecha >= dia).slice(0, 10);
  if (dias.length < 2) return null;
  return (
    <div className="mt-3">
      <div className="flex gap-[3px]" role="img" aria-label="Condición estimada de hoy y los próximos días">
        {dias.map((condicion) => (
          <div
            key={condicion.fecha}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={`${fechaCorta(condicion.fecha)} · ${esPiso(esMinimo, condicion.condicion) ? "como mínimo " : ""}${CONDICION_PASTOREO[condicion.condicion].texto}${condicion.climaUsado === "pronostico" ? " · según pronóstico" : ""}`}
          >
            <div className="h-2.5 w-full rounded-full" style={{ background: CONDICION_PASTOREO[condicion.condicion].color }} />
            <span className={`text-[0.58rem] leading-none ${condicion.fecha === dia ? "font-bold text-gray-700" : "text-gray-400"}`}>
              {condicion.fecha === dia ? "hoy" : Number(condicion.fecha.slice(8, 10))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardCondicion({ lote, estado, dia, onSelect }: { lote: Lote; estado: EstadoEstimacion | undefined; dia: string; onSelect: () => void }) {
  const resumen = resumenDe(lote, estado, dia);
  const reingreso = estado?.estado === "ok" ? estado.estimacion.reingreso : null;
  const color = resumen.condicion ? CONDICION_PASTOREO[resumen.condicion].color : GRIS;

  return (
    <div className="cursor-pointer rounded-[1.25rem] border-l-[5px] bg-white p-[1.125rem] shadow-sm" style={{ borderLeftColor: color }} onClick={onSelect}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-base font-bold text-[#1a1a1a]">
          {nombreLote(lote)}
          {lote.tipoPastura && <span className="ml-1.5 text-[0.75rem] font-normal text-gray-400">{NOMBRES_PASTURA[lote.tipoPastura]}</span>}
        </span>
        <button type="button" className="whitespace-nowrap rounded-md border-[1.5px] border-gray-200 bg-white px-2 py-1 text-[0.625rem] font-semibold text-[#1a1a1a] hover:bg-gray-50" onClick={onSelect}>
          Ver detalle →
        </button>
      </div>

      <div className="mt-2">
        {resumen.prefijo && <span className="block text-[0.62rem] font-semibold tracking-[0.06em] text-gray-400 uppercase">{resumen.prefijo}</span>}
        <span className={`block leading-tight font-bold tracking-tight ${resumen.condicion ? "text-[1.45rem]" : "text-[1.15rem] text-gray-500"}`} style={resumen.condicion ? { color } : undefined}>
          {resumen.titulo}
        </span>
      </div>
      {resumen.frase && <p className="m-0 mt-1 text-[0.82rem] leading-snug text-gray-700">{resumen.frase}</p>}

      {resumen.condicion && reingreso && <TiraDias condiciones={reingreso.condiciones} dia={dia} esMinimo={reingreso.esMinimo} />}

      {resumen.nota && <p className="m-0 mt-2 text-[0.7rem] leading-snug text-gray-400">{resumen.nota}</p>}
    </div>
  );
}

/** La respuesta corta: qué lotes usar hoy y cuáles no. */
function ResumenDelDia({ grupos, sinEtiqueta, onSelectLote }: { grupos: Array<[CondicionPastoreo, Lote[]]>; sinEtiqueta: number; onSelectLote: (id: string) => void }) {
  if (grupos.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-sm">
      <p className="m-0 mb-2 text-[0.68rem] font-bold tracking-[0.08em] text-gray-400 uppercase">Hoy en el campo</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {grupos.map(([condicion, lotes]) => (
          <li key={condicion} className="flex items-start gap-2 text-[0.8rem]">
            <i className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CONDICION_PASTOREO[condicion].color }} />
            <span className="min-w-0">
              <strong className="font-semibold text-gray-800">{CONDICION_PASTOREO[condicion].texto}:</strong>{" "}
              {lotes.map((lote, i) => (
                <span key={lote.id}>
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-gray-700 underline underline-offset-2 hover:text-gray-900" onClick={() => onSelectLote(lote.id)}>
                    Lote {lote.numero}
                  </button>
                  {i < lotes.length - 1 ? ", " : ""}
                </span>
              ))}
            </span>
          </li>
        ))}
        {sinEtiqueta > 0 && (
          <li className="flex items-start gap-2 text-[0.8rem] text-gray-500">
            <i className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GRIS }} />
            <span>{sinEtiqueta === 1 ? "1 lote" : `${sinEtiqueta} lotes`} sin etiqueta (ver abajo qué falta)</span>
          </li>
        )}
      </ul>
      <p className="m-0 mt-2 text-[0.62rem] text-gray-400">Estimación provisional con satélite, clima y tipo de pastura. No es una medición.</p>
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

/**
 * Condición estimada para pastorear de cada lote, a partir del estado foliar
 * (grados-día desde el último uso) y del crecimiento por NDVI de Sentinel-2 y
 * radiación. Muestra lo que hace falta para decidir; los números quedan en la
 * ficha. Lee lo persistido: el botón sólo actualiza el satélite.
 */
export default function CondicionPanel({
  lotesActivos,
  analizando,
  ultimoAnalisis,
  errorGlobal,
  credencialesOk,
  refresco,
  onAnalizar,
  onSelectLote,
}: CondicionPanelProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const [ocultas, setOcultas] = useState<Set<ClaveFiltro>>(new Set());
  const [estimaciones, setEstimaciones] = useState<Record<string, EstadoEstimacion>>({});
  const dia = hoy();
  // Pide de nuevo si cambian los lotes o su pastura, no cuando sólo cambia la identidad del array.
  const claveLotes = lotesActivos.map((lote) => `${lote.id}:${lote.tipoPastura ?? ""}`).join(",");

  useEffect(() => {
    let vigente = true;
    setEstimaciones({});
    if (lotesActivos.length === 0) return;
    // Una sola llamada para todo el establecimiento: el backend agrupa las consultas.
    obtenerEstimacionesForraje(establecimientoId)
      .then((resultado) => {
        if (!vigente) return;
        const porLote: Record<string, EstadoEstimacion> = {};
        for (const item of resultado) porLote[item.loteId] = { estado: "ok", estimacion: item.estimacion };
        setEstimaciones(porLote);
      })
      .catch((reason) => {
        if (!vigente) return;
        const mensaje = reason instanceof ApiError ? reason.message : "No se pudo calcular la estimación.";
        setEstimaciones(Object.fromEntries(lotesActivos.map((lote) => [lote.id, { estado: "error", mensaje } satisfies EstadoEstimacion])));
      });
    return () => { vigente = false; };
    // lotesActivos queda fuera a propósito: claveLotes lo resume.
  }, [establecimientoId, claveLotes, ultimoAnalisis, refresco]);

  const resumenes = useMemo(
    () => new Map(lotesActivos.map((lote) => [lote.id, resumenDe(lote, estimaciones[lote.id], dia)])),
    [lotesActivos, estimaciones, dia],
  );

  function claveDe(lote: Lote): ClaveFiltro {
    return resumenes.get(lote.id)?.condicion ?? "sin-estimacion";
  }

  // De mejor a peor condición; dentro de cada una, más avance del estado foliar primero
  // (el que antes se pasa de su mejor momento).
  const ranking = useMemo(() => [...lotesActivos].sort((a, b) => {
    const posicion = (lote: Lote) => { const clave = claveDe(lote); return clave === "sin-estimacion" ? ORDEN_CONDICION.length : ORDEN_CONDICION.indexOf(clave); };
    const avance = (lote: Lote) => { const estado = estimaciones[lote.id]; return estado?.estado === "ok" ? estado.estimacion.reingreso?.condicionHoy?.avanceEstadoFoliar ?? 0 : 0; };
    return posicion(a) - posicion(b) || avance(b) - avance(a) || a.numero - b.numero;
  }), [lotesActivos, estimaciones, resumenes]);

  const grupos = ORDEN_CONDICION
    .map((condicion) => [condicion, ranking.filter((lote) => claveDe(lote) === condicion)] as [CondicionPastoreo, Lote[]])
    .filter(([, lotes]) => lotes.length > 0);
  const sinEtiqueta = ranking.filter((lote) => claveDe(lote) === "sin-estimacion").length;
  const cargando = lotesActivos.length > 0 && Object.keys(estimaciones).length === 0;

  const avisoClass = "m-0 rounded-md border border-amber-300 bg-amber-100 p-2.5 text-[0.82rem] leading-normal text-amber-800 [&_code]:rounded [&_code]:bg-black/[0.07] [&_code]:px-1 [&_code]:text-[0.78rem]";

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
            <div className="absolute right-0 z-20 mt-1.5 flex w-48 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
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
            title="Consulta Sentinel-2 y recalcula las estimaciones"
            disabled={!puede("actualizar_satelite") || analizando || lotesActivos.length === 0}
            className="flex items-center gap-1.5 rounded-full border-0 bg-[var(--color-campo-700)] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:enabled:bg-[var(--color-campo-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconoActualizar girando={analizando} />
            {analizando ? "Consultando…" : "Actualizar"}
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
          No hay lotes activos. Activá al menos uno para estimar su condición.
        </p>
      )}

      {errorGlobal && <p className={avisoClass}>{errorGlobal}</p>}

      {ultimoAnalisis && !analizando && (
        <p className={MUTED_SMALL}>
          Satélite consultado a las{" "}
          {new Date(ultimoAnalisis).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      {cargando && <p className={MUTED_SMALL}>Calculando la condición de los lotes…</p>}

      {!cargando && <ResumenDelDia grupos={grupos} sinEtiqueta={sinEtiqueta} onSelectLote={onSelectLote} />}

      {lotesActivos.length > 0 && !cargando && (
        <ol className={RANKING_LIST}>
          {ranking.map((lote) => ocultas.has(claveDe(lote)) ? null : (
            <li key={lote.id} className="list-none">
              <CardCondicion lote={lote} estado={estimaciones[lote.id]} dia={dia} onSelect={() => onSelectLote(lote.id)} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
