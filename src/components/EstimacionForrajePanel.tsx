import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { obtenerEstimacionForraje, type DiaCondicion, type DiaEstimacion, type EstimacionForraje } from "../api/estimacion";
import {
  CONDICION_PASTOREO, EXPLICACION_CONDICION, NOMBRE_ORIGEN_CLIMA,
  esPiso, fechaCorta, fraseCrecimiento, kgRedondo, resumirCondicion,
} from "../estimacion/presentacion";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import type { Lote } from "../types";
import { APAGADO, TARJETA, VOLANTA } from "./ui/PantallaDatos";

interface EstimacionForrajePanelProps {
  lote: Lote;
  /** Cambia cada vez que la ficha recarga clima, satélite o usos, para volver a pedir la estimación. */
  refresco: unknown;
}

const TARJETA_INTERIOR = "rounded-2xl border border-gray-200/80 bg-white p-[18px]";
const GRIS = "#9ca3af";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

/** Hoy y los días con pronóstico, uno por casilla con su color y su etiqueta corta. */
function TiraDias({ condiciones, dia, esMinimo }: { condiciones: DiaCondicion[]; dia: string; esMinimo: boolean }) {
  const dias = condiciones.filter((condicion) => condicion.fecha >= dia);
  if (dias.length < 2) return null;
  return <div className="mt-4">
    <ol className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1">
      {dias.map((condicion) => {
        const estilo = CONDICION_PASTOREO[condicion.condicion];
        return <li key={condicion.fecha} className="flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-center" style={{ background: `color-mix(in srgb, ${estilo.color} 12%, white)` }}
          title={`${esPiso(esMinimo, condicion.condicion) ? "Como mínimo " : ""}${estilo.texto}${condicion.climaUsado === "pronostico" ? " · según pronóstico" : ""}`}>
          <span className={`text-[0.72rem] ${condicion.fecha === dia ? "font-bold text-gray-900" : "text-gray-600"}`}>{condicion.fecha === dia ? "Hoy" : fechaCorta(condicion.fecha)}</span>
          <span className="text-[0.72rem] font-semibold" style={{ color: estilo.color }}>{estilo.corto}</span>
        </li>;
      })}
    </ol>
    <p className="m-0 mt-1 text-[0.72rem] text-gray-400">Los días que vienen salen del pronóstico de Open-Meteo, que no es una medición.</p>
  </div>;
}

/** Barras de kgMS/ha/día producidos. Los días sin valor quedan vacíos, nunca en cero. */
function GraficoCrecimiento({ dias, dia }: { dias: DiaEstimacion[]; dia: string }) {
  const conValor = dias.filter((item) => item.crecimientoKgMsHaDia !== null);
  if (conValor.length === 0) return null;
  const ancho = 680;
  const alto = 170;
  const izquierda = 36;
  const arriba = 14;
  const abajo = 26;
  const anchoGrafico = ancho - izquierda - 10;
  const altoGrafico = alto - arriba - abajo;
  const maximo = Math.max(1, ...conValor.map((item) => item.crecimientoKgMsHaDia as number));
  const paso = anchoGrafico / dias.length;
  const y = (valor: number) => arriba + (1 - valor / maximo) * altoGrafico;
  const indiceHoy = dias.findIndex((item) => item.fecha === dia);
  const cadaCuanto = Math.max(1, Math.ceil(dias.length / 8));

  return <div className="mt-3 overflow-x-auto">
    <svg className="block h-[190px] w-full min-w-[560px]" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Crecimiento diario estimado de forraje">
      <line x1={izquierda} x2={ancho - 10} y1={y(0)} y2={y(0)} stroke="#d1d5db" />
      <text x={izquierda - 6} y={y(maximo) + 4} textAnchor="end" className="fill-gray-500 text-[10px]">{Math.round(maximo)}</text>
      <text x={izquierda - 6} y={y(0) + 4} textAnchor="end" className="fill-gray-500 text-[10px]">0</text>
      {dias.map((item, index) => {
        const x = izquierda + index * paso;
        return <g key={item.fecha}>
          {item.crecimientoKgMsHaDia !== null && <rect x={x + paso * 0.15} width={Math.max(1, paso * 0.7)} y={y(item.crecimientoKgMsHaDia)} height={y(0) - y(item.crecimientoKgMsHaDia)} fill="#2f855a" opacity={item.climaUsado === "pronostico" ? 0.35 : 0.9}>
            <title>{fecha(item.fecha)} · {item.crecimientoKgMsHaDia} kg MS/ha{item.climaUsado === "pronostico" ? " · según pronóstico" : ""}</title>
          </rect>}
          {index % cadaCuanto === 0 && <text x={x + paso / 2} y={alto - 8} textAnchor="middle" className="fill-gray-500 text-[10px]">{fechaCorta(item.fecha)}</text>}
        </g>;
      })}
      {indiceHoy >= 0 && <g>
        <line x1={izquierda + (indiceHoy + 0.5) * paso} x2={izquierda + (indiceHoy + 0.5) * paso} y1={arriba - 4} y2={y(0)} stroke="#1f2937" strokeDasharray="3 3" />
        <text x={izquierda + (indiceHoy + 0.5) * paso + 4} y={arriba + 4} className="fill-gray-700 text-[10px]">hoy</text>
      </g>}
    </svg>
    <p className="m-0 text-[0.72rem] text-gray-400">kg de materia seca por hectárea que crecen por día. Barras claras: según pronóstico. Los huecos son días sin imagen satelital útil, no días sin crecimiento.</p>
  </div>;
}

/** Los números detrás de la etiqueta, para quien los quiera ver. */
function ComoSeCalcula({ estimacion, dia }: { estimacion: EstimacionForraje; dia: string }) {
  const reingreso = estimacion.reingreso;
  const condicion = reingreso?.condicionHoy ?? null;
  const conImagen = estimacion.dias.filter((item) => item.fecha <= dia && item.fechaImagen !== null).at(-1) ?? null;
  const filas: Array<[string, string]> = [];
  if (condicion) filas.push(["Por qué esta etiqueta", EXPLICACION_CONDICION[condicion.condicion]]);
  if (condicion) filas.push(["Estado foliar óptimo alcanzado", `${condicion.avanceEstadoFoliar} %${reingreso?.esMinimo ? " como mínimo" : ""}`]);
  if (condicion) filas.push(["Grados-día acumulados", `${Math.round(condicion.gradosDia.conBaseMinima)} °Cd (base ${reingreso?.criterio?.temperaturaBaseC[0]} °C)`]);
  if (reingreso?.inicioConteo === "pastoreo" && reingreso.fechaUltimoPastoreo) filas.push(["Se cuenta desde", `el pastoreo del ${fecha(reingreso.fechaUltimoPastoreo)}`]);
  if (reingreso?.inicioConteo === "alta" && reingreso.fechaInicioConteo) filas.push(["Se cuenta desde", `el alta del lote (${fecha(reingreso.fechaInicioConteo)}), porque no hay pastoreos registrados`]);
  if (reingreso?.criterio && reingreso.inicioConteo) filas.push([reingreso.esMinimo ? "Ventana ideal, a más tardar" : "Ventana ideal", `${reingreso.fechaTemprana ? fecha(reingreso.fechaTemprana) : "—"} a ${reingreso.fechaTardia ? fecha(reingreso.fechaTardia) : "—"}`]);
  if (conImagen?.ndviUsado != null && conImagen.fechaImagen) filas.push(["NDVI usado", `${conImagen.ndviUsado.toFixed(2)}, imagen Sentinel-2 del ${fecha(conImagen.fechaImagen)}`]);
  if (condicion) filas.push(["Clima de hoy", NOMBRE_ORIGEN_CLIMA[condicion.climaUsado]]);

  return <details className="mt-[14px] rounded-2xl border border-gray-200 bg-white p-4 text-[0.85rem] text-gray-600">
    <summary className="cursor-pointer font-semibold text-gray-800">Cómo se calcula</summary>
    {filas.length > 0 && <dl className="m-0 mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 md:grid-cols-[max-content_1fr]">
      {filas.map(([nombre, valor]) => <div key={nombre} className="contents"><dt className="text-gray-400">{nombre}</dt><dd className="m-0 text-gray-800">{valor}</dd></div>)}
    </dl>}
    {estimacion.avisos.length > 0 && <ul className="mt-3 mb-0 pl-5 text-[0.8rem]">
      {estimacion.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
    </ul>}
    {estimacion.parametrosUsados && <>
      <p className="mt-3 mb-1 font-semibold text-gray-700">Fuentes ({estimacion.parametrosUsados.pastura})</p>
      <ul className="m-0 pl-5 text-[0.8rem]">
        {([["Luz absorbida desde NDVI", estimacion.parametrosUsados.frfa], ["Eficiencia de uso de la radiación", estimacion.parametrosUsados.eur], ["Criterio de reingreso", estimacion.parametrosUsados.reingreso]] as const).map(([nombre, parametro]) =>
          <li key={nombre}><strong>{nombre}:</strong> {parametro.valor && parametro.fuente ? <>{parametro.fuente.cita}{parametro.fuente.url && <> · <a href={parametro.fuente.url} target="_blank" rel="noreferrer">fuente</a></>}</> : "sin fuente verificada todavía"}</li>)}
      </ul>
      <p className="mb-0 text-[0.75rem] text-gray-400">Modelo {estimacion.versionModelo}.</p>
    </>}
  </details>;
}

/**
 * Condición estimada para pastorear y crecimiento de forraje, de hoy y de los
 * días con pronóstico. Arriba lo que hace falta para decidir; los números, en
 * "Cómo se calcula". Es derivada y provisional: no se guarda.
 */
export default function EstimacionForrajePanel({ lote, refresco }: EstimacionForrajePanelProps) {
  const { establecimientoId } = useEstablecimiento();
  const [estimacion, setEstimacion] = useState<EstimacionForraje | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dia = hoy();

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    obtenerEstimacionForraje(establecimientoId, lote.id)
      .then((resultado) => { if (vigente) setEstimacion(resultado); })
      .catch((reason) => { if (vigente) setError(reason instanceof ApiError ? reason.message : "No se pudo calcular la estimación. Intentá nuevamente."); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [establecimientoId, lote.id, lote.tipoPastura, refresco]);

  const resumen = resumirCondicion(lote, estimacion, dia);
  const color = resumen.condicion ? CONDICION_PASTOREO[resumen.condicion].color : GRIS;
  const crecimiento = estimacion ? fraseCrecimiento(estimacion, dia) : null;
  const alFinal = estimacion?.dias.filter((item) => item.acumuladoKgMsHa !== null).at(-1) ?? null;
  const conCurva = Boolean(estimacion?.dias.some((item) => item.crecimientoKgMsHaDia !== null));

  return <section className={`${TARJETA} p-[22px]`}>
    <p className={VOLANTA}>Estimación provisional</p>
    <h2 className="m-0 text-[1.3rem] font-semibold text-gray-900">Condición para pastorear</h2>

    {cargando && !estimacion && <p className={APAGADO}>Calculando…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}

    {(estimacion || !lote.tipoPastura) && <div className={`${TARJETA_INTERIOR} mt-4 border-l-[6px]`} style={{ borderLeftColor: color }}>
      {resumen.prefijo && <span className="block text-[0.72rem] font-semibold tracking-[0.06em] text-gray-400 uppercase">{resumen.prefijo}</span>}
      <strong className={`block leading-tight ${resumen.condicion ? "text-[1.8rem]" : "text-[1.3rem] text-gray-500"}`} style={resumen.condicion ? { color } : undefined}>{resumen.titulo}</strong>
      {resumen.frase && <p className="m-0 mt-1.5 text-[1rem] text-gray-800">{resumen.frase}</p>}
      {resumen.nota && <p className={`${APAGADO} m-0 mt-1.5`}>{resumen.nota}</p>}
      {resumen.condicion && estimacion?.reingreso && <TiraDias condiciones={estimacion.reingreso.condiciones} dia={dia} esMinimo={estimacion.reingreso.esMinimo} />}
    </div>}

    {estimacion && lote.tipoPastura && conCurva && <div className={`${TARJETA_INTERIOR} mt-[14px]`}>
      <h3 className="m-0 text-base font-semibold text-gray-900">Cuánto pasto creció</h3>
      {crecimiento && <p className="m-0 mt-1 text-gray-800">{crecimiento}</p>}
      {alFinal && alFinal.fecha > dia && alFinal.acumuladoKgMsHa !== null && <p className={`${APAGADO} m-0 mt-1`}>Con el pronóstico, llegaría a unos {kgRedondo(alFinal.acumuladoKgMsHa)} kg MS/ha el {fechaCorta(alFinal.fecha)}.</p>}
      <p className={`${APAGADO} m-0 mt-1`}>Es lo que creció, no lo que hay en pie: no descuenta lo que se seca.</p>
      <GraficoCrecimiento dias={estimacion.dias} dia={dia} />
    </div>}

    {estimacion && lote.tipoPastura && <ComoSeCalcula estimacion={estimacion} dia={dia} />}
  </section>;
}
