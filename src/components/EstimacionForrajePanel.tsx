import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { obtenerEstimacionForraje, type DiaCondicion, type EstimacionForraje, type ParametroConFuente } from "../api/estimacion";
import {
  CONDICION_PASTOREO, EXPLICACION_CONDICION, NOMBRE_ORIGEN_CLIMA,
  esMensajeTerminal, esPiso, fechaCorta, fraseConsumible, frasePastoEnPie, fraseVentanaReingreso, porcentajeRebrote, resumirCondicion,
} from "../estimacion/presentacion";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import type { Lote } from "../types";
import AvisoInfo from "./ui/AvisoInfo";
import { APAGADO, TARJETA, VOLANTA } from "./ui/PantallaDatos";

interface EstimacionForrajePanelProps {
  lote: Lote;
  /** Cambia cada vez que la ficha recarga clima, satélite o usos, para volver a pedir la estimación. */
  refresco: unknown;
}

const TARJETA_INTERIOR = "rounded-2xl border border-gray-200/80 bg-white p-3.5 md:p-[18px]";
const GRIS = "#9ca3af";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function numero(valor: number): string {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 3 });
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
  </div>;
}

interface FilaParametro {
  nombre: string;
  texto: string;
  fuente: ParametroConFuente<unknown>["fuente"];
}

function filaParametro<T>(nombre: string, parametro: ParametroConFuente<T>, formato: (valor: T) => string): FilaParametro {
  return {
    nombre,
    texto: parametro.valor === null ? "Sin fuente verificada: el modelo no lo reemplaza por un supuesto." : formato(parametro.valor),
    fuente: parametro.fuente,
  };
}

function filasParametros(usados: NonNullable<EstimacionForraje["parametrosUsados"]>): FilaParametro[] {
  return [
    filaParametro("Criterio de reingreso", usados.reingreso, (valor) => `${numero(valor.hojasVivasPorMacollo)} hojas vivas por macollo · filocrono ${valor.filocronoGradosDia.join("–")} °Cd · vida media foliar ${valor.vidaMediaFoliarGradosDia.join("–")} °Cd · temperatura base ${valor.temperaturaBaseC.join("–")} °C`),
    ...(usados.alturaAKg ? (["plato", "regla"] as const).map((instrumento) => filaParametro(
      `Altura a kilos con ${instrumento}`, usados.alturaAKg[instrumento],
      (valor) => `${(["otono", "invierno", "primavera", "verano"] as const).map((estacion) => `${{ otono: "otoño", invierno: "invierno", primavera: "primavera", verano: "verano" }[estacion]} ${numero(valor.porEstacion[estacion].kgPorCm)}${valor.porEstacion[estacion].usaAnual ? " (anual)" : ""}`).join(" · ")} kg MS/ha por cm · calibrado de ${numero(valor.rangoValidoCm[0])} a ${numero(valor.rangoValidoCm[1])} cm · ${valor.instrumento}`,
    )) : []),
    ...(usados.remanenteObjetivoCm ? (["plato", "regla"] as const).map((instrumento) => filaParametro(
      `Remanente objetivo con ${instrumento}`, usados.remanenteObjetivoCm[instrumento], (valor) => `${numero(valor)} cm`,
    )) : []),
  ];
}

/**
 * Los términos técnicos de las fuentes, dichos en castellano. Están acá y no en
 * la pantalla principal a propósito: el productor no necesita conocerlos para
 * usar la estimación, pero si abre el detalle tiene que poder entender lo que lee.
 */
const GLOSARIO: Array<[string, string]> = [
  ["Macollo", "Cada uno de los brotes o “hijos” que salen de la misma planta de pasto."],
  ["Hoja viva", "Hoja que todavía está verde y alimentando a la planta, antes de empezar a secarse."],
  ["Grados-día (°Cd)", "Suma del calor de cada día. Un día templado suma poco y uno cálido suma mucho; el pasto saca una hoja nueva cuando junta una cantidad fija."],
  ["Filocrono", "Cuánto calor necesita la planta para sacar una hoja nueva."],
  ["Vida media foliar", "Cuánto calor aguanta una hoja desde que sale hasta que se empieza a secar."],
  ["Estado foliar óptimo", "El punto en que la planta juntó las hojas que le convienen: es cuando mejor rinde entrar a pastorear."],
  ["kg MS/ha", "Kilos de materia seca por hectárea, o sea el pasto descontando el agua que tiene."],
  ["Remanente objetivo", "La altura a la que conviene sacar los animales para que el pasto rebrote bien."],
];

function Glosario() {
  return <details className="mt-3 border-t border-gray-100 pt-2">
    <summary className="cursor-pointer text-[0.8rem] font-semibold text-gray-700">Qué quiere decir cada término</summary>
    <dl className="m-0 mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[0.8rem] md:grid-cols-[max-content_1fr]">
      {GLOSARIO.map(([termino, definicion]) => (
        <div key={termino} className="contents">
          <dt className="font-semibold text-gray-700">{termino}</dt>
          <dd className="m-0 text-gray-600">{definicion}</dd>
        </div>
      ))}
    </dl>
  </details>;
}

/** Los números detrás de la etiqueta y de dónde sale cada parámetro, para quien los quiera ver. */
function ComoSeCalcula({ estimacion }: { estimacion: EstimacionForraje }) {
  const reingreso = estimacion.reingreso;
  const condicion = reingreso?.condicionHoy ?? null;
  const filas: Array<[string, string]> = [];
  if (condicion) filas.push(["Por qué esta etiqueta", EXPLICACION_CONDICION[condicion.condicion]]);
  if (condicion) filas.push(["Estado foliar óptimo alcanzado", `${condicion.avanceEstadoFoliar} %${reingreso?.esMinimo ? " como mínimo" : ""}`]);
  if (condicion) filas.push(["Grados-día acumulados", `${Math.round(condicion.gradosDia.conBaseMinima)} °Cd (base ${reingreso?.criterio?.temperaturaBaseC[0]} °C)`]);
  if (reingreso?.inicioConteo === "pastoreo" && reingreso.fechaUltimoPastoreo) filas.push(["Se cuenta desde", `el pastoreo del ${fecha(reingreso.fechaUltimoPastoreo)}`]);
  if (reingreso?.inicioConteo === "alta" && reingreso.fechaInicioConteo) filas.push(["Se cuenta desde", `el alta del lote (${fecha(reingreso.fechaInicioConteo)}), porque no hay pastoreos registrados`]);
  if (reingreso?.criterio && reingreso.inicioConteo) filas.push([reingreso.esMinimo ? "Ventana ideal, a más tardar" : "Ventana ideal", `${reingreso.fechaTemprana ? fecha(reingreso.fechaTemprana) : "—"} a ${reingreso.fechaTardia ? fecha(reingreso.fechaTardia) : "—"}`]);
  if (condicion) filas.push(["Clima de hoy", NOMBRE_ORIGEN_CLIMA[condicion.climaUsado]]);
  const usados = estimacion.parametrosUsados;

  return <details className="mt-[14px] rounded-2xl border border-gray-200 bg-white p-4 text-[0.85rem] text-gray-600">
    <summary className="cursor-pointer font-semibold text-gray-800">Cómo se calcula: parámetros y fuentes</summary>
    {filas.length > 0 && <dl className="m-0 mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 md:grid-cols-[max-content_1fr]">
      {filas.map(([nombre, valor]) => <div key={nombre} className="contents"><dt className="text-gray-400">{nombre}</dt><dd className="m-0 text-gray-800">{valor}</dd></div>)}
    </dl>}
    {usados && <>
      <p className="mt-3 mb-1 font-semibold text-gray-700">Parámetros ({usados.pastura})</p>
      <p className="m-0 text-[0.8rem]">La condición sale de la temperatura acumulada desde que salieron los animales: cada hoja nueva necesita una cantidad fija de grados-día. El satélite no interviene.</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-[0.8rem]">
        {filasParametros(usados).map(({ nombre, texto, fuente }) => <li key={nombre}>
          <strong className="text-gray-800">{nombre}:</strong> {texto}
          {fuente && <span className="block text-gray-500">
            {fuente.cita}{fuente.url && <> · <a href={fuente.url} target="_blank" rel="noreferrer">ver fuente</a></>}
            {fuente.nota && <span className="block text-gray-400">{fuente.nota}</span>}
          </span>}
        </li>)}
      </ul>
      <Glosario />
    </>}
  </details>;
}

/**
 * Condición estimada para pastorear, de hoy y de los días con pronóstico, y el
 * pasto en pie medido. Arriba lo que hace falta para decidir; los números, en
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

  return <section className={`${TARJETA} p-4 md:p-[22px]`}>
    <p className={VOLANTA}>Estimación provisional</p>
    <h2 className="m-0 text-[1.3rem] font-semibold text-gray-900">Condición para pastorear</h2>

    {cargando && !estimacion && <p className={APAGADO}>Calculando…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}

    {estimacion && <ContenidoEstimacion lote={lote} estimacion={estimacion} dia={dia} />}
  </section>;
}

/** Con un mensaje terminal (sin pastura, sin parámetros, sin clima o sin migración) se muestra sólo eso. */
export function ContenidoEstimacion({ lote, estimacion, dia }: { lote: Lote; estimacion: EstimacionForraje; dia: string }) {
  if (esMensajeTerminal(estimacion)) {
    return <div className={`${TARJETA_INTERIOR} mt-4 border-l-[6px]`} style={{ borderLeftColor: GRIS }}>
      <strong className="block text-[1.3rem] leading-tight text-gray-500">Sin estimación</strong>
      <p className="m-0 mt-1.5 text-[1rem] text-gray-800">{estimacion.mensaje}</p>
    </div>;
  }
  const resumen = resumirCondicion(lote, estimacion, dia);
  const color = resumen.condicion ? CONDICION_PASTOREO[resumen.condicion].color : GRIS;
  const ventana = fraseVentanaReingreso(estimacion.reingreso, dia);
  const deHoy = estimacion.dias.find((item) => item.fecha === dia) ?? null;
  const enPie = frasePastoEnPie(estimacion, dia);
  const consumible = fraseConsumible(estimacion, dia);
  // Contado desde el alta, un porcentaje bajo sólo dice "no sé": no se muestra.
  const rebrote = deHoy?.progresoRebrote != null && deHoy.etapa && deHoy.etapa !== "en-pastoreo" && !deHoy.etapaEsMinimo
    ? `Rebrote al ${porcentajeRebrote(deHoy.progresoRebrote)} (100 % es listo para entrar).`
    : null;
  const aclaraciones = [enPie.nota, consumible && !consumible.calculado ? consumible.texto : null, estimacion.mensaje].filter(Boolean) as string[];

  return <>
    <div className={`${TARJETA_INTERIOR} mt-4 border-l-[6px]`} style={{ borderLeftColor: color }}>
      {resumen.prefijo && <span className="block text-[0.72rem] font-semibold tracking-[0.06em] text-gray-400 uppercase">{resumen.prefijo}</span>}
      <div className="flex items-center gap-2">
        <strong className={`block leading-tight ${resumen.condicion ? "text-[1.8rem]" : "text-[1.3rem] text-gray-500"}`} style={resumen.condicion ? { color } : undefined}>{resumen.titulo}</strong>
        {resumen.nota && <AvisoInfo titulo="Sin pastoreos registrados">{resumen.nota}</AvisoInfo>}
      </div>
      {resumen.frase && <p className="m-0 mt-1.5 text-[1rem] text-gray-800">{resumen.frase}</p>}
      {resumen.condicion && estimacion.reingreso && <TiraDias condiciones={estimacion.reingreso.condiciones} dia={dia} esMinimo={estimacion.reingreso.esMinimo} />}
    </div>

    <div className={`${TARJETA_INTERIOR} mt-[14px]`}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-base font-semibold text-gray-900">Rebrote y pasto en pie</h3>
        {estimacion.avisos.length > 0 && <AvisoInfo tono="info" titulo="A tener en cuenta">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4">{estimacion.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
        </AvisoInfo>}
      </div>
      <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-[0.92rem] text-gray-800">
        {ventana && <li>{ventana}</li>}
        {rebrote && <li>{rebrote}</li>}
        <li className="mt-1.5 flex items-center gap-2 font-semibold">
          <span>{enPie.principal}</span>
          {aclaraciones.length > 0 && <AvisoInfo tono="info" titulo="Pasto en pie">{aclaraciones.map((texto) => <p key={texto} className="m-0 mb-1 last:mb-0">{texto}</p>)}</AvisoInfo>}
        </li>
        {consumible?.calculado && <li className="font-semibold">{consumible.texto}</li>}
      </ul>
    </div>

    <ComoSeCalcula estimacion={estimacion} />
  </>;
}
