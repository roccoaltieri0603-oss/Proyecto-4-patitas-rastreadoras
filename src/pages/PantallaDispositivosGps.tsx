import { useEffect, useState } from "react";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { actualizarDispositivo, obtenerDispositivos, type Dispositivo } from "../api/dispositivos";
import Button from "../components/ui/Button";
import PantallaDatos, { EstadoDePantalla, TARJETA, TITULO_SECCION, VOLANTA } from "../components/ui/PantallaDatos";

export default function PantallaDispositivosGps() {
  const { establecimientoId, establecimiento, membresia } = useEstablecimiento();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]); const [seleccionado, setSeleccionado] = useState("");
  const [nombre, setNombre] = useState(""); const [bateria, setBateria] = useState("0"); const [conexion, setConexion] = useState<"en-linea" | "sin-senal">("en-linea");
  const [cargando, setCargando] = useState(true); const [guardando, setGuardando] = useState(false); const [error, setError] = useState(""); const [ok, setOk] = useState("");
  const editable = membresia?.rol !== "VISOR";
  async function cargar() { setCargando(true); setError(""); try { const d = await obtenerDispositivos(establecimientoId); setDispositivos(d); setSeleccionado((s) => d.some((x) => x.id === s) ? s : d[0]?.id ?? ""); } catch (e) { setError(e instanceof ApiError ? e.message : "No se pudieron cargar los GPS simulados."); } finally { setCargando(false); } }
  useEffect(() => { void cargar(); }, [establecimientoId]);
  const actual = dispositivos.find((d) => d.id === seleccionado);
  useEffect(() => { if (actual) { setNombre(actual.apodo ?? ""); setBateria(String(actual.bateriaPorcentaje ?? 0)); setConexion(actual.conexion === "sin-senal" ? "sin-senal" : "en-linea"); } }, [actual?.id, actual?.apodo, actual?.bateriaPorcentaje, actual?.conexion]);
  useOcultarDock(cargando);
  if (membresia?.rol === "VISOR") return <Navigate to={`/establecimientos/${establecimientoId}`} replace />;
  async function guardar() {
    if (!actual || !editable) return;
    const n = Number(bateria); if (!/^\d+$/.test(bateria) || !Number.isInteger(n) || n < 0 || n > 100) { setError("La batería debe ser un entero entre 0 y 100."); return; }
    setGuardando(true); setError(""); setOk("");
    try { const d = await actualizarDispositivo(establecimientoId, actual.id, { apodo: nombre, bateriaPorcentaje: n, conexion }); setDispositivos((xs) => xs.map((x) => x.id === d.id ? d : x)); setOk("Cambios guardados."); }
    catch (e) { setError(e instanceof ApiError ? e.message : "No se pudieron guardar los cambios."); }
    finally { setGuardando(false); }
  }
  return <PantallaDatos volanta={establecimiento?.nombre ?? "Establecimiento"} titulo="Mis dispositivos" subtitulo="Dos GPS virtuales conectados al mapa. Sus ubicaciones, batería y configuración son simuladas y se guardan en tu cuenta.">
    {cargando ? <EstadoDePantalla>Cargando dispositivos…</EstadoDePantalla> : <div className="space-y-6">
      <p className={VOLANTA}>SIMULACIÓN · NO ES TELEMETRÍA REAL</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{ok && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{ok}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{dispositivos.map((d) => <button key={d.id} type="button" onClick={() => setSeleccionado(d.id)} className={`${TARJETA} p-4 text-left ${seleccionado === d.id ? "ring-2 ring-[var(--color-lima)]" : ""}`}><span className={VOLANTA}>GPS simulado {d.numero}</span><strong className="mt-1 block">{d.apodo}</strong><span className="mt-2 block text-sm">Batería simulada: {d.bateriaPorcentaje}% · {d.conexion === "en-linea" ? "En línea" : "Sin señal"}</span></button>)}</div>
      {actual && <section className={`${TARJETA} max-w-2xl p-6`}><h2 className={TITULO_SECCION}>GPS simulado {actual.numero}</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">Identificador interno</dt><dd className="break-all">{actual.id}</dd></div><div><dt className="text-gray-500">Ubicación actual</dt><dd>{actual.latitud?.toFixed(5)}, {actual.longitud?.toFixed(5)}</dd></div><div><dt className="text-gray-500">Actualizado</dt><dd>{actual.actualizadaEn ? new Date(actual.actualizadaEn).toLocaleString("es-AR") : "Sin datos"}</dd></div><div><dt className="text-gray-500">Estado simulado</dt><dd>{actual.conexion === "en-linea" ? "En línea" : "Sin señal"}</dd></div></dl>
        {editable ? <div className="mt-5 grid gap-4"><label className="grid gap-1 text-sm">Apodo<input maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" /></label><label className="grid gap-1 text-sm">Batería simulada: {bateria}%<div className="flex gap-3"><input type="range" min="0" max="100" value={bateria || 0} onChange={(e) => setBateria(e.target.value)} className="flex-1"/><input type="number" min="0" max="100" step="1" value={bateria} onChange={(e) => setBateria(e.target.value)} className="w-20 rounded-lg border border-gray-300 px-2 py-1"/></div></label><label className="grid gap-1 text-sm">Conexión simulada<select value={conexion} onChange={(e) => setConexion(e.target.value as "en-linea" | "sin-senal")} className="rounded-lg border border-gray-300 px-3 py-2"><option value="en-linea">En línea</option><option value="sin-senal">Sin señal</option></select></label><Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Button></div> : <p className="mt-5 text-sm text-gray-600">El rol Visor puede consultar la simulación, pero no modificarla.</p>}
      </section>}
    </div>}
  </PantallaDatos>;
}
