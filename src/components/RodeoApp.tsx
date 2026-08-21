import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import MapView from "./MapView";
import type { CondicionVisual, MapEngineHandle } from "./MapEngine";
import Sidebar, { type DrawMode } from "./Sidebar";
import CondicionPanel from "./CondicionPanel";
import PromptModal from "./PromptModal";
import ConfirmModal from "./ConfirmModal";
import { isFullyContained, polygonsOverlap } from "../geo";
import { actualizarSateliteLotes, credencialesListas } from "../copernicus/api";
import { COLOR_CATEGORIA, COLOR_RADAR, COLOR_SIN_DATOS, ETIQUETA_CATEGORIA } from "../copernicus/presentacion";
import type { ResultadoLote } from "../copernicus/types";
import { actualizarClimaLotes } from "../clima/api";
import type { ResultadoClimaLote } from "../clima/types";
import ClimaPanel from "./ClimaPanel";
import type { Establecimiento, Lote, PolygonFeature } from "../types";
import { getCurrentUser, type UsuarioAutenticado } from "../api/auth";
import { ApiError } from "../api/client";
import { actualizarEstablecimiento, actualizarLote, crearEstablecimiento, crearLote, eliminarLote, obtenerEstablecimiento, obtenerLotes } from "../api/rodeo";

type Modal =
  | { type: "nombre-establecimiento"; polygon: PolygonFeature }
  | { type: "rename-establecimiento" }
  | { type: "rename-lote"; loteId: string }
  | { type: "confirm-delete-lote"; loteId: string };

interface Notice { kind: "error" | "warning"; text: string }
interface Props {
  usuario: UsuarioAutenticado;
  onUserUpdated: (user: UsuarioAutenticado) => void;
  onLogout: () => Promise<void>;
}

function mensajeApi(error: unknown): string {
  if (!(error instanceof ApiError)) return "No se pudo completar la operación. Intentá nuevamente.";
  if (error.code === "LOT_OUTSIDE_ESTABLISHMENT") return "El lote debe quedar completamente dentro del establecimiento.";
  if (error.code === "LOT_OVERLAPS_EXISTING") return "El lote se superpone con otro lote no eliminado.";
  if (error.code === "ESTABLISHMENT_GEOMETRY_INVALID") return "El nuevo límite dejaría algún lote fuera del establecimiento.";
  return error.message;
}

export default function RodeoApp({ usuario, onUserUpdated, onLogout }: Props) {
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

  useEffect(() => {
    let vigente = true;
    credencialesListas().then((ok) => { if (vigente) setCredencialesOk(ok); });
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

  if (datosCargando) return <main className="auth-loading" aria-live="polite"><span className="auth-brand-mark">R</span><p>Cargando tus datos...</p></main>;
  if (datosError) return <main className="auth-loading"><p className="auth-error">{datosError}</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Reintentar</button></main>;

  return <div className="app-layout">
    <Sidebar establecimiento={establecimiento} lotes={lotes} showInactivos={showInactivos} selectedLoteId={selectedLoteId} drawMode={drawMode} editingBoundary={editingBoundary} editingLoteId={editingLoteId} onboardingStep={onboardingStep} guardando={guardando} onToggleShowInactivos={() => setShowInactivos((v) => !v)} onSelectLote={selectLote} onOpenFicha={openFicha} onStartDrawEstablecimiento={startEstablecimiento} onStartDrawLote={startLote} onCancelDraw={cancelDraw} onStartEditBoundary={() => { if (!editingLoteId) { setEditingBoundary(true); mapRef.current?.startEditBoundary(); } }} onSaveEditBoundary={() => mapRef.current?.saveEditBoundary()} onCancelEditBoundary={() => { mapRef.current?.cancelEditBoundary(); setEditingBoundary(false); }} onStartEditLote={startEditLote} onSaveEditLote={saveEditLote} onCancelEditLote={cancelEditLote} onRenameEstablecimiento={() => setModal({ type: "rename-establecimiento" })} onDeleteEstablecimiento={() => setNotice({ kind: "warning", text: "La eliminación del establecimiento está pendiente." })} onRenameLote={(id) => setModal({ type: "rename-lote", loteId: id })} onToggleActivoLote={toggleActivo} onDeleteLote={(id) => setModal({ type: "confirm-delete-lote", loteId: id })} usuarioNombre={usuario.username} onLogout={onLogout} panelClima={<ClimaPanel lotesActivos={lotesActivos} resultados={resultadosClima} consultando={climaConsultando} selectedLoteId={selectedLoteId} onActualizar={actualizarClima} onSelectLote={selectLote} />} panelCondicion={<CondicionPanel lotesActivos={lotesActivos} resultados={resultados} analizando={analizando} ultimoAnalisis={ultimoAnalisis} errorGlobal={errorAnalisis} credencialesOk={credencialesOk} selectedLoteId={selectedLoteId} onAnalizar={analizar} onSelectLote={selectLote} />} />
    <main className="map-area">
      {notice && <div className={`notice notice-${notice.kind}`}><span>{notice.text}</span><button className="notice-close" onClick={() => setNotice(null)}>×</button></div>}
      <MapView ref={mapRef} establecimiento={establecimiento} lotesVisibles={lotesVisiblesParaMapa} selectedLoteId={selectedLoteId} condicionPorLote={condicionPorLote} onEstablecimientoDrawn={onEstablecimientoDrawn} onLoteDrawn={onLoteDrawn} onBoundaryEdited={onBoundaryEdited} onLoteEdited={onLoteEdited} onSelectLote={selectLote} />
    </main>
    {modal?.type === "nombre-establecimiento" && <PromptModal title="Nombrá tu establecimiento" label="Nombre" placeholder="Ej. Estancia Los Álamos" confirmText="Crear" onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "rename-establecimiento" && establecimiento && <PromptModal title="Renombrar establecimiento" label="Nombre" initialValue={establecimiento.nombre} onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "rename-lote" && <PromptModal title="Apodo del lote" label="Apodo" placeholder="Ej. Molino" initialValue={lotes.find((lote) => lote.id === modal.loteId)?.apodo ?? ""} onConfirm={confirmModal} onCancel={() => setModal(null)} />}
    {modal?.type === "confirm-delete-lote" && <ConfirmModal title="Eliminar lote" message="¿Seguro que querés eliminar este lote? Esta acción conserva su historial." onConfirm={confirmDeleteLote} onCancel={() => setModal(null)} />}
  </div>;
}
