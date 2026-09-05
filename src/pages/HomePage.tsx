import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import MapView from "../components/MapView";
import type { CondicionVisual, MapEngineHandle } from "../components/MapEngine";
import Sidebar, { type DrawMode } from "../components/Sidebar";
import CondicionPanel from "../components/CondicionPanel";
import PromptModal from "../components/PromptModal";
import ConfirmModal from "../components/ConfirmModal";
import SugerenciasPanel from "../components/SugerenciasPanel";
import CampoBackdrop from "../components/ui/CampoBackdrop";
import PillButton from "../components/ui/PillButton";
import RodeoLogo from "../components/ui/RodeoLogo";
import { areaHectareas, isFullyContained, polygonsOverlap } from "../geo";
import { iaDisponible as consultarIaDisponible, sugerirLotes as pedirSugerencias } from "../api/ia";
import type { MetaSugerencias, SugerenciaLote } from "../ia/types";
import { actualizarSateliteLotes, credencialesListas } from "../copernicus/api";
import { COLOR_CATEGORIA, COLOR_RADAR, COLOR_SIN_DATOS, ETIQUETA_CATEGORIA } from "../copernicus/presentacion";
import type { ResultadoLote } from "../copernicus/types";
import { actualizarClimaLotes } from "../clima/api";
import type { ResultadoClimaLote } from "../clima/types";
import ClimaPanel from "../components/ClimaPanel";
import type { Establecimiento, Lote, PolygonFeature } from "../types";
import { marcarGanadoEn } from "../demo/ganadoSimulado";
import { getCurrentUser, type UsuarioAutenticado } from "../api/auth";
import { ApiError } from "../api/client";
import { actualizarEstablecimiento, actualizarLote, crearEstablecimiento, crearLote, eliminarLote, obtenerEstablecimiento, obtenerLotes } from "../api/rodeo";

type Modal =
  | { type: "nombre-establecimiento"; polygon: PolygonFeature }
  | { type: "rename-establecimiento" }
  | { type: "rename-lote"; loteId: string }
  | { type: "confirm-delete-lote"; loteId: string };

interface Notice { kind: "error" | "warning" | "success"; text: string }
interface HomePageProps {
  usuario: UsuarioAutenticado;
  onUserUpdated: (user: UsuarioAutenticado) => void;
  onLogout: () => Promise<void>;
}

const NOTICE_TONE: Record<Notice["kind"], string> = {
  error: "border-red-300 bg-red-100 text-red-800",
  warning: "border-amber-300 bg-amber-100 text-amber-800",
  success: "border-green-300 bg-green-100 text-green-800",
};

function mensajeApi(error: unknown): string {
  if (!(error instanceof ApiError)) return "No se pudo completar la operación. Intentá nuevamente.";
  if (error.code === "LOT_OUTSIDE_ESTABLISHMENT") return "El lote debe quedar completamente dentro del establecimiento.";
  if (error.code === "LOT_OVERLAPS_EXISTING") return "El lote se superpone con otro lote no eliminado.";
  if (error.code === "ESTABLISHMENT_GEOMETRY_INVALID") return "El nuevo límite dejaría algún lote fuera del establecimiento.";
  if (error.code === "IA_NOT_CONFIGURED") return "La sugerencia con IA no está configurada en este backend.";
  if (error.code === "IA_UNREACHABLE") return "No se pudo contactar al servicio de IA. Verificá que el microservicio esté levantado.";
  return error.message;
}

export default function HomePage({ usuario, onUserUpdated, onLogout }: HomePageProps) {
  const navigate = useNavigate();
  const [establecimiento, setEstablecimiento] = useState<Establecimiento | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [datosCargando, setDatosCargando] = useState(true);
  const [datosError, setDatosError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("idle");
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [editingLoteId, setEditingLoteId] = useState<string | null>(null);
  const [showInactivos, setShowInactivos] = useState(false);
  const [selectedLoteId, setSelectedLoteId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resultados, setResultados] = useState<Record<string, ResultadoLote>>({});
  const [analizando, setAnalizando] = useState(false);
  const [ultimoAnalisis, setUltimoAnalisis] = useState<number | null>(null);
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);
  const [credencialesOk, setCredencialesOk] = useState<boolean | null>(null);
  const [resultadosClima, setResultadosClima] = useState<Record<string, ResultadoClimaLote>>({});
  const [climaConsultando, setClimaConsultando] = useState(false);
  const [gpsLoteDetectado, setGpsLoteDetectado] = useState<Lote | null>(null);
  // Propuesta de subdivisión: vive sólo acá hasta que el usuario la confirme.
  const [iaConfigurada, setIaConfigurada] = useState(false);
  const [iaGenerando, setIaGenerando] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<SugerenciaLote[]>([]);
  const [sugerenciasMeta, setSugerenciasMeta] = useState<MetaSugerencias | null>(null);
  const [sugerenciasExcluidas, setSugerenciasExcluidas] = useState<string[]>([]);
  const [sugerenciaEnEdicionId, setSugerenciaEnEdicionId] = useState<string | null>(null);
  const [confirmandoSugerencias, setConfirmandoSugerencias] = useState(false);
  const mapRef = useRef<MapEngineHandle>(null);

  useEffect(() => {
    let vigente = true;
    setDatosCargando(true);
    setDatosError(null);
    (async () => {
      const establecimientoActual = await obtenerEstablecimiento();
      const lotesActuales = establecimientoActual ? await obtenerLotes() : [];
      if (vigente) {
        setEstablecimiento(establecimientoActual);
        setLotes(lotesActuales);
      }
    })().catch((error: unknown) => {
      if (vigente) setDatosError(mensajeApi(error));
    }).finally(() => {
      if (vigente) setDatosCargando(false);
    });
    return () => { vigente = false; };
  }, [usuario.id]);

  // El GPS simulado habilita la herramienta de demo de la ficha. Se sincroniza
  // desde un efecto y no desde el callback del mapa a propósito: al navegar a
  // la ficha, `GpsSimulado` avisa `null` mientras se desmonta, y ese aviso no
  // tiene que apagar la demo del lote al que se está entrando.
  useEffect(() => { marcarGanadoEn(gpsLoteDetectado?.id ?? null); }, [gpsLoteDetectado]);

  useEffect(() => {
    let vigente = true;
    credencialesListas().then((ok) => { if (vigente) setCredencialesOk(ok); });
    consultarIaDisponible().then((ok) => { if (vigente) setIaConfigurada(ok); });
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (!establecimiento) { setResultadosClima({}); return; }
    let vigente = true;
    setClimaConsultando(true);
    actualizarClimaLotes(lotes.filter((lote) => lote.activo).map((lote) => lote.id), "automatico").then((resultado) => {
      if (vigente) {
        setResultadosClima(resultado);
        setClimaConsultando(false);
      }
    });
    return () => { vigente = false; };
  }, [establecimiento?.id]);

  const onboardingStep = !usuario.onboardingCompleted ? establecimiento ? 2 : 1 : undefined;
  const lotesActivos = lotes.filter((lote) => lote.activo);
  const lotesVisiblesParaMapa = useMemo(
    () => lotes.filter((lote) => lote.activo || showInactivos),
    [lotes, showInactivos],
  );

  function startEstablecimiento() { if (guardando) return; setNotice(null); setDrawMode("establecimiento"); mapRef.current?.startDrawEstablecimiento(); }
  function startLote() { if (guardando) return; setNotice(null); setDrawMode("lote"); mapRef.current?.startDrawLote(); }
  function cancelDraw() { mapRef.current?.cancelDraw(); setDrawMode("idle"); }
  function onEstablecimientoDrawn(polygon: PolygonFeature) { setDrawMode("idle"); setModal({ type: "nombre-establecimiento", polygon }); }

  function onLoteDrawn(polygon: PolygonFeature) {
    setDrawMode("idle");
    if (!establecimiento) return;
    if (!isFullyContained(polygon, establecimiento.polygon)) {
      setNotice({ kind: "error", text: "El lote debe quedar completamente dentro del límite del establecimiento." }); return;
    }
    const solapado = lotes.find((lote) => polygonsOverlap(polygon, lote.polygon));
    if (solapado) {
      setNotice({ kind: "error", text: `El lote se superpone con el Lote ${solapado.numero}. Ajustá los límites para que no se pisen.` }); return;
    }
    setGuardando(true);
    crearLote(polygon).then((lote) => {
      setLotes((actuales) => [...actuales, lote]);
      setSelectedLoteId(lote.id);
      return getCurrentUser();
    }).then((user) => { if (user) onUserUpdated(user); })
      .catch((error: unknown) => setNotice({ kind: "error", text: mensajeApi(error) }))
      .finally(() => setGuardando(false));
  }

  function onBoundaryEdited(polygon: PolygonFeature) {
    if (!establecimiento) return;
    const anterior = establecimiento;
    // La propuesta se calculó contra el límite viejo: cambiado el límite, ya no
    // es válida y no se puede seguir mostrando como si lo fuera.
    descartarSugerencias();
    setEditingBoundary(false);
    setGuardando(true);
    actualizarEstablecimiento({ polygon })
      .then(setEstablecimiento)
      .catch((error: unknown) => { setEstablecimiento(anterior); setNotice({ kind: "error", text: mensajeApi(error) }); })
      .finally(() => setGuardando(false));
  }

  function startEditLote(id: string) {
    if (guardando || editingBoundary || editingLoteId) return;
    setNotice(null);
    setEditingLoteId(id);
    mapRef.current?.startEditLote(id);
  }

  function saveEditLote() {
    if (guardando || !editingLoteId) return;
    mapRef.current?.saveEditLote();
  }

  function cancelEditLote() {
    if (guardando || !editingLoteId) return;
    mapRef.current?.cancelEditLote();
    setEditingLoteId(null);
  }

  function onLoteEdited(id: string, polygon: PolygonFeature) {
    const anterior = lotes.find((lote) => lote.id === id);
    if (!anterior) {
      setEditingLoteId(null);
      return;
    }
    setGuardando(true);
    actualizarLote(id, { polygon })
      .then((actualizado) => setLotes((items) => items.map((item) => item.id === id ? actualizado : item)))
      .catch((error: unknown) => {
        setLotes((items) => items.map((item) => item.id === id ? anterior : item));
        setNotice({ kind: "error", text: mensajeApi(error) });
      })
      .finally(() => { setGuardando(false); setEditingLoteId(null); });
  }

  async function generarSugerencias() {
    if (iaGenerando || !establecimiento || drawMode !== "idle" || editingBoundary || editingLoteId) return;
    setIaError(null);
    setNotice(null);
    setIaGenerando(true);
    try {
      const respuesta = await pedirSugerencias();
      setSugerencias(respuesta.sugerencias);
      setSugerenciasMeta(respuesta.meta);
      setSugerenciasExcluidas([]);
      // Sin detecciones no se inventa nada: se lo decimos y sigue a mano.
      if (respuesta.sugerencias.length === 0) {
        setIaError("La IA no encontró divisiones claras en la imagen de tu establecimiento. Marcá los lotes a mano.");
      }
    } catch (error: unknown) {
      setIaError(mensajeApi(error));
    } finally {
      setIaGenerando(false);
    }
  }

  function descartarSugerencias() {
    if (confirmandoSugerencias) return;
    if (sugerenciaEnEdicionId) {
      mapRef.current?.cancelEditSugerencia();
      setSugerenciaEnEdicionId(null);
    }
    setSugerencias([]);
    setSugerenciasMeta(null);
    setSugerenciasExcluidas([]);
    setIaError(null);
  }

  function toggleSugerencia(id: string) {
    if (sugerenciaEnEdicionId || confirmandoSugerencias) return;
    setSugerenciasExcluidas((actuales) => actuales.includes(id) ? actuales.filter((item) => item !== id) : [...actuales, id]);
  }

  function editarSugerencia(id: string) {
    if (sugerenciaEnEdicionId || confirmandoSugerencias) return;
    setNotice(null);
    setSugerenciaEnEdicionId(id);
    mapRef.current?.startEditSugerencia(id);
  }

  function onSugerenciaEditada(id: string, polygon: PolygonFeature) {
    setSugerenciaEnEdicionId(null);
    if (!establecimiento) return;
    // Mismas reglas que un lote dibujado a mano: si el ajuste no es válido, se
    // avisa y la propuesta vuelve a como estaba, sin guardar nada.
    if (!isFullyContained(polygon, establecimiento.polygon)) {
      setNotice({ kind: "error", text: "El ajuste dejaría la propuesta fuera del establecimiento. Se restauró el borde anterior." });
      return;
    }
    const loteSolapado = lotes.find((lote) => polygonsOverlap(polygon, lote.polygon));
    if (loteSolapado) {
      setNotice({ kind: "error", text: `El ajuste se superpone con el Lote ${loteSolapado.numero}. Se restauró el borde anterior.` });
      return;
    }
    if (sugerencias.some((otra) => otra.id !== id && polygonsOverlap(polygon, otra.polygon))) {
      setNotice({ kind: "error", text: "El ajuste se superpone con otra propuesta. Se restauró el borde anterior." });
      return;
    }
    setSugerencias((actuales) => actuales.map((sugerencia) => sugerencia.id === id
      ? { ...sugerencia, polygon, hectareas: Number(areaHectareas(polygon).toFixed(2)) }
      : sugerencia));
  }

  async function confirmarSugerencias() {
    if (confirmandoSugerencias || sugerenciaEnEdicionId) return;
    const elegidas = sugerencias.filter((sugerencia) => !sugerenciasExcluidas.includes(sugerencia.id));
    if (!elegidas.length) return;
    setConfirmandoSugerencias(true);
    setNotice(null);
    const creados: Lote[] = [];
    const errores: string[] = [];
    // Uno por uno contra el endpoint de siempre: la numeración es secuencial y
    // cada lote pasa por las validaciones del backend, no por un atajo.
    for (const sugerencia of elegidas) {
      try { creados.push(await crearLote(sugerencia.polygon)); }
      catch (error: unknown) { errores.push(mensajeApi(error)); }
    }
    if (creados.length) {
      setLotes((actuales) => [...actuales, ...creados]);
      setSelectedLoteId(creados[0].id);
      const user = await getCurrentUser().catch(() => null);
      if (user) onUserUpdated(user);
    }
    setSugerencias([]);
    setSugerenciasMeta(null);
    setSugerenciasExcluidas([]);
    setNotice(errores.length
      ? { kind: creados.length ? "warning" : "error", text: `Se crearon ${creados.length} de ${elegidas.length} lotes. ${errores[0]}` }
      : { kind: "success", text: `Se crearon ${creados.length} lote${creados.length === 1 ? "" : "s"} desde la propuesta de la IA.` });
    setConfirmandoSugerencias(false);
  }

  function selectLote(id: string) {
    if (drawMode !== "idle" || editingBoundary || editingLoteId) return;
    setSelectedLoteId(id);
    const lote = lotes.find((item) => item.id === id);
    if (lote) mapRef.current?.flyTo(lote.polygon);
  }
  function openFicha(id: string) {
    if (drawMode !== "idle" || editingBoundary || editingLoteId) return;
    navigate(`/lotes/${id}`);
  }
  function toggleActivo(id: string) {
    const lote = lotes.find((item) => item.id === id); if (!lote) return;
    setGuardando(true);
    actualizarLote(id, { activo: !lote.activo }).then((actualizado) => setLotes((items) => items.map((item) => item.id === id ? actualizado : item)))
      .catch((error: unknown) => setNotice({ kind: "error", text: mensajeApi(error) })).finally(() => setGuardando(false));
  }
  function confirmDeleteLote() {
    if (guardando || !modal || modal.type !== "confirm-delete-lote") return;
    const id = modal.loteId; setGuardando(true);
    eliminarLote(id).then(() => { setLotes((items) => items.filter((item) => item.id !== id)); setSelectedLoteId((current) => current === id ? null : current); setModal(null); })
      .catch((error: unknown) => setNotice({ kind: "error", text: mensajeApi(error) })).finally(() => setGuardando(false));
  }
  function confirmModal(value: string) {
    if (guardando || !modal) return;
    setGuardando(true);
    const action = modal.type === "nombre-establecimiento"
      ? crearEstablecimiento(value, modal.polygon).then(setEstablecimiento)
      : modal.type === "rename-establecimiento"
        ? actualizarEstablecimiento({ nombre: value }).then(setEstablecimiento)
        : actualizarLote(modal.loteId, { apodo: value }).then((actualizado) => setLotes((items) => items.map((item) => item.id === actualizado.id ? actualizado : item)));
    action.catch((error: unknown) => setNotice({ kind: "error", text: mensajeApi(error) })).finally(() => { setGuardando(false); setModal(null); });
  }
  async function actualizarClima() { if (climaConsultando || !lotesActivos.length) return; setClimaConsultando(true); const resultado = await actualizarClimaLotes(lotesActivos.map((lote) => lote.id), "manual"); setResultadosClima(resultado); setClimaConsultando(false); }
  async function analizar() {
    if (analizando || !lotesActivos.length) return; setAnalizando(true); setErrorAnalisis(null);
    try { const respuestas = await actualizarSateliteLotes(lotesActivos.map((lote) => lote.id)); const porLote: Record<string, ResultadoLote> = {}; respuestas.forEach((respuesta) => { porLote[respuesta.loteId] = respuesta; }); setResultados(porLote); setUltimoAnalisis(Date.now()); const errores = respuestas.filter((respuesta) => respuesta.estado === "error"); if (errores.length) setErrorAnalisis(errores.length === respuestas.length ? errores[0].mensaje : `${errores.length} de ${respuestas.length} lotes no se pudieron consultar.`); }
    finally { setAnalizando(false); }
  }
  const condicionPorLote = useMemo(() => {
    const resultado: Record<string, CondicionVisual> = {};
    Object.values(resultados).forEach((item) => {
      if (item.estado === "ok") resultado[item.loteId] = { color: COLOR_CATEGORIA[item.condicion.categoria], etiqueta: `${ETIQUETA_CATEGORIA[item.condicion.categoria]} · ${item.condicion.puntaje}/100 · NDVI ${item.condicion.ndvi.mediana.toFixed(2)}` };
      else if (item.estado === "radar") resultado[item.loteId] = { color: COLOR_RADAR, etiqueta: `Radar Sentinel-1 · RVI ${item.condicion.rvi.mediana.toFixed(2)}` };
      else resultado[item.loteId] = { color: COLOR_SIN_DATOS, etiqueta: "Sin dato satelital reciente" };
    }); return resultado;
  }, [resultados]);

  if (datosCargando) return (
    <CampoBackdrop>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-[clamp(1rem,3vw,2.4rem)]"
        aria-live="polite"
      >
        <RodeoLogo className="w-[65vw] max-w-[560px]" />
        <p className="texto-foto m-0 text-[clamp(1rem,2.2vw,1.75rem)] tracking-[-0.03em] text-white">
          Cargando tus datos...
        </p>
      </div>
    </CampoBackdrop>
  );
  if (datosError) return (
    <CampoBackdrop>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[clamp(1rem,3vw,2.4rem)] px-6">
        <RodeoLogo className="w-[52vw] max-w-[420px]" />
        <p
          role="alert"
          className="max-w-[46rem] rounded-2xl border-2 border-white/70 bg-red-900/40 px-[clamp(0.75rem,2vw,1.5rem)] py-[clamp(0.5rem,1.2vw,0.9rem)] text-center text-[clamp(0.85rem,1.9vw,1.5rem)] text-white"
        >
          {datosError}
        </p>
        <PillButton onClick={() => window.location.reload()}>Reintentar</PillButton>
      </div>
    </CampoBackdrop>
  );

  return <div className="relative flex h-screen w-screen">
    <Sidebar establecimiento={establecimiento} lotes={lotes} showInactivos={showInactivos} selectedLoteId={selectedLoteId} drawMode={drawMode} editingBoundary={editingBoundary} editingLoteId={editingLoteId} onboardingStep={onboardingStep} guardando={guardando} onToggleShowInactivos={() => setShowInactivos((v) => !v)} onSelectLote={selectLote} onOpenFicha={openFicha} onStartDrawEstablecimiento={startEstablecimiento} onStartDrawLote={startLote} onCancelDraw={cancelDraw} onStartEditBoundary={() => { if (!editingLoteId) { setEditingBoundary(true); mapRef.current?.startEditBoundary(); } }} onSaveEditBoundary={() => mapRef.current?.saveEditBoundary()} onCancelEditBoundary={() => { mapRef.current?.cancelEditBoundary(); setEditingBoundary(false); }} onStartEditLote={startEditLote} onSaveEditLote={saveEditLote} onCancelEditLote={cancelEditLote} onRenameEstablecimiento={() => setModal({ type: "rename-establecimiento" })} onDeleteEstablecimiento={() => setNotice({ kind: "warning", text: "La eliminación del establecimiento está pendiente." })} onRenameLote={(id) => setModal({ type: "rename-lote", loteId: id })} onToggleActivoLote={toggleActivo} onDeleteLote={(id) => setModal({ type: "confirm-delete-lote", loteId: id })} usuarioNombre={usuario.username} onLogout={onLogout} iaDisponible={iaConfigurada} iaGenerando={iaGenerando} iaError={iaError} onSugerirLotes={generarSugerencias} panelSugerencias={sugerencias.length > 0 ? (
      <SugerenciasPanel
        variante={onboardingStep ? "vidrio" : "claro"}
        sugerencias={sugerencias}
        excluidas={sugerenciasExcluidas}
        meta={sugerenciasMeta}
        editandoId={sugerenciaEnEdicionId}
        confirmando={confirmandoSugerencias}
        onToggle={toggleSugerencia}
        onEditar={editarSugerencia}
        onGuardarEdicion={() => mapRef.current?.saveEditSugerencia()}
        onCancelarEdicion={() => { mapRef.current?.cancelEditSugerencia(); setSugerenciaEnEdicionId(null); }}
        onConfirmar={confirmarSugerencias}
        onDescartar={descartarSugerencias}
      />
    ) : undefined} panelClima={<ClimaPanel lotesActivos={lotesActivos} resultados={resultadosClima} consultando={climaConsultando} selectedLoteId={selectedLoteId} onActualizar={actualizarClima} onSelectLote={selectLote} />} panelCondicion={<CondicionPanel lotesActivos={lotesActivos} resultados={resultados} analizando={analizando} ultimoAnalisis={ultimoAnalisis} errorGlobal={errorAnalisis} credencialesOk={credencialesOk} selectedLoteId={selectedLoteId} onAnalizar={analizar} onSelectLote={selectLote} />} />
    {/* Velo oscuro del lado de la sidebar. En el onboarding la sidebar flota
        sobre el mapa y sin esto el texto blanco cae sobre imagen satelital
        clara. No intercepta clicks: el mapa sigue usable por debajo. */}
    {onboardingStep && (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-[1100] w-[54%] bg-[linear-gradient(90deg,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.92)_35%,rgba(0,0,0,0)_100%)]"
      />
    )}
    <main className="relative h-full flex-1">
      {notice && <div className={`absolute top-3 left-1/2 z-[1000] flex max-w-[80%] -translate-x-1/2 items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-[0.9rem] shadow-[0_2px_8px_rgba(0,0,0,0.15)] ${NOTICE_TONE[notice.kind]}`}><span>{notice.text}</span><button className="cursor-pointer border-0 bg-transparent text-[1.1rem] leading-none text-inherit" onClick={() => setNotice(null)}>×</button></div>}
      {gpsLoteDetectado && (
        <div className="absolute top-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-white/10 bg-slate-900/95 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <span className="flex h-2 w-2 flex-none animate-pulse rounded-full bg-red-500" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <span className="text-[0.9rem] font-semibold text-white">
              Ganado detectado en {gpsLoteDetectado.apodo ? `Lote ${gpsLoteDetectado.numero} — ${gpsLoteDetectado.apodo}` : `Lote ${gpsLoteDetectado.numero}`}
            </span>
            <span className="text-[0.65rem] font-medium tracking-wide text-slate-400">
              Simulación de GPS · no es un dato real
            </span>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-white/25 bg-white/10 px-2.5 py-1.5 text-[0.75rem] font-semibold text-white transition-colors hover:bg-white/20"
            onClick={() => openFicha(gpsLoteDetectado.id)}
          >
            Ver ficha
          </button>
        </div>
      )}
      <MapView ref={mapRef} establecimiento={establecimiento} lotesVisibles={lotesVisiblesParaMapa} lotesActivos={lotesActivos} selectedLoteId={selectedLoteId} condicionPorLote={condicionPorLote} onEstablecimientoDrawn={onEstablecimientoDrawn} onLoteDrawn={onLoteDrawn} onBoundaryEdited={onBoundaryEdited} onLoteEdited={onLoteEdited} onSelectLote={selectLote} onGpsLoteConfirmado={setGpsLoteDetectado} sugerencias={sugerencias} sugerenciasExcluidas={sugerenciasExcluidas} sugerenciaEnEdicionId={sugerenciaEnEdicionId} onToggleSugerencia={toggleSugerencia} onSugerenciaEditada={onSugerenciaEditada} />
    </main>
    {modal?.type === "nombre-establecimiento" && <PromptModal title="Nombrá tu establecimiento" label="Nombre" placeholder="Ej. Estancia Los Álamos" confirmText="Crear" onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "rename-establecimiento" && establecimiento && <PromptModal title="Renombrar establecimiento" label="Nombre" initialValue={establecimiento.nombre} onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "rename-lote" && <PromptModal title="Apodo del lote" label="Apodo" placeholder="Ej. Molino" initialValue={lotes.find((lote) => lote.id === modal.loteId)?.apodo ?? ""} onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "confirm-delete-lote" && <ConfirmModal title="Eliminar lote" message="¿Seguro que querés eliminar este lote? Esta acción conserva su historial." onConfirm={confirmDeleteLote} onCancel={() => setModal(null)} />}
  </div>;
}
