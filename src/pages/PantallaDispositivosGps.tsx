import { useEffect, useState } from "react";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { actualizarDispositivo, obtenerDispositivos, obtenerResponsablesGps, asignarResponsableGps, type Dispositivo, type DispositivoResponsableGps, type ResponsableGpsDisponible } from "../api/dispositivos";
import Button from "../components/ui/Button";
import PantallaDatos, { EstadoDePantalla, TARJETA, TITULO_SECCION, VOLANTA } from "../components/ui/PantallaDatos";
import { obtenerLotes } from "../api/rodeo";
import { avisarCambioNotificaciones } from "../hooks/useNotificaciones";
import type { Lote } from "../types";

function etiquetaIncidencia(tipo: string, condicion: Dispositivo["condicionBateria"]): string {
  if (tipo === "gps_simulado_bateria_episodio") return `Batería ${condicion ?? "baja"}`;
  const etiquetas: Record<string, string> = {
    gps_simulado_bateria_baja: "Batería baja",
    gps_simulado_bateria_critica: "Batería crítica",
    gps_simulado_bateria_agotada: "Batería agotada",
    gps_simulado_sin_senal: "Sin señal simulada",
    gps_simulado_fuera_establecimiento: "Fuera del establecimiento",
    gps_simulado_fuera_lote_asignado: "Fuera del lote asignado",
  };
  return etiquetas[tipo] ?? "Incidencia GPS simulada";
}

export default function PantallaDispositivosGps() {
  const { establecimientoId, establecimiento, membresia } = useEstablecimiento();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]); const [seleccionado, setSeleccionado] = useState("");
  const [nombre, setNombre] = useState(""); const [bateria, setBateria] = useState("0"); const [conexion, setConexion] = useState<"en-linea" | "sin-senal">("en-linea");
  const [loteAsignadoId, setLoteAsignadoId] = useState(""); const [lotes, setLotes] = useState<Lote[]>([]);
  const [gpsResponsables, setGpsResponsables] = useState<DispositivoResponsableGps[]>([]); const [administradoresGps, setAdministradoresGps] = useState<ResponsableGpsDisponible[]>([]);
  const [cargando, setCargando] = useState(true); const [guardando, setGuardando] = useState(false); const [error, setError] = useState(""); const [ok, setOk] = useState("");
  const visible = membresia?.rol === "PROPIETARIO" || membresia?.permisos.includes("ver_dispositivos_gps");
  const editable = membresia?.rol === "PROPIETARIO" || membresia?.permisos.includes("modificar_dispositivos_gps");
  async function cargar() { setCargando(true); setError(""); try { const [d, l] = await Promise.all([obtenerDispositivos(establecimientoId), obtenerLotes(establecimientoId)]); setDispositivos(d); setLotes(l.filter(x => x.activo)); setSeleccionado((s) => d.some((x) => x.id === s) ? s : d[0]?.id ?? ""); if (membresia?.rol === "PROPIETARIO") { const r = await obtenerResponsablesGps(establecimientoId); setGpsResponsables(r.dispositivos); setAdministradoresGps(r.administradores); } } catch (e) { setError(e instanceof ApiError ? e.message : "No se pudieron cargar los GPS simulados."); } finally { setCargando(false); } }
  useEffect(() => { void cargar(); }, [establecimientoId, membresia?.rol]);
  const actual = dispositivos.find((d) => d.id === seleccionado);
  useEffect(() => { if (actual) { setNombre(actual.apodo ?? ""); setBateria(String(actual.bateriaPorcentaje ?? 0)); setConexion(actual.conexion === "sin-senal" ? "sin-senal" : "en-linea"); setLoteAsignadoId(actual.loteAsignado?.id ?? ""); } }, [actual?.id, actual?.apodo, actual?.bateriaPorcentaje, actual?.conexion, actual?.loteAsignado?.id]);
  useOcultarDock(cargando);
  if (!visible) return <Navigate to={`/establecimientos/${establecimientoId}`} replace />;
  async function guardar() {
    if (!actual || !editable) return;
    const n = Number(bateria); if (!/^\d+$/.test(bateria) || !Number.isInteger(n) || n < 0 || n > 100) { setError("La batería debe ser un entero entre 0 y 100."); return; }
    setGuardando(true); setError(""); setOk("");
    try { const d = await actualizarDispositivo(establecimientoId, actual.id, { apodo: nombre, bateriaPorcentaje: n, conexion, loteAsignadoId: loteAsignadoId || null }); setDispositivos((xs) => xs.map((x) => x.id === d.id ? d : x)); setOk("Cambios guardados."); avisarCambioNotificaciones(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "No se pudieron guardar los cambios."); }
    finally { setGuardando(false); }
  }
  async function guardarResponsable(dispositivoId: string, puestoId: string | null) {
    setGuardando(true); setError(""); setOk("");
    try { await asignarResponsableGps(establecimientoId, dispositivoId, puestoId); setGpsResponsables(xs => xs.map(x => x.id === dispositivoId ? { ...x, puestoOperativoId: puestoId } : x)); setOk("Responsable GPS actualizado."); avisarCambioNotificaciones(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "No se pudo guardar el responsable GPS."); }
    finally { setGuardando(false); }
  }
  return <PantallaDatos volanta={establecimiento?.nombre ?? "Establecimiento"} titulo="Mis dispositivos" subtitulo="Dos GPS virtuales conectados al mapa. Sus ubicaciones, batería y configuración son simuladas y se guardan en tu cuenta.">
    {cargando ? <EstadoDePantalla>Cargando dispositivos…</EstadoDePantalla> : <div className="space-y-6">
      <p className={VOLANTA}>SIMULACIÓN · NO SON DATOS REALES DEL CAMPO</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{ok && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{ok}</p>}
      {membresia?.rol === "PROPIETARIO" && <section className={`${TARJETA} max-w-2xl p-6`}><h2 className={TITULO_SECCION}>Administradores responsables por GPS</h2><p className="mt-2 text-sm text-gray-600">Las alertas de cada GPS llegan a los propietarios y al administrador asignado. Solo aparecen administradores activos con permiso de lectura GPS.</p><div className="mt-4 grid gap-4">{gpsResponsables.map(g => <label key={g.id} className="grid gap-1 text-sm"><span>GPS simulado {g.numero} · {g.apodo} · {g.username}</span><select value={g.puestoOperativoId ?? ""} disabled={guardando} onChange={e => void guardarResponsable(g.id, e.target.value || null)} className="rounded-lg border border-gray-300 px-3 py-2"><option value="">Sin administrador asignado</option>{administradoresGps.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>)}</div></section>}
      <div className="grid gap-4 sm:grid-cols-2">{dispositivos.map((d) => <button key={d.id} type="button" onClick={() => setSeleccionado(d.id)} className={`${TARJETA} p-4 text-left ${seleccionado === d.id ? "ring-2 ring-[var(--color-lima)]" : ""}`}><span className={VOLANTA}>GPS simulado {d.numero}</span><strong className="mt-1 block">{d.apodo}</strong><span className="mt-2 block text-sm">Batería: {d.bateriaPorcentaje}% · {d.condicionBateria === "critica" ? "Crítica" : d.condicionBateria === "baja" ? "Baja" : "Normal"} · {d.conexion === "en-linea" ? "En línea" : "Sin señal"}</span>{(d.incidenciasActivas?.length ?? 0) > 0 && <span className="mt-1 block text-sm font-semibold text-red-700">Tiene {d.incidenciasActivas?.length} incidencia(s) activa(s)</span>}</button>)}</div>
      {actual && <section className={`${TARJETA} max-w-2xl p-6`}><h2 className={TITULO_SECCION}>GPS simulado {actual.numero}</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">Ubicación actual</dt><dd>{actual.latitud?.toFixed(5)}, {actual.longitud?.toFixed(5)}</dd></div><div><dt className="text-gray-500">Establecimiento</dt><dd>{actual.dentroEstablecimiento ? "Dentro" : "Fuera"}</dd></div><div><dt className="text-gray-500">Lote actual detectado</dt><dd>{actual.loteActual ? `Lote ${actual.loteActual.numero}${actual.loteActual.apodo ? ` · ${actual.loteActual.apodo}` : ""}` : "Ninguno"}</dd></div><div><dt className="text-gray-500">Lote asignado</dt><dd>{actual.loteAsignado ? `Lote ${actual.loteAsignado.numero}${actual.loteAsignado.apodo ? ` · ${actual.loteAsignado.apodo}` : ""}` : "Sin lote asignado"}</dd></div><div><dt className="text-gray-500">Actualizado</dt><dd>{actual.actualizadaEn ? new Date(actual.actualizadaEn).toLocaleString("es-AR") : "Sin datos"}</dd></div><div><dt className="text-gray-500">Estado simulado</dt><dd>{actual.conexion === "en-linea" ? "En línea" : "Sin señal"}</dd></div></dl>
        {(actual.incidenciasActivas?.length ?? 0) > 0 && <div role="status" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Incidencias activas</strong><ul className="mt-1 list-disc pl-5">{actual.incidenciasActivas?.map(tipo => <li key={tipo}>{etiquetaIncidencia(tipo, actual.condicionBateria)}</li>)}</ul></div>}
        {editable ? <div className="mt-5 grid gap-4"><label className="grid gap-1 text-sm">Apodo<input maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" /></label><label className="grid gap-1 text-sm">Batería simulada: {bateria}%<div className="flex gap-3"><input type="range" min="0" max="100" value={bateria || 0} onChange={(e) => setBateria(e.target.value)} className="flex-1"/><input type="number" min="0" max="100" step="1" value={bateria} onChange={(e) => setBateria(e.target.value)} className="w-20 rounded-lg border border-gray-300 px-2 py-1"/></div></label><label className="grid gap-1 text-sm">Conexión simulada<select value={conexion} onChange={(e) => setConexion(e.target.value as "en-linea" | "sin-senal")} className="rounded-lg border border-gray-300 px-3 py-2"><option value="en-linea">En línea</option><option value="sin-senal">Sin señal</option></select></label><label className="grid gap-1 text-sm">Lote asignado<select value={loteAsignadoId} onChange={e => setLoteAsignadoId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2"><option value="">Sin lote asignado</option>{lotes.map(l => <option key={l.id} value={l.id}>Lote {l.numero}{l.apodo ? ` · ${l.apodo}` : ""}</option>)}</select></label><Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Button></div> : <p className="mt-5 text-sm text-gray-600">Tenés permiso de lectura. Para editar este GPS, el propietario debe habilitar «Modificar dispositivos GPS» en Equipo.</p>}
      </section>}
    </div>}
  </PantallaDatos>;
}
