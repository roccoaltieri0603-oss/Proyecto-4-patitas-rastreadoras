import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { actualizarSateliteLote } from "../copernicus/api";
import { actualizarClimaLote } from "../clima/api";
import { obtenerLotes } from "../api/rodeo";
import { ApiError } from "../api/client";
import { obtenerConsultasClima, obtenerEstadoLote, obtenerMedicionesSatelitales, obtenerUsosLote, registrarUsoLote, type ConsultaClimaHistorial, type EstadoLoteApi, type MedicionSatelital, type PaginacionHistorial, type UsoLote } from "../api/historial";
import type { Lote } from "../types";
import "./LotePage.css";

type Tab = "satelite" | "clima" | "uso";
const PAGE_SIZE = 20;

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
  return <article className="lote-stat-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function Indice({ nombre, stats }: { nombre: string; stats: { media: number | null; mediana: number | null; min: number | null; max: number | null; desvio: number | null } }) {
  return <div className="lote-indice"><div><span>{nombre}</span><strong>{numero(stats.mediana)}</strong></div><dl><div><dt>Media</dt><dd>{numero(stats.media)}</dd></div><div><dt>Mín.</dt><dd>{numero(stats.min)}</dd></div><div><dt>Máx.</dt><dd>{numero(stats.max)}</dd></div><div><dt>Desvío</dt><dd>{numero(stats.desvio)}</dd></div></dl></div>;
}

function GraficoNdvi({ mediciones }: { mediciones: MedicionSatelital[] }) {
  const puntos = mediciones.filter((item) => item.fuente === "sentinel-2" && item.ndvi.mediana !== null).slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (puntos.length === 0) return <p className="lote-muted">Sin historial suficiente.</p>;
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
  return <svg className="ndvi-chart" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Evolución de NDVI mediana">
    <line x1={izquierda} x2={ancho - 16} y1={y(0)} y2={y(0)} stroke="#d1d5db" />
    {puntos.length > 1 && <polyline points={linea} fill="none" stroke="#2f855a" strokeWidth="3" />}
    {puntos.map((punto, index) => <g key={`${punto.id}-${punto.observedAt}`}><circle cx={x(index)} cy={y(punto.ndvi.mediana ?? 0)} r="5" fill="#2f855a"><title>{fecha(punto.observedAt)} · NDVI {numero(punto.ndvi.mediana)}</title></circle><text x={x(index)} y={alto - 8} textAnchor="middle" className="ndvi-axis">{fecha(punto.observedAt)}</text></g>)}
  </svg>;
}

function Paginador({ paginacion, onAnterior, onSiguiente }: { paginacion: PaginacionHistorial | null; onAnterior: () => void; onSiguiente: () => void }) {
  if (!paginacion || paginacion.total <= PAGE_SIZE) return null;
  return <div className="lote-pagination"><button className="btn btn-secondary" onClick={onAnterior} disabled={paginacion.offset === 0}>Anterior</button><span>{paginacion.offset + 1}–{Math.min(paginacion.offset + PAGE_SIZE, paginacion.total)} de {paginacion.total}</span><button className="btn btn-secondary" onClick={onSiguiente} disabled={!paginacion.hayMas}>Siguiente</button></div>;
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

  if (cargando && !estado) return <main className="lote-page-state"><p>Cargando ficha del lote...</p></main>;
  if (noEncontrado) return <main className="lote-page-state"><h1>Lote no encontrado</h1><p>El lote no existe o no está disponible para tu usuario.</p><Link className="btn btn-primary" to="/">Volver al mapa</Link></main>;
  if (!estado || !lote) return <main className="lote-page-state"><p className="auth-error">{error ?? "No se pudo cargar la ficha."}</p><Link className="btn btn-primary" to="/">Volver al mapa</Link></main>;

  return <main className="lote-page">
    <header className="lote-page-header"><Link className="lote-back" to="/">← Volver al mapa</Link><div className="lote-heading"><div><p className="lote-kicker">Ficha de lote</p><h1>Lote {estado.lote.numero}</h1><p className="lote-subtitle">{estado.lote.apodo || "Sin apodo"}</p></div><span className={`lote-page-badge ${estado.lote.activo ? "activo" : "inactivo"}`}>{estado.lote.activo ? "Activo" : "Inactivo"}</span></div>{ultimaActualizacion && <p className="lote-last-update">Última actualización persistida: {timestamp(ultimaActualizacion)}</p>}</header>
    {error && <div className="lote-page-notice auth-error">{error}</div>}
    <section className="lote-summary-grid"><StatCard label="NDVI" value={numero(ndvi)} detail={estado.satelite.optico ? fecha(estado.satelite.optico.observedAt) : undefined} /><StatCard label="NDMI" value={numero(ndmi)} detail={estado.satelite.optico ? `hace ${estado.satelite.optico.diasDesdeObservacion} días` : undefined} /><StatCard label="Descanso" value={estado.uso.diasDescanso === null ? "Sin datos" : `${estado.uso.diasDescanso} días`} /><StatCard label="Lluvia últimos 7 días" value={estado.clima ? `${numero(estado.clima.lluviaUltimos7Dias, 1)} mm` : "Sin datos"} /><StatCard label="Último uso" value={estado.uso.ultimoUso ? fecha(estado.uso.ultimoUso.fecha) : "Sin datos"} /></section>

    <section className="lote-section"><div className="lote-section-heading"><div><p className="lote-kicker">Datos persistidos</p><h2>Condición satelital</h2></div><button className="btn btn-secondary" onClick={actualizarSatelite} disabled={ocupado !== null}>{ocupado === "satelite" ? "Actualizando..." : "Actualizar satélite"}</button></div>
      <div className="lote-source-grid"><article className="lote-source-card"><h3>Sentinel-2 · Óptico</h3>{estado.satelite.optico ? <><p className="lote-muted">Observado {fecha(estado.satelite.optico.observedAt)} · hace {estado.satelite.optico.diasDesdeObservacion} días · cobertura {numero(estado.satelite.optico.coberturaValida, 2)}</p><div className="lote-indices-grid"><Indice nombre="NDVI" stats={estado.satelite.optico.ndvi} /><Indice nombre="NDMI" stats={estado.satelite.optico.ndmi} /><Indice nombre="NDWI" stats={estado.satelite.optico.ndwi} /><Indice nombre="EVI" stats={estado.satelite.optico.evi} /></div>{estado.satelite.optico.puntaje === null ? <p className="lote-muted">Puntaje: Sin datos</p> : <p className="lote-score">Condición satelital · puntaje provisional {estado.satelite.optico.puntaje}/100 · {estado.satelite.optico.categoria ?? "sin categoría"}</p>}<p className="lote-muted">Próxima pasada óptica estimada: {proxima}{proxima && ` · ${estado.satelite.optico.diasDesdeObservacion >= 5 ? "Puede haber una nueva pasada disponible." : "estimada"}`}</p></> : <p className="lote-muted">Sin datos ópticos.</p>}</article><article className="lote-source-card radar-card"><h3>Sentinel-1 · Radar</h3>{estado.satelite.radar ? <><p className="lote-muted">Observado {fecha(estado.satelite.radar.observedAt)} · hace {estado.satelite.radar.diasDesdeObservacion} días</p><Indice nombre="RVI" stats={estado.satelite.radar.rvi} /><p className="lote-muted">Radar y óptica son fuentes distintas y no se combinan.</p></> : <p className="lote-muted">Sin datos de radar.</p>}</article></div>
      <div className="lote-chart-card"><h3>Evolución NDVI</h3><GraficoNdvi mediciones={mediciones} /></div>
    </section>

    <section className="lote-section"><div className="lote-section-heading"><div><p className="lote-kicker">Pronóstico y observación</p><h2>Clima</h2></div><button className="btn btn-secondary" onClick={actualizarClima} disabled={ocupado !== null}>{ocupado === "clima" ? "Actualizando..." : "Actualizar clima"}</button></div>{estado.clima ? <div className="lote-climate-grid"><StatCard label="Lluvia últimos 7 días" value={`${numero(estado.clima.lluviaUltimos7Dias, 1)} mm`} /><StatCard label="Lluvia próximos días" value={`${numero(estado.clima.lluviaProximosDias, 1)} mm`} /><StatCard label="Categoría" value={estado.clima.categoria ?? "Sin datos"} /><div className="lote-today"><strong>Hoy</strong>{estado.clima.hoy ? <span>{fecha(estado.clima.hoy.fecha)} · {numero(estado.clima.hoy.lluviaMm, 1)} mm · {numero(estado.clima.hoy.tempMin, 0)}–{numero(estado.clima.hoy.tempMax, 0)} °C</span> : <span>Sin datos para hoy</span>}</div></div> : <p className="lote-muted">Sin datos climáticos persistidos.</p>}{estado.clima && <p className="lote-muted">Última consulta: {timestamp(estado.clima.consultedAt)} · hace {numero(estado.clima.horasDesdeConsulta, 1)} horas</p>}</section>

    <section className="lote-section"><div className="lote-section-heading"><div><p className="lote-kicker">Registro de campo</p><h2>Descanso y uso</h2></div></div><div className="lote-use-grid"><div><p>Último uso</p><strong>{estado.uso.ultimoUso ? `${fecha(estado.uso.ultimoUso.fecha)} · ${estado.uso.ultimoUso.origen}` : "Sin registrar"}</strong><p>Descanso actual: {estado.uso.diasDescanso === null ? "Sin datos" : `${estado.uso.diasDescanso} días`}</p></div><div className="lote-use-form"><label htmlFor="fecha-uso">Registrar nuevo uso</label><input id="fecha-uso" type="date" max={hoy()} value={fechaUso} onChange={(event) => setFechaUso(event.target.value)} disabled={ocupado !== null} /><button className="btn btn-primary" onClick={registrarUso} disabled={!fechaUso || ocupado !== null}>{ocupado === "uso" ? "Guardando..." : "Registrar uso"}</button></div></div></section>

    <section className="lote-section"><div className="lote-section-heading"><div><p className="lote-kicker">Datos históricos</p><h2>Historial</h2></div><div className="lote-tabs" role="tablist">{([['satelite', 'Satélite'], ['clima', 'Clima'], ['uso', 'Usos']] as const).map(([valor, etiqueta]) => <button key={valor} role="tab" aria-selected={tab === valor} className={tab === valor ? "activo" : ""} onClick={() => setTab(valor)}>{etiqueta}</button>)}</div></div>{tab === "satelite" && <><div className="lote-table-wrap"><table><thead><tr><th>Fecha</th><th>Fuente</th><th>NDVI</th><th>RVI</th><th>NDMI</th><th>Cobertura</th><th>Categoría</th></tr></thead><tbody>{mediciones.map((item) => <tr key={item.id}><td>{fecha(item.observedAt)}</td><td>{item.fuente}</td><td>{item.fuente === "sentinel-2" ? numero(item.ndvi.mediana) : "—"}</td><td>{item.fuente === "sentinel-1" ? numero(item.rvi.mediana) : "—"}</td><td>{item.fuente === "sentinel-2" ? numero(item.ndmi.mediana) : "—"}</td><td>{item.fuente === "sentinel-2" ? numero(item.coberturaValida, 2) : "—"}</td><td>{item.categoria ?? "—"}</td></tr>)}</tbody></table></div><Paginador paginacion={paginaciones.satelite} onAnterior={() => setPaginas((actual) => ({ ...actual, satelite: Math.max(0, actual.satelite - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, satelite: actual.satelite + 1 }))} /></>}{tab === "clima" && <><div className="lote-history-list">{climas.map((item) => <details key={item.id}><summary>{timestamp(item.consultedAt)} · {item.origen} · {numero(item.lluviaUltimos7Dias, 1)} mm últimos 7 días · {item.categoria ?? "sin categoría"}</summary><ul>{item.dias.map((dia) => <li key={`${item.id}-${dia.fecha}`}>{fecha(dia.fecha)} · {numero(dia.lluviaMm, 1)} mm · {numero(dia.tempMin, 0)}–{numero(dia.tempMax, 0)} °C · {dia.esPronostico ? "pronóstico" : "observado"}</li>)}</ul></details>)}</div><Paginador paginacion={paginaciones.clima} onAnterior={() => setPaginas((actual) => ({ ...actual, clima: Math.max(0, actual.clima - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, clima: actual.clima + 1 }))} /></>}{tab === "uso" && <><ul className="lote-use-history">{usos.map((uso) => <li key={uso.id}><strong>{fecha(uso.fecha)}</strong><span>uso registrado · {uso.origen}</span></li>)}</ul><Paginador paginacion={paginaciones.uso} onAnterior={() => setPaginas((actual) => ({ ...actual, uso: Math.max(0, actual.uso - 1) }))} onSiguiente={() => setPaginas((actual) => ({ ...actual, uso: actual.uso + 1 }))} /></>}</section>
  </main>;
}
