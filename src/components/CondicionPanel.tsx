import FraseConAyuda from "./ui/FraseConAyuda";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { obtenerEstimacionesForraje, type CondicionPastoreo, type DiaCondicion, type EstimacionForraje, type LoteOrdenado } from "../api/estimacion";
import { CONDICION_PASTOREO, ORDEN_CONDICION, esPiso, fechaCorta, progresoRegeneracion, resumirCondicion, type ResumenCondicion } from "../estimacion/presentacion";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import type { EstadoOrdenPastoreo } from "../hooks/useOrdenPastoreo";
import CompletarDatosLote, { type AccionesCompletarLote } from "./CompletarDatosLote";
import { NOMBRES_PASTURA, type Lote } from "../types";
import AvisoInfo from "./ui/AvisoInfo";
import Panel from "./ui/Panel";
import IconoFiltro from "./ui/IconoFiltro";
import { haceCuanto } from "../utils/notification-presentation";
import { CATEGORIA_CHIP, MUTED, MUTED_SMALL, categoriaChipStyle } from "./ui/ranking";

interface CondicionPanelProps extends AccionesCompletarLote {
  lotesActivos: Lote[];
  analizando: boolean;
  ultimoAnalisis: number | null;
  errorGlobal: string | null;
  credencialesOk: boolean | null;
  selectedLoteId: string | null;
  /** El orden para pastorear hoy; lo pide la pantalla una vez para la sidebar y este panel. */
  orden: EstadoOrdenPastoreo;
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
  if (estado?.estado === "error") return { condicion: null, prefijo: null, titulo: "Sin estimación", frase: estado.mensaje, nota: null, ayudaFecha: null };
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

/** Regeneración del Figma: etiqueta y valor arriba, pista de 8 px debajo. Perfecto lleva degradé verde. */
function BarraRegeneracion({ progreso, color, esPerfecto }: { progreso: number; color: string; esPerfecto: boolean }) {
  const porcentaje = Math.min(100, Math.max(0, Math.round(progreso * 100)));
  return (
    <div className="flex flex-col gap-[7px] text-[13px] leading-4 tracking-[-0.03em]">
      <div className="flex items-center justify-between">
        <span className="text-[#4B5550]">Regeneración</span>
        <span className="font-semibold text-black tabular-nums">{porcentaje}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-[rgba(15,26,20,0.1)]" role="presentation">
        <div className="h-full rounded" style={{ width: `${porcentaje}%`, background: esPerfecto ? "linear-gradient(90deg, #8FE472 0%, #3FAE45 100%)" : color }} />
      </div>
    </div>
  );
}

function CardCondicion({ lote, estado, ordenado, dia, seleccionado, onSelect, acciones, establecimientoId }: {
  lote: Lote; estado: EstadoEstimacion | undefined; ordenado: LoteOrdenado | undefined; dia: string; seleccionado: boolean; onSelect: () => void; acciones: AccionesCompletarLote; establecimientoId: string;
}) {
  const resumen = resumenDe(lote, estado, dia);
  const reingreso = estado?.estado === "ok" ? estado.estimacion.reingreso : null;
  const color = resumen.condicion ? CONDICION_PASTOREO[resumen.condicion].color : GRIS;
  const progreso = progresoRegeneracion(reingreso, ordenado);

  return (
    // Tarjeta del frame "Condición / Tarjeta" del Figma: vidrio claro con borde verde.
    <div
      className={`flex cursor-pointer flex-col gap-3.5 rounded-[25px] border-2 border-[#79DA58] bg-white/40 py-[18px] pr-4 pl-5 backdrop-blur-[12.5px] transition-shadow ${seleccionado ? "shadow-[0_0_0_2px_#79DA58_inset]" : "hover:shadow-[0_0_0_1px_#79DA58_inset]"}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[17px] leading-[22px] tracking-[-0.03em] text-black">
          {ordenado && <span className="font-medium text-black/35 tabular-nums">{ordenado.posicion}.</span>}
          <span className="min-w-0 truncate font-semibold">{nombreLote(lote)}</span>
          {lote.tipoPastura && <span className="text-[0.75rem] font-normal text-gray-500">{NOMBRES_PASTURA[lote.tipoPastura]}</span>}
        </span>
        {/* Abre la ficha; el clic de la tarjeta selecciona el lote en el mapa. */}
        <Link
          to={`/establecimientos/${establecimientoId}/lotes/${lote.id}`}
          onClick={(evento) => evento.stopPropagation()}
          className="foco-campo flex h-[29px] flex-none items-center justify-center whitespace-nowrap rounded-[10px] border border-[#79DA58] bg-[rgba(151,234,124,0.6)] px-[9px] font-[Helvetica,Arial,sans-serif] text-[15px] tracking-[-0.06em] text-black no-underline transition-colors duration-150 hover:bg-[rgba(151,234,124,0.9)]"
        >
          Ver ficha
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {resumen.prefijo && <span className="block text-[0.62rem] font-semibold tracking-[0.06em] text-gray-500 uppercase">{resumen.prefijo}</span>}
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-6 items-center gap-1.5 rounded-full py-1 pr-[11px] pl-[9px] text-[13px] leading-4 font-medium tracking-[-0.03em] text-black"
            style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
          >
            <i aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: color }} />
            {resumen.titulo}
          </span>
          {resumen.nota && <AvisoInfo titulo="Sin pastoreos registrados">{resumen.nota}</AvisoInfo>}
        </div>
        {resumen.frase && <p className="m-0 text-sm leading-5 tracking-[-0.03em] text-[#2B2B2B]"><FraseConAyuda frase={resumen.frase} ayuda={resumen.ayudaFecha} /></p>}
      </div>

      {progreso !== null && <BarraRegeneracion progreso={progreso} color={color} esPerfecto={resumen.condicion === "perfecto"} />}

      {resumen.condicion && reingreso && <TiraDias condiciones={reingreso.condiciones} dia={dia} esMinimo={reingreso.esMinimo} />}

      {ordenado && <DatosDelOrden lote={ordenado} />}

      {ordenado?.falta && <CompletarDatosLote loteId={lote.id} falta={ordenado.falta} {...acciones} />}
    </div>
  );
}

/**
 * La respuesta corta: en qué está cada lote hoy. Agrupa por la condición
 * estimada —la misma etiqueta de la pastilla de cada tarjeta— y no por el grupo
 * del orden, para que la fila diga lo mismo que la card de abajo.
 */
function ResumenDelDia({ lotes, claveDe, leyenda, onSelectLote }: {
  lotes: Lote[]; claveDe: (lote: Lote) => ClaveFiltro; leyenda: string; onSelectLote: (id: string) => void;
}) {
  const filas = [...ORDEN_CONDICION, "sin-estimacion" as const]
    .map((clave) => [clave, lotes.filter((lote) => claveDe(lote) === clave)] as const)
    .filter(([, lotesDeLaFila]) => lotesDeLaFila.length > 0);
  if (filas.length === 0) return null;
  return (
    <div className="rounded-2xl border-2 border-[var(--color-lima)] bg-white p-3.5">
      <div className="mb-2 flex items-center gap-1.5">
        <p className="m-0 text-[0.68rem] font-bold tracking-[0.08em] text-gray-400 uppercase">Hoy en el campo, en orden</p>
        <AvisoInfo tono="info" titulo="De dónde sale">
          <p className="m-0 mb-1">Estimación provisional con el clima, el tipo de pastura y el último pastoreo de cada lote. No es una medición.</p>
          <p className="m-0">No es lo mismo que el color del lote en el mapa: ese es el verdor que vio el satélite. Acá se calcula cuánto descansó el pasto, y el satélite no interviene.</p>
        </AvisoInfo>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {filas.map(([clave, lotesDeLaFila]) => {
          const { texto, color } = clave === "sin-estimacion"
            ? { texto: "Sin datos", color: GRIS }
            : { texto: CONDICION_PASTOREO[clave].corto, color: CONDICION_PASTOREO[clave].color };
          return (
            <li key={clave} className="flex items-center gap-2 text-[0.8rem]">
              <span
                className={`${CATEGORIA_CHIP} inline-flex w-24 flex-none items-center gap-1.5`}
                style={categoriaChipStyle(color)}
              >
                <i aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
                {texto}
              </span>
              <span className="min-w-0">
                {lotesDeLaFila.map((lote, i) => (
                  <span key={lote.id}>
                    <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-gray-800 hover:underline" onClick={() => onSelectLote(lote.id)}>
                      Lote {lote.numero}
                    </button>
                    {i < lotesDeLaFila.length - 1 ? ", " : ""}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 mt-2 text-[0.68rem] font-semibold text-gray-500">{leyenda}</p>
    </div>
  );
}

/** Lo que el orden suma a la card: el piso pesado y el pasto medido hoy. */
function DatosDelOrden({ lote }: { lote: LoteOrdenado }) {
  const piso = lote.grupo === "esperar-al-piso" ? lote.motivos[0] : null;
  const pasto = lote.pastoEnPieKgMsHa !== null ? lote.motivos.find((motivo) => motivo.includes("kg MS/ha"))?.split(";")[0].replace(/\.$/, "") ?? null : null;
  if (!piso && !pasto) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 text-[0.75rem] leading-snug">
      {piso && <p className="m-0 rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800">{piso}</p>}
      {pasto && <p className="m-0 text-gray-700">{pasto}, medido hoy.</p>}
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
 * (grados-día desde el último uso). Muestra lo que hace falta para decidir; los
 * números quedan en la ficha. Lee lo persistido: el botón sólo actualiza el
 * satélite, que llega al orden únicamente por las alertas de piso anegado.
 */
export default function CondicionPanel({
  lotesActivos,
  analizando,
  ultimoAnalisis,
  errorGlobal,
  credencialesOk,
  selectedLoteId,
  orden,
  refresco,
  onAnalizar,
  onSelectLote,
  onLoteActualizado,
  onPastoreoRegistrado,
  onActualizarClima,
  actualizandoClima,
}: CondicionPanelProps) {
  const acciones: AccionesCompletarLote = { onLoteActualizado, onPastoreoRegistrado, onActualizarClima, actualizandoClima };
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

  const ordenados = useMemo(
    () => new Map(orden.estado === "ok" ? orden.orden.lotes.map((lote) => [lote.loteId, lote]) : []),
    [orden],
  );

  // El orden del backend manda. Mientras no llega, o si falla, de mejor a peor
  // condición y, dentro de cada una, más avance del estado foliar primero.
  const ranking = useMemo(() => [...lotesActivos].sort((a, b) => {
    const enOrden = (lote: Lote) => ordenados.get(lote.id)?.posicion ?? Number.POSITIVE_INFINITY;
    const posicion = (lote: Lote) => { const clave = claveDe(lote); return clave === "sin-estimacion" ? ORDEN_CONDICION.length : ORDEN_CONDICION.indexOf(clave); };
    const avance = (lote: Lote) => { const estado = estimaciones[lote.id]; return estado?.estado === "ok" ? estado.estimacion.reingreso?.condicionHoy?.avanceEstadoFoliar ?? 0 : 0; };
    return (enOrden(a) - enOrden(b) || 0) || posicion(a) - posicion(b) || avance(b) - avance(a) || a.numero - b.numero;
  }), [lotesActivos, estimaciones, resumenes, ordenados]);

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
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 text-[29px] leading-[34px] font-normal tracking-[-0.03em] text-black">Condición para pastoreo</h3>
          <p className="m-0 font-[Helvetica,Arial,sans-serif] text-[15px] leading-5 tracking-[-0.06em] text-black">
            Ordenados según cuándo conviene entrar con los animales.
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
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

      {/* Configurar las credenciales es trabajo de quien administra RODEO. Al
          productor le sirve saber qué sigue andando y qué no. */}
      {credencialesOk === false && (
        <p className={avisoClass}>
          Las imágenes satelitales no están disponibles en esta instalación de RODEO.
          La condición para pastorear se calcula igual, con el clima y los pastoreos
          que cargues.
        </p>
      )}

      {lotesActivos.length === 0 && (
        <p className={MUTED}>
          No hay lotes activos. Activá al menos uno para estimar su condición.
        </p>
      )}

      {errorGlobal && <p className={avisoClass}>{errorGlobal}</p>}

      {ultimoAnalisis && !analizando && (
        <p className={MUTED_SMALL}>Satélite consultado {haceCuanto(ultimoAnalisis).toLowerCase()}.</p>
      )}

      {cargando && <p className={MUTED_SMALL}>Calculando la condición de los lotes…</p>}

      {orden.estado === "error" && <p className={MUTED_SMALL}>No se pudo armar el orden de los lotes: {orden.mensaje}</p>}
      {!cargando && orden.estado === "ok" && <ResumenDelDia lotes={ranking} claveDe={claveDe} leyenda={orden.orden.leyenda} onSelectLote={onSelectLote} />}

      {lotesActivos.length > 0 && !cargando && (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {ranking.map((lote) => ocultas.has(claveDe(lote)) ? null : (
            <li key={lote.id} className="list-none">
              <CardCondicion lote={lote} estado={estimaciones[lote.id]} ordenado={ordenados.get(lote.id)} dia={dia} seleccionado={lote.id === selectedLoteId} onSelect={() => onSelectLote(lote.id)} acciones={acciones} establecimientoId={establecimientoId} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
