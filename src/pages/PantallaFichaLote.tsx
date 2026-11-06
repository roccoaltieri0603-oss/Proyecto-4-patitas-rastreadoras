import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
import { modificarUsoLote, eliminarUsoLote } from '../api/historial';
import PromptModal from '../components/PromptModal';
import ConfirmModal from '../components/ConfirmModal';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { actualizarSateliteLote } from "../copernicus/api";
import { porcentajeInundado } from "../copernicus/presentacion";
import { obtenerEstimacionForraje, type EstimacionForraje } from "../api/estimacion";
import { diasEntre, progresoRegeneracion, resumirCondicion } from "../estimacion/presentacion";
import { ETIQUETA_LLUVIA, EXPLICACION_LLUVIA } from "../clima/interpretacion";
import { actualizarClimaLote } from "../clima/api";
import { obtenerLotes } from "../api/rodeo";
import { actualizarPendientes } from "../api/establecimientos";
import { ApiError } from "../api/client";
import { obtenerConsultasClima, obtenerEstadoLote, obtenerMedicionesSatelitales, obtenerUsosLote, type ConsultaClimaHistorial, type EstadoLoteApi, type MedicionSatelital, type PaginacionHistorial, type UsoLote } from "../api/historial";
import type { Lote } from "../types";
import type { CategoriaLluvia, DiaClima } from "../clima/types";
import marcaRodeo from "../assets/rodeo-marca.svg";
import AvisoInfo from "../components/ui/AvisoInfo";
import BloquesRegeneracion from "../components/BloquesRegeneracion";
import MiniaturaLote from "../components/MiniaturaLote";
import PasturaPanel from "../components/PasturaPanel";
import EstimacionForrajePanel from "../components/EstimacionForrajePanel";
import JornadaPastoreoPanel, { EditarJornadaModal, describirUso, mensajeBorrarUso } from "../components/JornadaPastoreoPanel";
import MedicionesAlturaPanel from "../components/MedicionesAlturaPanel";
import { EstadoDePantalla, PASTILLA_VERDE } from "../components/ui/PantallaDatos";

/*
 * Frame "Ficha de lote · identidad" del Figma (1280 × 1929): un hero oscuro con
 * la respuesta y la miniatura del lote, y debajo las secciones claras. Las
 * medidas son las del frame; el contenido se centra en 1280 px en pantallas
 * más anchas y pasa a una columna en las angostas. La página scrollea entera.
 */

type Tab = "satelite" | "clima" | "uso";
const PAGE_SIZE = 20;

/** Tarjeta blanca de las secciones claras. */
const TARJETA = "rounded-2xl bg-white";
/** Volanta verde en mayúsculas ("LO QUE VIO EL SATÉLITE", "PRONÓSTICO"). */
const VOLANTA = "m-0 font-semibold tracking-[0.1em] text-verde-volanta uppercase";
const TINTA_APAGADA = "text-landing-oscuro/55";
/** Píldora chica para las acciones secundarias (actualizar satélite y clima). */
const PILDORA = "foco-campo inline-flex cursor-pointer items-center justify-center rounded-full border border-landing-oscuro/15 bg-white px-4 py-2 text-sm leading-[18px] font-medium text-landing-tinta transition-colors hover:bg-landing-oscuro/5 disabled:cursor-not-allowed disabled:opacity-50";
/** "Átomo / Botón" verde del frame. */
const BOTON_VERDE = "foco-campo inline-flex h-[50px] cursor-pointer items-center justify-center rounded-full border-0 bg-verde-accion px-7 text-base leading-5 font-medium tracking-[-0.01em] text-landing-tinta no-underline transition-colors hover:bg-lima disabled:cursor-not-allowed disabled:opacity-50";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function diaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function esNumero(valor: number | null | undefined): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function numero(valor: number | null | undefined, decimales = 2): string {
  return esNumero(valor) ? valor.toFixed(decimales) : "Sin datos";
}

/** Los índices como en el frame: punto decimal y el signo menos tipográfico. */
function indice(valor: number | null | undefined): string {
  if (!esNumero(valor)) return "Sin datos";
  return valor < 0 ? `−${Math.abs(valor).toFixed(2)}` : valor.toFixed(2);
}

/** Milímetros y valores en texto corrido, con coma decimal: "11,1". */
function coma(valor: number, decimales: number): string {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function mensajeError(error: unknown): string {
  if (error instanceof ApiError && error.code === "LOT_NOT_FOUND") return "Lote no encontrado";
  if (error instanceof ApiError) return error.message;
  return "No se pudo cargar la ficha. Intentá nuevamente.";
}

function plural(cantidad: number, singular: string, pluralTexto: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;
}

type Estadisticas = { media: number | null; mediana: number | null; min: number | null; max: number | null; desvio: number | null };

/** Qué mide cada sigla, en una línea: el productor no tiene por qué conocerlas. */
const QUE_MIDE: Record<string, string> = {
  NDVI: "Cuán verde y densa está la vegetación. Es el más usado para ver cómo viene el pasto.",
  NDMI: "Cuánta humedad tiene la vegetación.",
  NDWI: "Presencia de agua en superficie. Sirve para detectar anegamientos.",
  EVI: "Parecido al NDVI, pero aguanta mejor la vegetación muy densa.",
  RVI: "Cuánta vegetación ve el radar. El radar atraviesa las nubes, pero no se compara con los otros.",
};

/**
 * "Índice" del frame: nombre, sigla, la mediana grande y la rampa con el
 * marcador. La rampa es el rango físico del índice (−1 a 1, o 0 a 1 para el
 * RVI), no una escala calibrada: el marcador dice dónde cae el valor en ese
 * rango y nada más. La estadística completa de la imagen queda en el "i".
 */
function TarjetaIndice({ nombre, sigla, stats, rango, extremos }: {
  nombre: string; sigla: string; stats: Estadisticas | null;
  rango: [number, number]; extremos: [string, string];
}) {
  const valor = stats?.mediana ?? null;
  const posicion = esNumero(valor) ? Math.min(100, Math.max(0, ((valor - rango[0]) / (rango[1] - rango[0])) * 100)) : null;
  return <article className={`${TARJETA} flex min-w-0 flex-1 basis-[200px] flex-col gap-2.5 p-5`}>
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 text-sm leading-[19px] font-medium tracking-[-0.02em] text-landing-oscuro/80">{nombre}</span>
      <span className="shrink-0 text-xs leading-4 font-semibold tracking-[0.04em] text-landing-oscuro/40">{sigla}</span>
    </div>
    {/* La "i" va en la fila del valor: en la del nombre lo partía o lo recortaba. */}
    <div className="flex items-center justify-between gap-2">
      <strong className={`text-[40px] leading-[53px] font-medium tracking-[-0.03em] tabular-nums ${esNumero(valor) ? "text-landing-oscuro" : "text-[28px] text-landing-oscuro/40"}`}>{indice(valor)}</strong>
      <AvisoInfo tono="info" titulo={`Qué mide el ${sigla}`}>
        <p className="m-0 mb-1">{QUE_MIDE[sigla]}</p>
        {stats && <p className="m-0 mb-1 tabular-nums">Mediana {numero(stats.mediana)} · media {numero(stats.media)} · mín. {numero(stats.min)} · máx. {numero(stats.max)} · desvío {numero(stats.desvio)}.</p>}
        <p className="m-0">La barra va de {coma(rango[0], 0)} a {coma(rango[1], 0)}, el rango posible del índice. No es una calibración para este campo.</p>
      </AvisoInfo>
    </div>
    <div className="relative h-2.5">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-[3px] bg-linear-to-r from-crema to-lima" />
      {/* "Marcador" del frame: 10 px de alto con el borde blanco incluido. */}
      {posicion !== null && <div className="absolute top-0 h-2.5 w-[6px] -translate-x-1/2 border-2 border-white bg-landing-oscuro" style={{ left: `${posicion}%` }} />}
    </div>
    <div className="flex justify-between text-[11px] leading-[15px] text-landing-oscuro/45"><span>{extremos[0]}</span><span>{extremos[1]}</span></div>
  </article>;
}

/**
 * "Cómo viene el verdor": la mediana de NDVI de las imágenes ópticas guardadas.
 * La escala se ajusta a lo observado con un respiro arriba y abajo; una escala
 * fija de −1 a 1 aplastaría la curva contra el medio.
 */
function GraficoVerdor({ mediciones }: { mediciones: MedicionSatelital[] }) {
  const puntos = mediciones.filter((item) => item.fuente === "sentinel-2" && item.ndvi.mediana !== null).slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const encabezado = (detalle: ReactNode) => <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="m-0 text-xl leading-[27px] font-medium tracking-[-0.03em] text-landing-oscuro">Cómo viene el verdor</h3>
    <p className={`m-0 text-sm leading-[19px] tracking-[-0.03em] tabular-nums ${TINTA_APAGADA}`}>{detalle}</p>
  </div>;
  if (puntos.length === 0) return <>{encabezado(null)}<p className={`m-0 text-sm ${TINTA_APAGADA}`}>Sin imágenes ópticas guardadas todavía.</p></>;

  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const dias = Math.abs(diasEntre(primero.observedAt.slice(0, 10), ultimo.observedAt.slice(0, 10)));
  const ancho = 1136;
  const alto = 140;
  const valores = puntos.map((punto) => punto.ndvi.mediana as number);
  const piso = Math.min(...valores);
  const techo = Math.max(...valores);
  const respiro = Math.max(0.05, (techo - piso) * 0.35);
  const minimo = piso - respiro;
  const maximo = techo + respiro;
  const x = (indiceDelPunto: number) => (puntos.length === 1 ? ancho / 2 : (indiceDelPunto / (puntos.length - 1)) * ancho);
  const y = (valor: number) => 20 + ((maximo - valor) / (maximo - minimo)) * 100;
  const linea = puntos.map((punto, i) => `${x(i)},${y(punto.ndvi.mediana as number)}`).join(" ");
  const area = `0,${alto} ${linea} ${x(puntos.length - 1)},${alto}`;
  const desde = coma(primero.ndvi.mediana as number, 2);
  const hasta = coma(ultimo.ndvi.mediana as number, 2);

  return <>
    {encabezado(puntos.length > 1 ? `${desde} → ${hasta}${dias > 0 ? ` en los últimos ${dias} días` : ""}` : `${desde} el ${diaMes(primero.observedAt)}`)}
    <div className="relative h-[140px]">
      {[10, 70, 130].map((arriba) => <div key={arriba} className="absolute inset-x-0 h-px bg-landing-oscuro/7" style={{ top: arriba }} />)}
      <svg className="absolute inset-0 block h-full w-full overflow-visible" viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" role="img"
        aria-label={`Verdor (NDVI): de ${desde} el ${fecha(primero.observedAt)} a ${hasta} el ${fecha(ultimo.observedAt)}`}>
        <defs>
          <linearGradient id="relleno-verdor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(121,218,88,0.28)" />
            <stop offset="100%" stopColor="rgba(255,222,103,0)" />
          </linearGradient>
        </defs>
        {puntos.length > 1 && <polygon points={area} fill="url(#relleno-verdor)" />}
        {puntos.length > 1 && <polyline points={linea} fill="none" stroke="#2f7d2c" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {puntos.map((punto, i) => <circle key={`${punto.id}-${punto.observedAt}`} cx={x(i)} cy={y(punto.ndvi.mediana as number)} r="7" fill="transparent">
          <title>{fecha(punto.observedAt)} · NDVI {numero(punto.ndvi.mediana)}</title>
        </circle>)}
        {puntos.length === 1 && <circle cx={x(0)} cy={y(valores[0])} r="5" fill="#2f7d2c" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
    <div className="flex justify-between text-xs leading-4 tracking-[-0.03em] text-landing-oscuro/50 tabular-nums">
      <span>{diaMes(primero.observedAt)}</span>
      {puntos.length > 1 && <span>{diaMes(ultimo.observedAt)}</span>}
    </div>
  </>;
}

/** Serie diaria de la última consulta: lo pasado según Open-Meteo y el pronóstico, sin mezclarlos. */
function TablaDiasClima({ dias, hoy }: { dias: DiaClima[]; hoy: string }) {
  if (dias.length === 0) return null;
  return <details className="w-full">
    <summary className="cursor-pointer text-sm font-medium text-landing-tinta">Ver día por día <span className={`font-normal ${TINTA_APAGADA}`}>· hasta el {fecha(dias[dias.length - 1].fecha)}</span></summary>
    <p className={`m-0 mt-2 flex items-center gap-2 text-[0.8rem] ${TINTA_APAGADA}`}>
      Últimos 7 días y pronóstico
      <AvisoInfo tono="info" titulo="Día por día">
        <p className="m-0 mb-1">El pronóstico es una estimación, no una medición: los días marcados como pronóstico todavía no pasaron.</p>
        <p className="m-0 mb-1"><b>Radiación</b>: cuánto sol recibió el lote ese día. Más sol, más crecimiento, si hay agua.</p>
        <p className="m-0"><b>ET₀</b>: cuánta agua se evapora en un día en un pasto de referencia. Es una medida estándar del clima, no el consumo del pasto de este lote.</p>
      </AvisoInfo>
    </p>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr>{["Fecha", "Tipo", "Lluvia (mm)", "Temp. (°C)", "Radiación (MJ/m²)", "ET₀ (mm)"].map((titulo) => <th key={titulo} className={CELDA_ENCABEZADO}>{titulo}</th>)}</tr></thead>
        <tbody>{dias.map((dia) => <tr key={dia.fecha} className={dia.fecha === hoy ? "bg-lima/15 font-semibold" : dia.esPronostico ? "text-landing-oscuro/60" : undefined}>
          <td className={CELDA}>{fecha(dia.fecha)}{dia.fecha === hoy && " · hoy"}</td>
          <td className={CELDA}>{dia.esPronostico ? "pronóstico" : "observado"}</td>
          <td className={CELDA}><Medida valor={dia.lluviaMm} decimales={1} /></td>
          <td className={CELDA}><Medida valor={dia.tempMin} decimales={0} />–<Medida valor={dia.tempMax} decimales={0} /></td>
          <td className={CELDA}><Medida valor={dia.radiacionMjM2} decimales={1} /></td>
          <td className={CELDA}><Medida valor={dia.evapotranspiracionMm} decimales={1} /></td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

/** "Tabla / Fila" del frame: encabezado con fondo y renglones separados por una línea. */
const CELDA_ENCABEZADO = "bg-landing-tinta/[0.045] px-4 py-3 text-left text-xs leading-4 font-medium whitespace-nowrap text-gris-rotulo first:rounded-l-[10px] last:rounded-r-[10px]";
const CELDA = "border-b border-landing-tinta/7 px-4 py-[11px] text-sm leading-[18px] whitespace-nowrap text-landing-tinta tabular-nums";

function Medida({ valor, decimales }: { valor: number | null; decimales: number }) {
  return valor === null ? <span className={`text-[0.78rem] ${TINTA_APAGADA}`}>sin datos</span> : <>{valor.toFixed(decimales)}</>;
}

function Paginador({ paginacion, onAnterior, onSiguiente }: { paginacion: PaginacionHistorial | null; onAnterior: () => void; onSiguiente: () => void }) {
  if (!paginacion || paginacion.total <= PAGE_SIZE) return null;
  return <div className={`flex items-center justify-center gap-3.5 text-sm ${TINTA_APAGADA}`}>
    <button type="button" className={PILDORA} onClick={onAnterior} disabled={paginacion.offset === 0}>Anterior</button>
    <span>{paginacion.offset + 1}–{Math.min(paginacion.offset + PAGE_SIZE, paginacion.total)} de {paginacion.total}</span>
    <button type="button" className={PILDORA} onClick={onSiguiente} disabled={!paginacion.hayMas}>Siguiente</button>
  </div>;
}

/** Un dato del clima: el número grande y su rótulo. */
function DatoClima({ valor, rotulo }: { valor: string; rotulo: string }) {
  return <div className="flex min-w-[140px] flex-1 flex-col gap-1">
    <strong className="text-[28px] leading-[37px] font-medium tracking-[-0.03em] text-landing-oscuro tabular-nums">{valor}</strong>
    <span className={`text-[13px] leading-[17px] tracking-[-0.02em] ${TINTA_APAGADA}`}>{rotulo}</span>
  </div>;
}

export default function PantallaFichaLote() {
  const { establecimientoId, establecimiento, puede } = useEstablecimiento();
  const { id = "" } = useParams();
  const [editarUso, setEditarUso] = useState<UsoLote | null>(null);
  const [borrarUso, setBorrarUso] = useState<UsoLote | null>(null);
  const [lote, setLote] = useState<Lote | null>(null);
  const [estado, setEstado] = useState<EstadoLoteApi | null>(null);
  const [mediciones, setMediciones] = useState<MedicionSatelital[]>([]);
  const [climas, setClimas] = useState<ConsultaClimaHistorial[]>([]);
  const [usos, setUsos] = useState<UsoLote[]>([]);
  const [paginaciones, setPaginaciones] = useState<{ satelite: PaginacionHistorial | null; clima: PaginacionHistorial | null; uso: PaginacionHistorial | null }>({ satelite: null, clima: null, uso: null });
  const [tab, setTab] = useState<Tab>("satelite");
  const [paginas, setPaginas] = useState({ satelite: 0, clima: 0, uso: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  // La estimación la pide la ficha y no el panel: también la usa el hero, y así
  // el lote se calcula una sola vez por visita.
  const [estimacion, setEstimacion] = useState<EstimacionForraje | null>(null);
  const [estimacionCargando, setEstimacionCargando] = useState(true);
  const [errorEstimacion, setErrorEstimacion] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"satelite" | "clima" | "uso" | null>(null);
  // Desde el orden de pastoreo se llega con ?cargar=pastoreo. Se lee una vez y
  // se saca de la URL, para que recargar la ficha no vuelva a mover la vista.
  const [searchParams, setSearchParams] = useSearchParams();
  const [enfocarPastoreo] = useState(() => searchParams.get("cargar") === "pastoreo");
  // "Registrar uso" abre el formulario de pastoreo terminado del panel de
  // jornadas, con su scroll y su resaltado: se remonta el panel con otra clave.
  const [pedidosRegistrarUso, setPedidosRegistrarUso] = useState(0);
  useEffect(() => {
    if (!searchParams.has("cargar")) return;
    searchParams.delete("cargar");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    setNoEncontrado(false);
    try {
      const lotes = await obtenerLotes(establecimientoId);
      const loteActual = lotes.find((item) => item.id === id);
      if (!loteActual) { setNoEncontrado(true); return; }
      const [estadoActual, satelite, clima, uso] = await Promise.all([
        obtenerEstadoLote(establecimientoId, id),
        obtenerMedicionesSatelitales(establecimientoId, id, { limit: PAGE_SIZE, offset: paginas.satelite * PAGE_SIZE }),
        obtenerConsultasClima(establecimientoId, id, { limit: PAGE_SIZE, offset: paginas.clima * PAGE_SIZE }),
        obtenerUsosLote(establecimientoId, id, { limit: PAGE_SIZE, offset: paginas.uso * PAGE_SIZE }),
      ]);
      setLote(loteActual);
      setEstado(estadoActual);
      setMediciones(satelite.items);
      setClimas(clima.items);
      setUsos(uso.items);
      setPaginaciones({ satelite: satelite.paginacion, clima: clima.paginacion, uso: uso.paginacion });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) setNoEncontrado(true);
      else setError(mensajeError(reason));
    } finally { setCargando(false); }
  }, [id, establecimientoId, paginas]);

  useEffect(() => { void cargarDatos(); }, [cargarDatos]);

  // Se vuelve a pedir cuando cambian la pastura o los datos del lote (clima,
  // satélite, usos): la condición y el rebrote se cuentan con eso.
  useEffect(() => {
    if (!lote) return;
    let vigente = true;
    setEstimacionCargando(true);
    setErrorEstimacion(null);
    obtenerEstimacionForraje(establecimientoId, lote.id)
      .then((resultado) => { if (vigente) setEstimacion(resultado); })
      .catch((reason: unknown) => { if (vigente) setErrorEstimacion(reason instanceof ApiError ? reason.message : "No se pudo calcular la estimación. Intentá nuevamente."); })
      .finally(() => { if (vigente) setEstimacionCargando(false); });
    return () => { vigente = false; };
  }, [establecimientoId, lote?.id, lote?.tipoPastura, estado]);

  // Entrar por link directo a la ficha también pone al día lo vencido. El
  // backend no reconsulta si ya lo hizo recién, así que esto es barato; cuando
  // trajo algo nuevo, se releen los datos de la ficha.
  useEffect(() => {
    let vigente = true;
    actualizarPendientes(establecimientoId)
      .then(({ ejecutado }) => { if (vigente && ejecutado) return cargarDatos(); })
      // No molesta al usuario: la ficha ya muestra lo guardado y quedan los
      // botones para reintentar. Se registra para poder diagnosticarlo.
      .catch((reason: unknown) => { console.warn("No se pudieron traer datos nuevos al abrir la ficha:", reason); });
    return () => { vigente = false; };
  }, [establecimientoId]);

  const hoyIso = hoy();
  const progresoRebrote = progresoRegeneracion(estimacion?.reingreso, undefined);
  const motivoRegeneracion = errorEstimacion
    ?? estimacion?.mensaje
    ?? estimacion?.reingreso?.mensaje
    ?? "Hace falta el tipo de pastura, el clima y el último pastoreo para contar el rebrote.";
  const resumen = useMemo(() => (lote ? resumirCondicion(lote, estimacion, hoyIso) : null), [lote, estimacion, hoyIso]);
  const ultimaActualizacion = useMemo(() => {
    const fechas = [estado?.satelite.optico?.consultedAt, estado?.satelite.radar?.consultedAt, estado?.clima?.consultedAt].filter(Boolean) as string[];
    return fechas.sort().at(-1) ?? null;
  }, [estado]);

  async function actualizarSatelite() {
    if (!lote || ocupado) return;
    setOcupado("satelite"); setError(null);
    try {
      const { resultado: respuesta, erroresPersistencia, corteCopernicus } = await actualizarSateliteLote(establecimientoId, lote.id);
      if (erroresPersistencia.length) {
        setError("Copernicus respondió, pero no se pudo guardar el resultado. Los datos anteriores siguen disponibles; intentá nuevamente más tarde.");
        return;
      }
      if (respuesta.estado !== "ok" && respuesta.estado !== "radar") {
        setError(respuesta.mensaje ?? "Copernicus no devolvió datos utilizables.");
        return;
      }
      await cargarDatos();
      if (corteCopernicus) setError("Se guardó la observación óptica, pero Copernicus limitó la consulta de radar. Podés conservar y consultar la óptica; el radar no se actualizó.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo consultar Copernicus. Intentá nuevamente.");
    } finally { setOcupado(null); }
  }

  async function actualizarClima() {
    if (!lote || ocupado) return;
    setOcupado("clima"); setError(null);
    try {
      const respuesta = await actualizarClimaLote(establecimientoId, lote.id, "manual");
      if (respuesta?.estado !== "ok") throw new Error(respuesta?.mensaje ?? "No se pudo consultar el clima.");
      await cargarDatos();
    } catch (reason) { setError(mensajeError(reason)); }
    finally { setOcupado(null); }
  }

  useOcultarDock(cargando && !estado);

  if (cargando && !estado) return <EstadoDePantalla><p>Cargando ficha del lote...</p></EstadoDePantalla>;
  if (noEncontrado) return <EstadoDePantalla><h1>Lote no encontrado</h1><p>El lote no existe o no está disponible para tu usuario.</p><Link to={`/establecimientos/${establecimientoId}`} className={PASTILLA_VERDE}>Volver al mapa</Link></EstadoDePantalla>;
  if (!estado || !lote) return <EstadoDePantalla role="alert"><p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error ?? "No se pudo cargar la ficha."}</p><Link to={`/establecimientos/${establecimientoId}`} className={PASTILLA_VERDE}>Volver al mapa</Link></EstadoDePantalla>;

  const optico = estado.satelite.optico;
  const radar = estado.satelite.radar;
  const reingreso = estimacion?.reingreso ?? null;
  const ultimoUso = estado.uso.ultimoUso;
  const volanta = [`Lote ${estado.lote.numero}`, estado.lote.apodo, establecimiento?.nombre, estado.lote.activo ? null : "Inactivo"].filter(Boolean).join(" · ");

  // "Último pastoreo hace X días · Descanso estimado: Y días". El descanso es el
  // de la estimación (del último pastoreo a la fecha temprana de reingreso); si
  // se cuenta desde el alta no se dice, porque no hubo pastoreo del cual contar.
  const lineaUso: string[] = [];
  if (ultimoUso?.enCurso) lineaUso.push(`Con animales desde el ${diaMes(ultimoUso.fecha)}`);
  else if (estado.uso.diasDescanso !== null) lineaUso.push(`Último pastoreo hace ${plural(estado.uso.diasDescanso, "día", "días")}`);
  else lineaUso.push("Sin pastoreos registrados");
  if (!ultimoUso?.enCurso && reingreso && !reingreso.esMinimo && reingreso.fechaUltimoPastoreo && reingreso.fechaTemprana) {
    lineaUso.push(`Descanso estimado: ${plural(diasEntre(reingreso.fechaUltimoPastoreo, reingreso.fechaTemprana), "día", "días")}`);
  }

  const categoriaLluvia = estado.clima?.categoria as CategoriaLluvia | null | undefined;
  const fechaVolantaSatelite = [optico && `óptico ${fecha(optico.observedAt)}`, radar && `radar ${fecha(radar.observedAt)}`].filter(Boolean).join(" · ");

  return <div className="min-h-screen bg-ficha-fondo font-display text-landing-oscuro">
    {/* ───────────── Hero ───────────── */}
    <header className="bg-landing-oscuro text-white">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-9 px-6 pt-9 pb-12 md:px-12">
        <div className="flex items-center justify-between">
          <Link to={`/establecimientos/${establecimientoId}`} className="foco-campo rounded text-[15px] leading-5 font-medium tracking-[-0.03em] text-white/60 no-underline hover:text-white">
            ← Volver al mapa
          </Link>
          <img src={marcaRodeo} alt="RODEO" className="h-[43px] w-auto" />
        </div>

        {error && <div role="alert" className="rounded-2xl border border-red-300/60 bg-red-500/15 px-4 py-3 text-sm text-white">{error}</div>}

        <div className="flex flex-col items-stretch gap-12 lg:flex-row lg:items-center">
          <section className="flex min-w-0 flex-1 flex-col items-start" aria-label="Estado del lote">
            <p className="m-0 text-[13px] leading-[17px] font-semibold tracking-[0.1em] text-verde-accion uppercase">{volanta}</p>
            {resumen?.prefijo && <p className="m-0 mt-3.5 text-lg leading-6 font-medium tracking-[-0.02em] text-white/65">{resumen.prefijo}</p>}
            <h1 className={`m-0 ${resumen?.prefijo ? "mt-1" : "mt-3.5"} max-w-[576px] text-[clamp(44px,6vw,64px)] leading-[0.96] font-medium tracking-[-0.03em] text-white`}>
              {resumen?.titulo ?? "Calculando…"}
            </h1>
            {resumen?.frase && <p className="m-0 mt-4 max-w-[576px] text-lg leading-[1.4] tracking-[-0.02em] text-white/65">{resumen.frase}</p>}
            {resumen?.nota && <p className="m-0 mt-2 max-w-[576px] text-sm leading-[1.4] tracking-[-0.02em] text-white/50">{resumen.nota}</p>}

            {estimacionCargando && !estimacion
              ? <p className="m-0 mt-9 text-sm text-white/55">Calculando la regeneración…</p>
              : progresoRebrote !== null
                ? <>
                  <div className="mt-9 flex items-baseline gap-3.5">
                    <span className="text-[56px] leading-[74px] font-medium tracking-[-0.03em] text-verde-accion tabular-nums">{Math.round(progresoRebrote * 100)}%</span>
                    <span className="text-lg leading-6 font-medium tracking-[-0.02em] text-white/70">regenerado</span>
                  </div>
                  <div className="mt-3.5"><BloquesRegeneracion progreso={progresoRebrote} condicion={resumen?.condicion ?? null} /></div>
                </>
                // Sin estimación no se dibujan bloques: diez fichas vacías se leerían como "recién pastoreado".
                : <p className="m-0 mt-9 max-w-[576px] text-sm leading-[1.4] text-white/55">Regeneración sin datos. {motivoRegeneracion}</p>}

            <p className="m-0 mt-4 text-sm leading-[19px] tracking-[-0.02em] text-white/55">{lineaUso.join(" · ")}</p>
            {ultimaActualizacion && <p className="m-0 mt-1 text-xs leading-4 text-white/40">Datos actualizados el {timestamp(ultimaActualizacion)}</p>}
          </section>

          <MiniaturaLote key={lote.id} poligono={lote.polygon} className="aspect-[560/423] w-full shrink-0 rounded-[20px] lg:w-[560px]" />
        </div>
      </div>
    </header>

    <main className="mx-auto flex max-w-[1280px] flex-col pb-28">
      {/* ───────────── Cómo está el pasto ───────────── */}
      <section className="flex flex-col gap-6 px-6 pt-14 pb-6 md:px-12" aria-labelledby="titulo-pasto">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className={`${VOLANTA} text-[13px] leading-[17px]`}>Lo que vio el satélite{fechaVolantaSatelite ? ` · ${fechaVolantaSatelite}` : ""}</p>
            <h2 id="titulo-pasto" className="m-0 text-4xl leading-[48px] font-medium tracking-[-0.03em] text-landing-oscuro">¿Cómo está el pasto?</h2>
          </div>
          {puede("actualizar_satelite") && <button type="button" className={PILDORA} onClick={actualizarSatelite} disabled={ocupado !== null}>{ocupado === "satelite" ? "Actualizando..." : "Actualizar satélite"}</button>}
        </div>

        {/* Óptica (Sentinel-2) y radar (Sentinel-1) van lado a lado pero no se combinan: son físicas distintas. */}
        <div className="flex flex-wrap gap-3.5">
          <TarjetaIndice nombre="Verdor" sigla="NDVI" stats={optico?.ndvi ?? null} rango={[-1, 1]} extremos={["Seco", "Verde"]} />
          <TarjetaIndice nombre="Humedad de la planta" sigla="NDMI" stats={optico?.ndmi ?? null} rango={[-1, 1]} extremos={["Seca", "Húmeda"]} />
          <TarjetaIndice nombre="Agua en la superficie" sigla="NDWI" stats={optico?.ndwi ?? null} rango={[-1, 1]} extremos={["Sin agua", "Agua"]} />
          <TarjetaIndice nombre="Vigor" sigla="EVI" stats={optico?.evi ?? null} rango={[-1, 1]} extremos={["Bajo", "Alto"]} />
          {/* La fecha del radar va en la volanta de la sección, junto a la de la óptica. */}
          <TarjetaIndice nombre="Biomasa (radar)" sigla="RVI" stats={radar?.rvi ?? null} rango={[0, 1]} extremos={["Poca", "Mucha"]} />
        </div>

        {optico && <div className="flex flex-wrap items-center gap-2 text-sm text-landing-oscuro/80">
          {(() => { const porcentaje = porcentajeInundado(optico.fraccionInundada); return <span className="font-medium">Lote inundado: {porcentaje === null ? "sin datos" : `${porcentaje} %`}</span>; })()}
          <span className="rounded-full bg-crema/60 px-2 py-0.5 text-[0.68rem] font-bold tracking-wide text-landing-tinta uppercase">Experimental</span>
          <AvisoInfo titulo="Índice de inundación experimental">
            <p className="m-0 mb-1">
              {porcentajeInundado(optico.fraccionInundada) === null
                ? "Esta imagen no tiene el índice de inundación: las observaciones anteriores al 04/11/2026 no se recalculan."
                : `Porcentaje de los píxeles despejados de la imagen del ${fecha(optico.observedAt)} con NDWI1 = (B04 − B11) / (B04 + B11) por encima de −0,2.`}
            </p>
            <p className="m-0 mb-1">Fuente: Durante y Di Bella (2020), Herramienta MODIS para evaluar patrones de inundación en el delta del Paraná, RIA. Por encima de −0,2, el píxel tiene más de 60 % de agua.</p>
            <p className="m-0 mb-1">Se calibró con MODIS en un humedal, no en pasturas: se está probando acá.</p>
            <p className="m-0">Detecta agua en superficie, no suelo saturado sin agua visible: eso lo sigue cubriendo la categoría de lluvia "piso pesado".</p>
          </AvisoInfo>
          <span className={TINTA_APAGADA}>· se vio despejado el {Math.round((optico.coberturaValida ?? 0) * 100)} % del lote</span>
        </div>}

        <div className={`${TARJETA} flex flex-col gap-4 p-6`}>
          <GraficoVerdor mediciones={mediciones} />
        </div>
      </section>

      {/* ───────────── Clima y descanso ───────────── */}
      <section className="flex flex-col gap-3.5 px-6 py-6 md:flex-row md:px-12" aria-label="Clima y descanso">
        <article className={`${TARJETA} flex min-w-0 flex-1 flex-col items-start gap-[18px] p-6`}>
          <div className="flex w-full items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <p className={`${VOLANTA} text-xs leading-4`}>Pronóstico</p>
              <h2 className="m-0 text-[26px] leading-[35px] font-medium tracking-[-0.03em] text-landing-oscuro">¿Va a llover?</h2>
            </div>
            {puede("actualizar_clima") && <button type="button" className={PILDORA} onClick={actualizarClima} disabled={ocupado !== null}>{ocupado === "clima" ? "Actualizando..." : "Actualizar clima"}</button>}
          </div>
          {estado.clima ? <>
            <div className="flex w-full flex-wrap gap-y-3">
              <DatoClima valor={esNumero(estado.clima.lluviaUltimos7Dias) ? `${coma(estado.clima.lluviaUltimos7Dias, 1)} mm` : "Sin datos"} rotulo="Últimos 7 días" />
              <DatoClima valor={esNumero(estado.clima.lluviaProximosDias) ? `${coma(estado.clima.lluviaProximosDias, 1)} mm` : "Sin datos"} rotulo="Próximos días" />
              <DatoClima
                valor={estado.clima.hoy && esNumero(estado.clima.hoy.lluviaMm) ? `${coma(estado.clima.hoy.lluviaMm, 1)} mm` : "Sin datos"}
                rotulo={estado.clima.hoy && esNumero(estado.clima.hoy.tempMin) && esNumero(estado.clima.hoy.tempMax) ? `Hoy · ${Math.round(estado.clima.hoy.tempMin)} a ${Math.round(estado.clima.hoy.tempMax)} °C` : "Hoy"}
              />
            </div>
            {categoriaLluvia && ETIQUETA_LLUVIA[categoriaLluvia] && <p className="m-0 text-sm leading-[19px] tracking-[-0.02em] text-landing-oscuro/70">
              {ETIQUETA_LLUVIA[categoriaLluvia]}: {EXPLICACION_LLUVIA[categoriaLluvia].charAt(0).toLowerCase()}{EXPLICACION_LLUVIA[categoriaLluvia].slice(1)}
            </p>}
            <TablaDiasClima dias={estado.clima.dias} hoy={hoyIso} />
            <p className={`m-0 text-xs ${TINTA_APAGADA}`}>Última consulta: {timestamp(estado.clima.consultedAt)}</p>
          </> : <p className={`m-0 text-sm ${TINTA_APAGADA}`}>Todavía no se consultó el clima de este lote.</p>}
        </article>

        <article className={`${TARJETA} flex min-w-0 flex-1 flex-col items-start gap-[18px] p-6`}>
          <div className="flex flex-col gap-1.5">
            <p className={`${VOLANTA} text-xs leading-4`}>Registro de campo</p>
            <h2 className="m-0 text-[26px] leading-[35px] font-medium tracking-[-0.03em] text-landing-oscuro">¿Cuándo se usó?</h2>
          </div>
          <div className="flex flex-col gap-1">
            <strong className="text-[22px] leading-[29px] font-medium tracking-[-0.03em] text-landing-oscuro">
              {ultimoUso?.enCurso ? "Hay animales en el lote" : ultimoUso ? `Último uso: ${fecha(ultimoUso.fechaFin)}` : "Sin pastoreos registrados"}
            </strong>
            <span className="text-sm leading-[19px] tracking-[-0.02em] text-landing-oscuro/60">
              {ultimoUso?.enCurso
                ? `Entraron el ${fecha(ultimoUso.fecha)}.`
                : ultimoUso
                  ? estado.uso.diasDescanso !== null ? `Lleva ${plural(estado.uso.diasDescanso, "día", "días")} de descanso.` : "Sin datos de descanso."
                  : "Cargá el último uso para calcular el descanso."}
            </span>
          </div>
          {puede("registrar_usos") && !ultimoUso?.enCurso && <button type="button" className={BOTON_VERDE} onClick={() => setPedidosRegistrarUso((n) => n + 1)}>Registrar uso</button>}
        </article>
      </section>

      {/* ───────────── Manejo del lote ─────────────
          No están en el frame, pero son la carga de datos del lote: jornadas,
          estimación de forraje, pastura y mediciones. */}
      <section className="flex flex-col gap-3.5 px-6 py-6 md:px-12" aria-label="Manejo del lote">
        <JornadaPastoreoPanel
          key={`jornada-${pedidosRegistrarUso}`}
          loteId={lote.id}
          ultimoUso={estado.uso.ultimoUso}
          diasDescanso={estado.uso.diasDescanso}
          onCambio={cargarDatos}
          enfocarPastoreoTerminado={enfocarPastoreo || pedidosRegistrarUso > 0}
        />
        <EstimacionForrajePanel lote={lote} estimacion={estimacion} cargando={estimacionCargando} error={errorEstimacion} />
        <PasturaPanel lote={lote} onGuardado={setLote} />
        <MedicionesAlturaPanel loteId={lote.id} refresco={estado} onCambio={cargarDatos} />
      </section>

      {/* ───────────── Historial ───────────── */}
      <section className="px-6 py-6 md:px-12" aria-labelledby="titulo-historial">
        <div className={`${TARJETA} flex flex-col gap-5 p-6`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="titulo-historial" className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.02em] text-landing-tinta">Historial</h2>
            <div className="flex gap-0.5 rounded-full bg-landing-tinta/5 p-1" role="tablist" aria-label="Fuente de datos">
              {([["satelite", "Satélite"], ["clima", "Clima"], ["uso", "Usos"]] as const).map(([valor, etiqueta]) => (
                <button key={valor} type="button" role="tab" aria-selected={tab === valor} onClick={() => setTab(valor)}
                  className={`foco-campo cursor-pointer rounded-full border-0 px-3.5 py-[7px] text-sm leading-[18px] font-medium tracking-[-0.03em] transition-colors ${tab === valor ? "bg-verde-accion text-landing-tinta" : "bg-transparent text-gris-rotulo hover:text-landing-tinta"}`}>
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>

          {tab === "satelite" && <>
            {mediciones.length === 0 ? <p className={`m-0 text-sm ${TINTA_APAGADA}`}>Todavía no hay observaciones satelitales guardadas.</p> : <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead><tr>{["Fecha", "Fuente", "NDVI", "RVI", "NDMI", "Cobertura", "Inundado (exp.)"].map((titulo) => <th key={titulo} className={CELDA_ENCABEZADO}>{titulo}</th>)}</tr></thead>
                <tbody>{mediciones.map((item) => {
                  const esOptica = item.fuente === "sentinel-2";
                  const inundado = esOptica ? porcentajeInundado(item.fraccionInundada) : null;
                  return <tr key={item.id}>
                    <td className={CELDA}>{fecha(item.observedAt)}</td>
                    <td className={CELDA}>{esOptica ? "Sentinel-2" : item.fuente === "sentinel-1" ? "Sentinel-1" : item.fuente}</td>
                    <td className={CELDA}>{esOptica ? indice(item.ndvi.mediana) : "—"}</td>
                    <td className={CELDA}>{item.fuente === "sentinel-1" ? indice(item.rvi.mediana) : "—"}</td>
                    <td className={CELDA}>{esOptica ? indice(item.ndmi.mediana) : "—"}</td>
                    <td className={CELDA}>{esOptica ? numero(item.coberturaValida, 2) : "—"}</td>
                    <td className={CELDA}>{esOptica ? (inundado === null ? "Sin datos" : `${inundado} %`) : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
            <Paginador paginacion={paginaciones.satelite} onAnterior={() => setPaginas((actual) => ({ ...actual, satelite: Math.max(0, actual.satelite - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, satelite: actual.satelite + 1 }))} />
          </>}

          {tab === "clima" && <>
            {climas.length === 0 ? <p className={`m-0 text-sm ${TINTA_APAGADA}`}>Todavía no hay consultas de clima guardadas.</p> : <div>{climas.map((item) => <details key={item.id} className="border-b border-landing-tinta/7 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-landing-tinta">{timestamp(item.consultedAt)} · {item.origen === "automatico" ? "automática" : "a pedido"} · {numero(item.lluviaUltimos7Dias, 1)} mm últimos 7 días · {item.categoria ? ETIQUETA_LLUVIA[item.categoria as CategoriaLluvia] ?? item.categoria : "Sin datos"}</summary>
              <ul className={`mb-0 text-sm ${TINTA_APAGADA}`}>{item.dias.map((dia) => <li key={`${item.id}-${dia.fecha}`}>{fecha(dia.fecha)} · {numero(dia.lluviaMm, 1)} mm · {numero(dia.tempMin, 0)}–{numero(dia.tempMax, 0)} °C · radiación {numero(dia.radiacionMjM2, 1)} · ET₀ {numero(dia.evapotranspiracionMm, 1)} · {dia.esPronostico ? "pronóstico" : "observado"}</li>)}</ul>
            </details>)}</div>}
            <Paginador paginacion={paginaciones.clima} onAnterior={() => setPaginas((actual) => ({ ...actual, clima: Math.max(0, actual.clima - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, clima: actual.clima + 1 }))} />
          </>}

          {tab === "uso" && <>
            {usos.length === 0 ? <p className={`m-0 text-sm ${TINTA_APAGADA}`}>Sin usos registrados.</p> : <ul className="m-0 list-none p-0">{usos.map((uso) => <li key={uso.id} className="flex flex-col justify-between gap-1 border-b border-landing-tinta/7 px-4 py-3 text-sm md:flex-row md:items-center md:gap-3">
              <strong className="font-medium whitespace-nowrap text-landing-tinta">{fecha(uso.fecha)}</strong><span className={`flex-1 ${TINTA_APAGADA}`}>{describirUso(uso)}</span>
              {puede('modificar_usos') && <div className="flex gap-2">
                <button type="button" className={PILDORA} disabled={ocupado !== null} onClick={() => setEditarUso(uso)}>Editar</button>
                <button type="button" className={`${PILDORA} border-red-200 text-red-700 hover:bg-red-50`} disabled={ocupado !== null} onClick={() => setBorrarUso(uso)}>Borrar</button>
              </div>}
            </li>)}</ul>}
            <Paginador paginacion={paginaciones.uso} onAnterior={() => setPaginas((actual) => ({ ...actual, uso: Math.max(0, actual.uso - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, uso: actual.uso + 1 }))} />
          </>}
        </div>
      </section>
    </main>

    {editarUso?.ingresoAt && <EditarJornadaModal loteId={id} uso={editarUso} onCancelar={() => setEditarUso(null)} onGuardado={() => { setEditarUso(null); void cargarDatos(); }} />}
    {editarUso && !editarUso.ingresoAt && <PromptModal title="Editar fecha de uso" label="Fecha" initialValue={editarUso.fecha} onCancel={() => setEditarUso(null)} onConfirm={async valor => { if (ocupado) return; setOcupado('uso'); try { await modificarUsoLote(establecimientoId, id, editarUso.id, valor); setEditarUso(null); await cargarDatos(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); } }} />}
    {borrarUso && <ConfirmModal title={borrarUso.ingresoAt ? "Borrar jornada de pastoreo" : "Borrar uso"} message={mensajeBorrarUso(borrarUso)} confirmText="Borrar" onCancel={() => setBorrarUso(null)} onConfirm={async () => { if (ocupado) return; setOcupado('uso'); try { await eliminarUsoLote(establecimientoId, id, borrarUso.id); setBorrarUso(null); await cargarDatos(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); } }} />}
  </div>;
}
