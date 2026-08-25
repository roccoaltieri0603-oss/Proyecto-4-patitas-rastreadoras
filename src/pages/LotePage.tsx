import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { actualizarSateliteLote } from "../copernicus/api";
import { actualizarClimaLote } from "../clima/api";
import { obtenerLotes } from "../api/rodeo";
import { ApiError } from "../api/client";
import { obtenerConsultasClima, obtenerEstadoLote, obtenerMedicionesSatelitales, obtenerUsosLote, registrarUsoLote, type ConsultaClimaHistorial, type EstadoLoteApi, type MedicionSatelital, type PaginacionHistorial, type UsoLote } from "../api/historial";
import type { Lote } from "../types";
import Button from "../components/ui/Button";

type Tab = "satelite" | "clima" | "uso";
const PAGE_SIZE = 20;

const CARD = "rounded-2xl border border-gray-200 bg-white shadow-[0_3px_12px_rgba(30,58,95,0.06)]";
const MUTED = "text-[0.9rem] text-gray-500";
const KICKER = "mb-1 text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[#2f855a]";
const SECTION_TITLE = "m-0 text-brand";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
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

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className={`${CARD} p-4`}><span className="block text-gray-500">{label}</span><strong className="mt-[7px] mb-[3px] block text-[1.35rem] text-brand">{value}</strong>{detail && <small className="block text-gray-500">{detail}</small>}</article>;
}

function Indice({ nombre, stats }: { nombre: string; stats: { media: number | null; mediana: number | null; min: number | null; max: number | null; desvio: number | null } }) {
  return <div className="rounded-[10px] bg-[#f8fafc] p-3">
    <div className="flex justify-between gap-2.5 font-bold text-brand"><span>{nombre}</span><strong>{numero(stats.mediana)}</strong></div>
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-[5px] text-[0.82rem]">
      <div className="flex justify-between gap-2"><dt className="text-gray-500">Media</dt><dd className="m-0">{numero(stats.media)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-gray-500">Mín.</dt><dd className="m-0">{numero(stats.min)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-gray-500">Máx.</dt><dd className="m-0">{numero(stats.max)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-gray-500">Desvío</dt><dd className="m-0">{numero(stats.desvio)}</dd></div>
    </dl>
  </div>;
}

function GraficoNdvi({ mediciones }: { mediciones: MedicionSatelital[] }) {
  const puntos = mediciones.filter((item) => item.fuente === "sentinel-2" && item.ndvi.mediana !== null).slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (puntos.length === 0) return <p className={MUTED}>Sin historial suficiente.</p>;
  const ancho = 680;
  const alto = 190;
  const izquierda = 42;
  const arriba = 18;
  const abajo = 30;
  const anchoGrafico = ancho - izquierda - 16;
  const altoGrafico = alto - arriba - abajo;
  const minimo = Math.min(-1, ...puntos.map((punto) => punto.ndvi.mediana ?? 0));
  const maximo = Math.max(1, ...puntos.map((punto) => punto.ndvi.mediana ?? 0));
  const x = (index: number) => izquierda + (puntos.length === 1 ? anchoGrafico / 2 : (index / (puntos.length - 1)) * anchoGrafico);
  const y = (valor: number) => arriba + ((maximo - valor) / (maximo - minimo)) * altoGrafico;
  const linea = puntos.map((punto, index) => `${x(index)},${y(punto.ndvi.mediana ?? 0)}`).join(" ");
  return <svg className="mt-2 block h-[210px] w-full min-w-[560px]" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Evolución de NDVI mediana">
    <line x1={izquierda} x2={ancho - 16} y1={y(0)} y2={y(0)} stroke="#d1d5db" />
    {puntos.length > 1 && <polyline points={linea} fill="none" stroke="#2f855a" strokeWidth="3" />}
    {puntos.map((punto, index) => <g key={`${punto.id}-${punto.observedAt}`}><circle cx={x(index)} cy={y(punto.ndvi.mediana ?? 0)} r="5" fill="#2f855a"><title>{fecha(punto.observedAt)} · NDVI {numero(punto.ndvi.mediana)}</title></circle><text x={x(index)} y={alto - 8} textAnchor="middle" className="fill-gray-500 text-[10px]">{fecha(punto.observedAt)}</text></g>)}
  </svg>;
}

function Paginador({ paginacion, onAnterior, onSiguiente }: { paginacion: PaginacionHistorial | null; onAnterior: () => void; onSiguiente: () => void }) {
  if (!paginacion || paginacion.total <= PAGE_SIZE) return null;
  return <div className="mt-4 flex items-center justify-center gap-3.5 text-[0.9rem] text-gray-500"><Button variant="secondary" onClick={onAnterior} disabled={paginacion.offset === 0}>Anterior</Button><span>{paginacion.offset + 1}–{Math.min(paginacion.offset + PAGE_SIZE, paginacion.total)} de {paginacion.total}</span><Button variant="secondary" onClick={onSiguiente} disabled={!paginacion.hayMas}>Siguiente</Button></div>;
}

export default function LotePage() {
  const { id = "" } = useParams();
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
  const [ocupado, setOcupado] = useState<"satelite" | "clima" | "uso" | null>(null);
  const [fechaUso, setFechaUso] = useState("");

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    setNoEncontrado(false);
    try {
      const lotes = await obtenerLotes();
      const loteActual = lotes.find((item) => item.id === id);
      if (!loteActual) { setNoEncontrado(true); return; }
      const [estadoActual, satelite, clima, uso] = await Promise.all([
        obtenerEstadoLote(id),
        obtenerMedicionesSatelitales(id, { limit: PAGE_SIZE, offset: paginas.satelite * PAGE_SIZE }),
        obtenerConsultasClima(id, { limit: PAGE_SIZE, offset: paginas.clima * PAGE_SIZE }),
        obtenerUsosLote(id, { limit: PAGE_SIZE, offset: paginas.uso * PAGE_SIZE }),
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
  }, [id, paginas]);

  useEffect(() => { void cargarDatos(); }, [cargarDatos]);

  const ndvi = estado?.satelite.optico?.ndvi.mediana;
  const ndmi = estado?.satelite.optico?.ndmi.mediana;
  const proxima = estado?.satelite.optico ? proximaOptica(estado.satelite.optico.observedAt) : null;
  const ultimaActualizacion = useMemo(() => {
    const fechas = [estado?.satelite.optico?.consultedAt, estado?.satelite.radar?.consultedAt, estado?.clima?.consultedAt].filter(Boolean) as string[];
    return fechas.sort().at(-1) ?? null;
  }, [estado]);

  async function actualizarSatelite() {
    if (!lote || ocupado) return;
    setOcupado("satelite"); setError(null);
    try {
      const respuesta = await actualizarSateliteLote(lote.id);
      if (respuesta.estado !== "ok" && respuesta.estado !== "radar") {
        setError(respuesta.mensaje ?? "Copernicus no devolvió datos utilizables.");
        return;
      }
      await cargarDatos();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo consultar Copernicus. Intentá nuevamente.");
    } finally { setOcupado(null); }
  }

  async function actualizarClima() {
    if (!lote || ocupado) return;
    setOcupado("clima"); setError(null);
    try {
      const respuesta = await actualizarClimaLote(lote.id, "manual");
      if (respuesta?.estado !== "ok") throw new Error(respuesta?.mensaje ?? "No se pudo consultar el clima.");
      await cargarDatos();
    } catch (reason) { setError(mensajeError(reason)); }
    finally { setOcupado(null); }
  }

  async function registrarUso() {
    if (!lote || !fechaUso || ocupado) return;
    setOcupado("uso"); setError(null);
    try { await registrarUsoLote(lote.id, fechaUso); setFechaUso(""); await cargarDatos(); }
    catch (reason) { setError(mensajeError(reason)); }
    finally { setOcupado(null); }
  }

  const pageState = "grid min-h-screen place-content-center justify-items-center gap-2.5 bg-gray-100 p-6 text-center";
  if (cargando && !estado) return <main className={pageState}><p>Cargando ficha del lote...</p></main>;
  if (noEncontrado) return <main className={pageState}><h1>Lote no encontrado</h1><p>El lote no existe o no está disponible para tu usuario.</p><Link to="/"><Button variant="primary">Volver al mapa</Button></Link></main>;
  if (!estado || !lote) return <main className={pageState}><p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error ?? "No se pudo cargar la ficha."}</p><Link to="/"><Button variant="primary">Volver al mapa</Button></Link></main>;

  return <main className="min-h-screen bg-gray-100 px-4 pt-7 pb-14 text-gray-800 md:px-[clamp(16px,4vw,64px)]">
    <header className="mx-auto mb-6 max-w-[1180px]">
      <Link className="font-bold text-brand no-underline" to="/">← Volver al mapa</Link>
      <div className="mt-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <div>
          <p className={KICKER}>Ficha de lote</p>
          <h1 className={`${SECTION_TITLE} text-[clamp(1.8rem,4vw,2.7rem)]`}>Lote {estado.lote.numero}</h1>
          <p className="mt-1 text-gray-500">{estado.lote.apodo || "Sin apodo"}</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[0.8rem] font-extrabold ${estado.lote.activo ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>{estado.lote.activo ? "Activo" : "Inactivo"}</span>
      </div>
      {ultimaActualizacion && <p className={`${MUTED} mt-3`}>Última actualización persistida: {timestamp(ultimaActualizacion)}</p>}
    </header>

    {error && <div className="mx-auto mb-[18px] max-w-[1180px] rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</div>}

    <section className="mx-auto mb-6 grid max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
      <StatCard label="NDVI" value={numero(ndvi)} detail={estado.satelite.optico ? fecha(estado.satelite.optico.observedAt) : undefined} />
      <StatCard label="NDMI" value={numero(ndmi)} detail={estado.satelite.optico ? `hace ${estado.satelite.optico.diasDesdeObservacion} días` : undefined} />
      <StatCard label="Descanso" value={estado.uso.diasDescanso === null ? "Sin datos" : `${estado.uso.diasDescanso} días`} />
      <StatCard label="Lluvia últimos 7 días" value={estado.clima ? `${numero(estado.clima.lluviaUltimos7Dias, 1)} mm` : "Sin datos"} />
      <StatCard label="Último uso" value={estado.uso.ultimoUso ? fecha(estado.uso.ultimoUso.fecha) : "Sin datos"} />
    </section>

    <section className={`${CARD} mx-auto mb-6 max-w-[1180px] p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <div><p className={KICKER}>Datos persistidos</p><h2 className={`${SECTION_TITLE} text-[1.35rem]`}>Condición satelital</h2></div>
        <Button variant="secondary" onClick={actualizarSatelite} disabled={ocupado !== null}>{ocupado === "satelite" ? "Actualizando..." : "Actualizar satélite"}</Button>
      </div>
      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-[18px]">
          <h3 className={`${SECTION_TITLE} text-base`}>Sentinel-2 · Óptico</h3>
          {estado.satelite.optico ? <>
            <p className={MUTED}>Observado {fecha(estado.satelite.optico.observedAt)} · hace {estado.satelite.optico.diasDesdeObservacion} días · cobertura {numero(estado.satelite.optico.coberturaValida, 2)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Indice nombre="NDVI" stats={estado.satelite.optico.ndvi} />
              <Indice nombre="NDMI" stats={estado.satelite.optico.ndmi} />
              <Indice nombre="NDWI" stats={estado.satelite.optico.ndwi} />
              <Indice nombre="EVI" stats={estado.satelite.optico.evi} />
            </div>
            {estado.satelite.optico.puntaje === null ? <p className={MUTED}>Puntaje: Sin datos</p> : <p className="font-bold text-green-800">Condición satelital · puntaje provisional {estado.satelite.optico.puntaje}/100 · {estado.satelite.optico.categoria ?? "sin categoría"}</p>}
            <p className={MUTED}>Próxima pasada óptica estimada: {proxima}{proxima && ` · ${estado.satelite.optico.diasDesdeObservacion >= 5 ? "Puede haber una nueva pasada disponible." : "estimada"}`}</p>
          </> : <p className={MUTED}>Sin datos ópticos.</p>}
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-[18px]">
          <h3 className={`${SECTION_TITLE} text-base`}>Sentinel-1 · Radar</h3>
          {estado.satelite.radar ? <>
            <p className={MUTED}>Observado {fecha(estado.satelite.radar.observedAt)} · hace {estado.satelite.radar.diasDesdeObservacion} días</p>
            <Indice nombre="RVI" stats={estado.satelite.radar.rvi} />
            <p className={MUTED}>Radar y óptica son fuentes distintas y no se combinan.</p>
          </> : <p className={MUTED}>Sin datos de radar.</p>}
        </article>
      </div>
      <div className="mt-[14px] overflow-x-auto rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className={`${SECTION_TITLE} text-base`}>Evolución NDVI</h3>
        <GraficoNdvi mediciones={mediciones} />
      </div>
    </section>

    <section className={`${CARD} mx-auto mb-6 max-w-[1180px] p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <div><p className={KICKER}>Pronóstico y observación</p><h2 className={`${SECTION_TITLE} text-[1.35rem]`}>Clima</h2></div>
        <Button variant="secondary" onClick={actualizarClima} disabled={ocupado !== null}>{ocupado === "clima" ? "Actualizando..." : "Actualizar clima"}</Button>
      </div>
      {estado.clima ? <div className="grid grid-cols-1 items-center gap-[14px] md:grid-cols-2">
        <StatCard label="Lluvia últimos 7 días" value={`${numero(estado.clima.lluviaUltimos7Dias, 1)} mm`} />
        <StatCard label="Lluvia próximos días" value={`${numero(estado.clima.lluviaProximosDias, 1)} mm`} />
        <StatCard label="Categoría" value={estado.clima.categoria ?? "Sin datos"} />
        <div className="flex flex-col justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-[18px]">
          <strong>Hoy</strong>
          {estado.clima.hoy ? <span className="text-gray-500">{fecha(estado.clima.hoy.fecha)} · {numero(estado.clima.hoy.lluviaMm, 1)} mm · {numero(estado.clima.hoy.tempMin, 0)}–{numero(estado.clima.hoy.tempMax, 0)} °C</span> : <span className="text-gray-500">Sin datos para hoy</span>}
        </div>
      </div> : <p className={MUTED}>Sin datos climáticos persistidos.</p>}
      {estado.clima && <p className={MUTED}>Última consulta: {timestamp(estado.clima.consultedAt)} · hace {numero(estado.clima.horasDesdeConsulta, 1)} horas</p>}
    </section>

    <section className={`${CARD} mx-auto mb-6 max-w-[1180px] p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <div><p className={KICKER}>Registro de campo</p><h2 className={`${SECTION_TITLE} text-[1.35rem]`}>Descanso y uso</h2></div>
      </div>
      <div className="grid grid-cols-1 items-center gap-[14px] md:grid-cols-2">
        <div>
          <p>Último uso</p>
          <strong>{estado.uso.ultimoUso ? `${fecha(estado.uso.ultimoUso.fecha)} · ${estado.uso.ultimoUso.origen}` : "Sin registrar"}</strong>
          <p>Descanso actual: {estado.uso.diasDescanso === null ? "Sin datos" : `${estado.uso.diasDescanso} días`}</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2 md:items-end">
          <label className="w-full font-bold text-brand" htmlFor="fecha-uso">Registrar nuevo uso</label>
          <input className="min-h-[38px] flex-1 rounded-lg border border-gray-300 px-[9px] md:flex-none" id="fecha-uso" type="date" max={hoy()} value={fechaUso} onChange={(event) => setFechaUso(event.target.value)} disabled={ocupado !== null} />
          <Button className="flex-1 md:flex-none" variant="primary" onClick={registrarUso} disabled={!fechaUso || ocupado !== null}>{ocupado === "uso" ? "Guardando..." : "Registrar uso"}</Button>
        </div>
      </div>
    </section>

    <section className={`${CARD} mx-auto mb-6 max-w-[1180px] p-[22px]`}>
      <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
        <div><p className={KICKER}>Datos históricos</p><h2 className={`${SECTION_TITLE} text-[1.35rem]`}>Historial</h2></div>
        <div className="flex flex-wrap gap-1" role="tablist">
          {([['satelite', 'Satélite'], ['clima', 'Clima'], ['uso', 'Usos']] as const).map(([valor, etiqueta]) => (
            <button
              key={valor}
              role="tab"
              aria-selected={tab === valor}
              className={`cursor-pointer rounded-lg border-0 px-2.5 py-2 ${tab === valor ? "bg-brand text-white" : "bg-gray-100 text-gray-600"}`}
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
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">Fecha</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">Fuente</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">NDVI</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">RVI</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">NDMI</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">Cobertura</th>
              <th className="border-b border-gray-200 px-[9px] py-[11px] text-left whitespace-nowrap text-brand">Categoría</th>
            </tr></thead>
            <tbody>{mediciones.map((item) => <tr key={item.id}>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{fecha(item.observedAt)}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.fuente}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.fuente === "sentinel-2" ? numero(item.ndvi.mediana) : "—"}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.fuente === "sentinel-1" ? numero(item.rvi.mediana) : "—"}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.fuente === "sentinel-2" ? numero(item.ndmi.mediana) : "—"}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.fuente === "sentinel-2" ? numero(item.coberturaValida, 2) : "—"}</td>
              <td className="border-b border-gray-200 px-[9px] py-[11px] whitespace-nowrap">{item.categoria ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Paginador paginacion={paginaciones.satelite} onAnterior={() => setPaginas((actual) => ({ ...actual, satelite: Math.max(0, actual.satelite - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, satelite: actual.satelite + 1 }))} />
      </>}

      {tab === "clima" && <>
        <div>{climas.map((item) => <details key={item.id} className="border-b border-gray-200 py-3">
          <summary className="cursor-pointer font-bold text-brand">{timestamp(item.consultedAt)} · {item.origen} · {numero(item.lluviaUltimos7Dias, 1)} mm últimos 7 días · {item.categoria ?? "sin categoría"}</summary>
          <ul className="mb-0 text-gray-500">{item.dias.map((dia) => <li key={`${item.id}-${dia.fecha}`}>{fecha(dia.fecha)} · {numero(dia.lluviaMm, 1)} mm · {numero(dia.tempMin, 0)}–{numero(dia.tempMax, 0)} °C · {dia.esPronostico ? "pronóstico" : "observado"}</li>)}</ul>
        </details>)}</div>
        <Paginador paginacion={paginaciones.clima} onAnterior={() => setPaginas((actual) => ({ ...actual, clima: Math.max(0, actual.clima - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, clima: actual.clima + 1 }))} />
      </>}

      {tab === "uso" && <>
        <ul className="m-0 list-none p-0">{usos.map((uso) => <li key={uso.id} className="flex flex-col justify-between gap-1 border-b border-gray-200 py-3 md:flex-row md:gap-3">
          <strong>{fecha(uso.fecha)}</strong><span className="text-gray-500">uso registrado · {uso.origen}</span>
        </li>)}</ul>
        <Paginador paginacion={paginaciones.uso} onAnterior={() => setPaginas((actual) => ({ ...actual, uso: Math.max(0, actual.uso - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, uso: actual.uso + 1 }))} />
      </>}
    </section>
  </main>;
}
