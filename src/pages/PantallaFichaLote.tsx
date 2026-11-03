import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
import { modificarUsoLote, eliminarUsoLote } from '../api/historial';
import PromptModal from '../components/PromptModal';
import ConfirmModal from '../components/ConfirmModal';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { actualizarSateliteLote } from "../copernicus/api";
import { COLOR_CATEGORIA, COLOR_SIN_DATOS, ETIQUETA_CATEGORIA } from "../copernicus/presentacion";
import { obtenerEstimacionForraje, type EstimacionForraje } from "../api/estimacion";
import { progresoRegeneracion } from "../estimacion/presentacion";
import { BarraRebrote } from "../components/OrdenPastoreoPanel";
import { ETIQUETA_LLUVIA } from "../clima/interpretacion";
import { actualizarClimaLote } from "../clima/api";
import { obtenerLotes } from "../api/rodeo";
import { actualizarPendientes } from "../api/establecimientos";
import { ApiError } from "../api/client";
import { obtenerConsultasClima, obtenerEstadoLote, obtenerMedicionesSatelitales, obtenerUsosLote, type ConsultaClimaHistorial, type EstadoLoteApi, type MedicionSatelital, type PaginacionHistorial, type UsoLote } from "../api/historial";
import type { Lote } from "../types";
import type { DiaClima } from "../clima/types";
import AvisoInfo from "../components/ui/AvisoInfo";
import Button from "../components/ui/Button";
import SimulacionPastoreoPanel from "../components/SimulacionPastoreoPanel";
import PasturaPanel from "../components/PasturaPanel";
import EstimacionForrajePanel from "../components/EstimacionForrajePanel";
import JornadaPastoreoPanel, { EditarJornadaModal, describirUso, mensajeBorrarUso } from "../components/JornadaPastoreoPanel";
import MedicionesAlturaPanel from "../components/MedicionesAlturaPanel";
import PantallaDatos, { EstadoDePantalla, TARJETA, APAGADO, PASTILLA_CLARA, PASTILLA_VERDE } from "../components/ui/PantallaDatos";
import { useLoteConGanado } from "../demo/ganadoSimulado";

type Tab = "satelite" | "clima" | "uso";
const PAGE_SIZE = 20;

const CARD = TARJETA;
const MUTED = APAGADO;
/** Título de sección y subtítulo de tarjeta: antes iban en azul de marca. */
const SECTION_TITLE = "m-0 text-[1.3rem] font-semibold text-gray-900";
const SUBTITULO = "m-0 text-base font-semibold text-gray-900";
/** Tarjeta interior (índices, columnas Sentinel) sobre el vidrio de la sección. */
const TARJETA_INTERIOR = "rounded-2xl border border-gray-200/80 bg-white p-[18px]";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

/** Días entre dos fechas ISO, para decir en cuántos días cambió el NDVI. */
function diasEntreIso(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = hasta.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function numero(valor: number | null | undefined, decimales = 2): string {
  return typeof valor === "number" && Number.isFinite(valor) ? valor.toFixed(decimales) : "Sin datos";
}

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function proximaOptica(observedAt: string): string {
  const [anio, mes, dia] = observedAt.split("-").map(Number);
  const estimada = new Date(Date.UTC(anio, mes - 1, dia + 5));
  return fecha(estimada.toISOString().slice(0, 10));
}

function mensajeError(error: unknown): string {
  if (error instanceof ApiError && error.code === "LOT_NOT_FOUND") return "Lote no encontrado";
  if (error instanceof ApiError) return error.message;
  return "No se pudo cargar la ficha. Intentá nuevamente.";
}

/** La categoría viaja como `string` suelta desde la API; sin categoría, no hay dato que mostrar. */
function etiquetaVerdor(categoria: string | null | undefined): string {
  if (!categoria) return "Sin datos";
  return ETIQUETA_CATEGORIA[categoria as keyof typeof ETIQUETA_CATEGORIA] ?? "Sin datos";
}

/** El color del puntaje sale de la categoría que calcula el backend, no de un umbral de acá. */
function colorCategoria(categoria: string | null | undefined): string {
  if (!categoria) return COLOR_SIN_DATOS;
  return COLOR_CATEGORIA[categoria as keyof typeof COLOR_CATEGORIA] ?? COLOR_SIN_DATOS;
}

function StatCard({ label, value, detail, aviso }: { label: string; value: string; detail?: string; aviso?: ReactNode }) {
  return <article className={`${CARD} p-4`}>
    <span className="flex items-center gap-1.5 text-[0.78rem] text-gray-500">{label}{aviso}</span>
    <strong className="mt-2 mb-1 block text-[1.8rem] leading-none font-semibold text-gray-900">{value}</strong>
    {detail && <small className="block text-[0.75rem] text-gray-400">{detail}</small>}
  </article>;
}

type Estadisticas = { media: number | null; mediana: number | null; min: number | null; max: number | null; desvio: number | null };

/**
 * Qué mide cada sigla, en una línea. Son índices estándar de teledetección: el
 * productor no tiene por qué conocerlos y antes aparecían sin ninguna
 * explicación.
 */
const QUE_MIDE: Record<string, string> = {
  NDVI: "Cuán verde y densa está la vegetación. Es el más usado para ver cómo viene el pasto.",
  NDMI: "Cuánta humedad tiene la vegetación.",
  NDWI: "Presencia de agua en superficie. Sirve para detectar anegamientos.",
  EVI: "Parecido al NDVI, pero aguanta mejor la vegetación muy densa.",
  RVI: "Cuánta vegetación ve el radar. El radar atraviesa las nubes, pero no se compara con los otros.",
};

/**
 * La mediana grande, que es la que se usa, y debajo el resto de la estadística
 * de la misma imagen. Antes estaba escondida en un desplegable "Ver
 * estadísticas": el diseño nuevo la deja a la vista.
 */
function Indice({ nombre, stats }: { nombre: string; stats: Estadisticas }) {
  return <div className="rounded-2xl bg-gray-50 px-3.5 py-3">
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-1 text-[0.82rem] text-gray-500">
        {nombre}
        {QUE_MIDE[nombre] && <AvisoInfo tono="info" titulo={`Qué mide el ${nombre}`}>{QUE_MIDE[nombre]}</AvisoInfo>}
      </span>
      <strong className="text-[1.25rem] leading-none font-semibold text-gray-900 tabular-nums">{numero(stats.mediana)}</strong>
    </div>
    <dl className="m-0 mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.76rem] tabular-nums">
      {([["Media", stats.media], ["Mín.", stats.min], ["Máx.", stats.max], ["Desvío", stats.desvio]] as const).map(([rotulo, valor]) => (
        <div key={rotulo} className="flex items-baseline justify-between gap-2">
          <dt className="text-gray-400">{rotulo}</dt>
          <dd className="m-0 text-gray-700">{numero(valor)}</dd>
        </div>
      ))}
    </dl>
  </div>;
}

/**
 * La curva del NDVI, chica: lo que se lee de un vistazo es de cuánto a cuánto
 * fue y en cuántos días. Las fechas del medio quedan en el globo de cada punto
 * y en el Historial, que las tiene todas con su cobertura.
 */
function GraficoNdvi({ mediciones }: { mediciones: MedicionSatelital[] }) {
  const puntos = mediciones.filter((item) => item.fuente === "sentinel-2" && item.ndvi.mediana !== null).slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (puntos.length === 0) return <p className={MUTED}>Sin historial suficiente.</p>;
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const dias = Math.abs(diasEntreIso(primero.observedAt, ultimo.observedAt));
  const ancho = 680;
  const alto = 150;
  const margen = 14;
  const anchoGrafico = ancho - margen * 2;
  const altoGrafico = alto - margen * 2;
  // La escala se ajusta a lo observado, con un respiro arriba y abajo: una
  // escala fija de −1 a 1 aplastaba la curva contra el medio.
  const valores = puntos.map((punto) => punto.ndvi.mediana as number);
  const piso = Math.min(...valores);
  const techo = Math.max(...valores);
  const respiro = Math.max(0.05, (techo - piso) * 0.35);
  const minimo = piso - respiro;
  const maximo = techo + respiro;
  const x = (index: number) => margen + (puntos.length === 1 ? anchoGrafico / 2 : (index / (puntos.length - 1)) * anchoGrafico);
  const y = (valor: number) => margen + ((maximo - valor) / (maximo - minimo)) * altoGrafico;
  const linea = puntos.map((punto, index) => `${x(index)},${y(punto.ndvi.mediana as number)}`).join(" ");
  const area = `${margen},${alto - margen} ${linea} ${x(puntos.length - 1)},${alto - margen}`;

  return <>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className={SUBTITULO}>Evolución NDVI</h3>
      <p className="m-0 text-[0.85rem] text-gray-500 tabular-nums">
        <span className="font-semibold text-gray-900">{numero(primero.ndvi.mediana)} → {numero(ultimo.ndvi.mediana)}</span>
        {dias > 0 && <span className="ml-2">últimos {dias} días</span>}
      </p>
    </div>
    <svg className="mt-2 block h-[150px] w-full" viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" role="img" aria-label={`Evolución del NDVI: de ${numero(primero.ndvi.mediana)} el ${fecha(primero.observedAt)} a ${numero(ultimo.ndvi.mediana)} el ${fecha(ultimo.observedAt)}`}>
      {[0.25, 0.5, 0.75].map((parte) => <line key={parte} x1={margen} x2={ancho - margen} y1={margen + parte * altoGrafico} y2={margen + parte * altoGrafico} stroke="#e5e7eb" strokeDasharray="4 6" />)}
      {puntos.length > 1 && <polygon points={area} fill="#79da58" fillOpacity="0.14" />}
      {puntos.length > 1 && <polyline points={linea} fill="none" stroke="#2f855a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
      {puntos.map((punto, index) => <circle
        key={`${punto.id}-${punto.observedAt}`}
        cx={x(index)} cy={y(punto.ndvi.mediana as number)}
        r={index === 0 || index === puntos.length - 1 ? 5 : 3}
        fill="#2f855a"
        opacity={index === 0 || index === puntos.length - 1 ? 1 : 0.45}
      ><title>{fecha(punto.observedAt)} · NDVI {numero(punto.ndvi.mediana)}</title></circle>)}
    </svg>
    <div className="flex items-baseline justify-between gap-2 text-[0.78rem] text-gray-400 tabular-nums">
      <span>{fecha(primero.observedAt)} · {numero(primero.ndvi.mediana)}</span>
      {puntos.length > 1 && <span>{fecha(ultimo.observedAt)} · {numero(ultimo.ndvi.mediana)}</span>}
    </div>
  </>;
}

const CELDA_ENCABEZADO = "bg-gray-50 px-[9px] py-[11px] text-left text-[0.74rem] font-semibold tracking-[0.04em] whitespace-nowrap text-gray-500 uppercase";
const CELDA = "border-b border-gray-200 px-[9px] py-[9px] whitespace-nowrap tabular-nums";

function Medida({ valor, decimales }: { valor: number | null; decimales: number }) {
  return valor === null ? <span className="text-[0.78rem] text-gray-400">sin datos</span> : <>{valor.toFixed(decimales)}</>;
}

/** Serie diaria de la última consulta: lo pasado según Open-Meteo y el pronóstico, sin mezclarlos. */
function TablaDiasClima({ dias, hoy }: { dias: DiaClima[]; hoy: string }) {
  if (dias.length === 0) return <p className={MUTED}>La última consulta no guardó días.</p>;
  return <details className="mt-[14px] overflow-x-auto rounded-2xl border border-gray-200 bg-white p-4">
    <summary className="cursor-pointer font-semibold text-gray-900">Ver día por día <span className="font-normal text-gray-500">· hasta el {fecha(dias[dias.length - 1].fecha)}</span></summary>
    <p className="m-0 mt-2 flex items-center gap-2 text-[0.8rem] text-gray-500">
      Últimos 7 días y pronóstico
      <AvisoInfo tono="info" titulo="Día por día">
        <p className="m-0 mb-1">El pronóstico es una estimación, no una medición: los días marcados como pronóstico todavía no pasaron.</p>
        <p className="m-0 mb-1"><b>Radiación</b>: cuánto sol recibió el lote ese día. Más sol, más crecimiento, si hay agua.</p>
        <p className="m-0"><b>ET₀</b>: cuánta agua se evapora en un día en un pasto de referencia. Es una medida estándar del clima, no el consumo del pasto de este lote.</p>
      </AvisoInfo>
    </p>
    <table className="mt-2 w-full border-collapse text-[0.88rem]">
      <thead><tr>
        <th className={CELDA_ENCABEZADO}>Fecha</th>
        <th className={CELDA_ENCABEZADO}>Tipo</th>
        <th className={CELDA_ENCABEZADO}>Lluvia (mm)</th>
        <th className={CELDA_ENCABEZADO}>Temp. mín.–máx. (°C)</th>
        <th className={CELDA_ENCABEZADO}>Radiación (MJ/m²)</th>
        <th className={CELDA_ENCABEZADO}>ET₀ (mm)</th>
      </tr></thead>
      <tbody>{dias.map((dia) => <tr key={dia.fecha} className={dia.fecha === hoy ? "bg-[var(--color-lima)]/20 font-semibold" : dia.esPronostico ? "text-gray-600" : undefined}>
        <td className={CELDA}>{fecha(dia.fecha)}{dia.fecha === hoy && " · hoy"}</td>
        <td className={CELDA}>{dia.esPronostico ? "pronóstico" : "observado"}</td>
        <td className={CELDA}><Medida valor={dia.lluviaMm} decimales={1} /></td>
        <td className={CELDA}><Medida valor={dia.tempMin} decimales={0} />–<Medida valor={dia.tempMax} decimales={0} /></td>
        <td className={CELDA}><Medida valor={dia.radiacionMjM2} decimales={1} /></td>
        <td className={CELDA}><Medida valor={dia.evapotranspiracionMm} decimales={1} /></td>
      </tr>)}</tbody>
    </table>
  </details>;
}

function Paginador({ paginacion, onAnterior, onSiguiente }: { paginacion: PaginacionHistorial | null; onAnterior: () => void; onSiguiente: () => void }) {
  if (!paginacion || paginacion.total <= PAGE_SIZE) return null;
  return <div className="mt-4 flex items-center justify-center gap-3.5 text-[0.9rem] text-gray-500"><Button variant="secondary" onClick={onAnterior} disabled={paginacion.offset === 0}>Anterior</Button><span>{paginacion.offset + 1}–{Math.min(paginacion.offset + PAGE_SIZE, paginacion.total)} de {paginacion.total}</span><Button variant="secondary" onClick={onSiguiente} disabled={!paginacion.hayMas}>Siguiente</Button></div>;
}

export default function PantallaFichaLote() {
  const { establecimientoId, puede } = useEstablecimiento();
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
  // La estimación la pide la ficha y no el panel: también la usa la barra de
  // regeneración de arriba, y así el lote se calcula una sola vez por visita.
  const [estimacion, setEstimacion] = useState<EstimacionForraje | null>(null);
  const [estimacionCargando, setEstimacionCargando] = useState(true);
  const [errorEstimacion, setErrorEstimacion] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"satelite" | "clima" | "uso" | null>(null);
  // Sólo se ofrece la demo mientras el GPS simulado está parado en ESTE lote.
  const ganadoDentro = useLoteConGanado() === id;
  // Desde el orden de pastoreo se llega con ?cargar=pastoreo. Se lee una vez y
  // se saca de la URL, para que recargar la ficha no vuelva a mover la vista.
  const [searchParams, setSearchParams] = useSearchParams();
  const [enfocarPastoreo] = useState(() => searchParams.get("cargar") === "pastoreo");
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

  const ndvi = estado?.satelite.optico?.ndvi.mediana;
  const proxima = estado?.satelite.optico ? proximaOptica(estado.satelite.optico.observedAt) : null;
  const progresoRebrote = progresoRegeneracion(estimacion?.reingreso, undefined);
  const motivoRegeneracion = errorEstimacion
    ?? estimacion?.mensaje
    ?? estimacion?.reingreso?.mensaje
    ?? "Hace falta el tipo de pastura, el clima y el último pastoreo para contar el rebrote.";
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

  return <PantallaDatos
    titulo={`Lote ${estado.lote.numero}`}
    subtitulo={estado.lote.apodo || "Sin apodo"}
    encabezadoExtra={<>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold ${estado.lote.activo ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-500"}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${estado.lote.activo ? "bg-green-600" : "bg-gray-400"}`} />
          {estado.lote.activo ? "Activo" : "Inactivo"}
        </span>
        {ultimaActualizacion && <span className="text-[0.82rem] text-gray-500">Última actualización: {timestamp(ultimaActualizacion)}</span>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</div>}
    </>}
  >
    <section className={`${CARD} p-4 md:p-[22px]`}>
      <h2 className={SECTION_TITLE}>Regeneración del lote</h2>
      {/* Sin estimación no se dibuja una barra en 0 %: un cero se leería como
          "recién pastoreado", que no es lo mismo que no saber. */}
      {estimacionCargando && !estimacion
        ? <p className={`${MUTED} mt-2`}>Calculando…</p>
        : progresoRebrote !== null
          ? <BarraRebrote progreso={progresoRebrote} rotulo="Regeneración" />
          : <p className={`${MUTED} mt-2`}>Sin datos. {motivoRegeneracion}</p>}
    </section>

    <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
    <section className={`${CARD} p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <h2 className={SECTION_TITLE}>Condición satelital</h2>
        {puede("actualizar_satelite") && <button type="button" className={PASTILLA_CLARA} onClick={actualizarSatelite} disabled={ocupado !== null}>{ocupado === "satelite" ? "Actualizando..." : "Actualizar satélite"}</button>}
      </div>
      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
        <article className={TARJETA_INTERIOR}>
          <div className="flex items-center gap-2">
            <h3 className={`${SUBTITULO}`}>Sentinel-2 · Óptico</h3>
            {estado.satelite.optico && <AvisoInfo tono="info" titulo="Imagen óptica">
              Se vio despejado el {Math.round((estado.satelite.optico.coberturaValida ?? 0) * 100)} % del lote. El puntaje es provisional: no está calibrado agronómicamente. Próxima pasada estimada: {proxima}.
            </AvisoInfo>}
          </div>
          {estado.satelite.optico ? <>
            <p className={MUTED}>Observado {fecha(estado.satelite.optico.observedAt)} · hace {estado.satelite.optico.diasDesdeObservacion} días · cobertura {numero(estado.satelite.optico.coberturaValida)}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Indice nombre="NDVI" stats={estado.satelite.optico.ndvi} />
              <Indice nombre="NDMI" stats={estado.satelite.optico.ndmi} />
              <Indice nombre="NDWI" stats={estado.satelite.optico.ndwi} />
              <Indice nombre="EVI" stats={estado.satelite.optico.evi} />
            </div>
            {estado.satelite.optico.puntaje !== null && <p className="m-0 mt-3 flex items-center gap-2 text-[0.88rem] font-semibold text-gray-900">
              <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: colorCategoria(estado.satelite.optico.categoria) }} />
              Puntaje provisional {estado.satelite.optico.puntaje}/100{estado.satelite.optico.categoria ? ` · condición ${etiquetaVerdor(estado.satelite.optico.categoria).toLowerCase()}` : ""}
            </p>}
            {proxima && <p className={`${MUTED} mt-2`}>Próxima pasada óptica estimada: {proxima}. Puede haber una nueva pasada disponible.</p>}
          </> : <p className={MUTED}>Sin datos ópticos.</p>}
        </article>
        <article className={TARJETA_INTERIOR}>
          <div className="flex items-center gap-2">
            <h3 className={`${SUBTITULO}`}>Sentinel-1 · Radar</h3>
            <AvisoInfo tono="info" titulo="Radar">El radar atraviesa las nubes, así que ve el lote en días que la óptica pierde.</AvisoInfo>
          </div>
          {estado.satelite.radar ? <>
            <p className={MUTED}>Observado {fecha(estado.satelite.radar.observedAt)} · hace {estado.satelite.radar.diasDesdeObservacion} días</p>
            <div className="mt-3"><Indice nombre="RVI" stats={estado.satelite.radar.rvi} /></div>
          </> : <p className={MUTED}>Sin datos de radar.</p>}
          <p className={`${MUTED} mt-3`}>Radar y óptica son fuentes distintas y no se combinan.</p>
        </article>
      </div>
      <div className="mt-[14px] rounded-2xl border border-gray-200 bg-white p-4">
        <GraficoNdvi mediciones={mediciones} />
      </div>
    </section>

    <aside className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1" aria-label="Resumen del lote">
      {/* Las siglas van tal cual, con el círculo "i" que dice qué mide cada una. */}
      <StatCard
        label="NDVI"
        value={numero(ndvi)}
        detail={estado.satelite.optico ? fecha(estado.satelite.optico.observedAt) : undefined}
        aviso={<AvisoInfo tono="info" titulo="Qué mide el NDVI">{QUE_MIDE.NDVI}</AvisoInfo>}
      />
      <StatCard
        label="NDMI"
        value={numero(estado.satelite.optico?.ndmi.mediana)}
        detail={estado.satelite.optico ? `hace ${estado.satelite.optico.diasDesdeObservacion} días` : undefined}
        aviso={<AvisoInfo tono="info" titulo="Qué mide el NDMI">{QUE_MIDE.NDMI}</AvisoInfo>}
      />
      <StatCard label="Descanso" value={estado.uso.ultimoUso?.enCurso ? "Con animales" : estado.uso.diasDescanso === null ? "Sin datos" : `${estado.uso.diasDescanso} días`} />
      <StatCard label="Lluvia últimos 7 días" value={estado.clima ? `${numero(estado.clima.lluviaUltimos7Dias, 1)} mm` : "Sin datos"} />
      <StatCard label="Último uso" value={estado.uso.ultimoUso ? fecha(estado.uso.ultimoUso.fechaFin) : "Sin datos"} detail={estado.uso.ultimoUso?.enCurso ? "jornada abierta" : undefined} />
    </aside>
    </div>

    <section className={`${CARD} p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <h2 className={SECTION_TITLE}>Clima</h2>
        {puede("actualizar_clima") && <button type="button" className={PASTILLA_CLARA} onClick={actualizarClima} disabled={ocupado !== null}>{ocupado === "clima" ? "Actualizando..." : "Actualizar clima"}</button>}
      </div>
      {/* Radiación y ET₀ de hoy se ven en "Ver día por día", que las trae con su serie. */}
      {estado.clima ? <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 md:grid-cols-4">
        <StatCard label="Lluvia últimos 7 días" value={`${numero(estado.clima.lluviaUltimos7Dias, 1)} mm`} />
        <StatCard label="Lluvia próximos días" value={`${numero(estado.clima.lluviaProximosDias, 1)} mm`} />
        <StatCard label="Categoría" value={estado.clima.categoria ? ETIQUETA_LLUVIA[estado.clima.categoria as keyof typeof ETIQUETA_LLUVIA] ?? estado.clima.categoria : "Sin datos"} />
        <StatCard
          label="Hoy"
          value={estado.clima.hoy ? `${numero(estado.clima.hoy.lluviaMm, 1)} mm` : "Sin datos"}
          detail={estado.clima.hoy ? `${fecha(estado.clima.hoy.fecha)} · ${numero(estado.clima.hoy.tempMin, 0)}–${numero(estado.clima.hoy.tempMax, 0)} °C` : undefined}
        />
      </div> : <p className={MUTED}>Todavía no se consultó el clima de este lote.</p>}
      {estado.clima && <TablaDiasClima dias={estado.clima.dias} hoy={hoy()} />}
      {estado.clima && <p className={MUTED}>Última consulta: {timestamp(estado.clima.consultedAt)} · hace {numero(estado.clima.horasDesdeConsulta, 1)} horas</p>}
    </section>

    <JornadaPastoreoPanel loteId={lote.id} ultimoUso={estado.uso.ultimoUso} diasDescanso={estado.uso.diasDescanso} onCambio={cargarDatos} enfocarPastoreoTerminado={enfocarPastoreo} />

    <EstimacionForrajePanel lote={lote} estimacion={estimacion} cargando={estimacionCargando} error={errorEstimacion} />

    <PasturaPanel lote={lote} onGuardado={setLote} />

    {ganadoDentro && <SimulacionPastoreoPanel key={id} loteId={id} nombreLote={estado.lote.apodo ? `el lote ${estado.lote.numero} — ${estado.lote.apodo}` : `el lote ${estado.lote.numero}`} />}

    <MedicionesAlturaPanel loteId={lote.id} refresco={estado} onCambio={cargarDatos} />

    <section className={`${CARD} p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <h2 className={SECTION_TITLE}>Historial</h2>
        {/* Las tres juntas en una pastilla, como el dock: se leen como un solo control. */}
        <div className="flex flex-wrap gap-1 rounded-full border border-gray-200 bg-white p-1" role="tablist">
          {([['satelite', 'Satélite'], ['clima', 'Clima'], ['uso', 'Usos']] as const).map(([valor, etiqueta]) => (
            <button
              key={valor}
              role="tab"
              aria-selected={tab === valor}
              className={`foco-campo cursor-pointer rounded-full border-0 px-4 py-1.5 text-[0.82rem] font-medium transition-colors ${tab === valor ? "bg-[var(--color-verde-accion)] text-gray-900" : "bg-transparent text-gray-600 hover:bg-gray-50"}`}
              onClick={() => setTab(valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {tab === "satelite" && <>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.88rem]">
            <thead><tr>
              <th className={CELDA_ENCABEZADO}>Fecha</th>
              <th className={CELDA_ENCABEZADO}>Fuente</th>
              <th className={CELDA_ENCABEZADO}>NDVI</th>
              <th className={CELDA_ENCABEZADO}>RVI</th>
              <th className={CELDA_ENCABEZADO}>NDMI</th>
              <th className={CELDA_ENCABEZADO}>Cobertura</th>
              <th className={CELDA_ENCABEZADO}>Categoría</th>
            </tr></thead>
            <tbody>{mediciones.map((item) => <tr key={item.id}>
              <td className={CELDA}>{fecha(item.observedAt)}</td>
              <td className={CELDA}>{item.fuente === "sentinel-2" ? "Óptico" : item.fuente === "sentinel-1" ? "Radar" : item.fuente}</td>
              <td className={CELDA}>{item.fuente === "sentinel-2" ? numero(item.ndvi.mediana) : "—"}</td>
              <td className={CELDA}>{item.fuente === "sentinel-1" ? numero(item.rvi.mediana) : "—"}</td>
              <td className={CELDA}>{item.fuente === "sentinel-2" ? numero(item.ndmi.mediana) : "—"}</td>
              <td className={CELDA}>{item.fuente === "sentinel-2" ? numero(item.coberturaValida, 2) : "—"}</td>
              <td className={CELDA}>{item.categoria ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Paginador paginacion={paginaciones.satelite} onAnterior={() => setPaginas((actual) => ({ ...actual, satelite: Math.max(0, actual.satelite - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, satelite: actual.satelite + 1 }))} />
      </>}

      {tab === "clima" && <>
        <div>{climas.map((item) => <details key={item.id} className="border-b border-gray-200 py-3">
          <summary className="cursor-pointer font-bold text-brand">{timestamp(item.consultedAt)} · {item.origen === "automatico" ? "automática" : "a pedido"} · {numero(item.lluviaUltimos7Dias, 1)} mm últimos 7 días · {item.categoria ? ETIQUETA_LLUVIA[item.categoria as keyof typeof ETIQUETA_LLUVIA] ?? item.categoria : "Sin datos"}</summary>
          <ul className="mb-0 text-gray-500">{item.dias.map((dia) => <li key={`${item.id}-${dia.fecha}`}>{fecha(dia.fecha)} · {numero(dia.lluviaMm, 1)} mm · {numero(dia.tempMin, 0)}–{numero(dia.tempMax, 0)} °C · radiación {numero(dia.radiacionMjM2, 1)} · ET₀ {numero(dia.evapotranspiracionMm, 1)} · {dia.esPronostico ? "pronóstico" : "observado"}</li>)}</ul>
        </details>)}</div>
        <Paginador paginacion={paginaciones.clima} onAnterior={() => setPaginas((actual) => ({ ...actual, clima: Math.max(0, actual.clima - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, clima: actual.clima + 1 }))} />
      </>}

      {tab === "uso" && <>
        <ul className="m-0 list-none p-0">{usos.map((uso) => <li key={uso.id} className="flex flex-col justify-between gap-1 border-b border-gray-200 py-3 md:flex-row md:gap-3">
          <strong className="whitespace-nowrap">{fecha(uso.fecha)}</strong><span className="flex-1 text-gray-500">{describirUso(uso)}</span>
          {puede('modificar_usos') && <div className="flex gap-2"><Button variant="secondary" disabled={ocupado !== null} onClick={() => setEditarUso(uso)}>Editar</Button><Button variant="danger" disabled={ocupado !== null} onClick={() => setBorrarUso(uso)}>Borrar</Button></div>}
        </li>)}</ul>
        <Paginador paginacion={paginaciones.uso} onAnterior={() => setPaginas((actual) => ({ ...actual, uso: Math.max(0, actual.uso - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, uso: actual.uso + 1 }))} />
      </>}
    </section>
    {editarUso?.ingresoAt && <EditarJornadaModal loteId={id} uso={editarUso} onCancelar={() => setEditarUso(null)} onGuardado={() => { setEditarUso(null); void cargarDatos(); }} />}
    {editarUso && !editarUso.ingresoAt && <PromptModal title="Editar fecha de uso" label="Fecha" initialValue={editarUso.fecha} onCancel={() => setEditarUso(null)} onConfirm={async valor => { if (ocupado) return; setOcupado('uso'); try { await modificarUsoLote(establecimientoId, id, editarUso.id, valor); setEditarUso(null); await cargarDatos(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); } }} />}
    {borrarUso && <ConfirmModal title={borrarUso.ingresoAt ? "Borrar jornada de pastoreo" : "Borrar uso"} message={mensajeBorrarUso(borrarUso)} confirmText="Borrar" onCancel={() => setBorrarUso(null)} onConfirm={async () => { if (ocupado) return; setOcupado('uso'); try { await eliminarUsoLote(establecimientoId, id, borrarUso.id); setBorrarUso(null); await cargarDatos(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); } }} />}
  </PantallaDatos>;
}
