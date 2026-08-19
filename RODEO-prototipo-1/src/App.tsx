import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import type { CondicionVisual, MapEngineHandle } from "./components/MapEngine";
import Sidebar, { type DrawMode } from "./components/Sidebar";
import CondicionPanel from "./components/CondicionPanel";
import PromptModal from "./components/PromptModal";
import ConfirmModal from "./components/ConfirmModal";
import { loadState, saveState } from "./storage";
import { isFullyContained, polygonsOverlap } from "./geo";
import { analizarLotes, credencialesListas } from "./copernicus/api";
import {
  COLOR_CATEGORIA,
  COLOR_RADAR,
  COLOR_SIN_DATOS,
  ETIQUETA_CATEGORIA,
} from "./copernicus/scoring";
import type { ResultadoLote } from "./copernicus/types";
import { consultarClimaLotes } from "./clima/api";
import type { ResultadoClimaLote } from "./clima/types";
import ClimaPanel from "./components/ClimaPanel";
import type { Establecimiento, Lote, PolygonFeature, RodeoState } from "./types";
import "./App.css";

type Modal =
  | { type: "nombre-establecimiento"; polygon: PolygonFeature }
  | { type: "rename-establecimiento" }
  | { type: "rename-lote"; loteId: string }
  | { type: "confirm-delete-lote"; loteId: string }
  | { type: "confirm-delete-establecimiento" };

interface Notice {
  kind: "error" | "warning";
  text: string;
}

export default function App() {
  const [state, setState] = useState<RodeoState>(() => loadState());
  const [drawMode, setDrawMode] = useState<DrawMode>("idle");
  const [editingBoundary, setEditingBoundary] = useState(false);
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
    saveState(state);
  }, [state]);

  const establecimientoId = state.establecimiento?.id ?? null;

  useEffect(() => {
    if (!establecimientoId) {
      setResultadosClima({});
      return;
    }
    let vigente = true;
    const lotesActivos = state.lotes.filter((l) => l.activo);
    setClimaConsultando(true);
    consultarClimaLotes(lotesActivos).then((resultado) => {
      if (vigente) {
        setResultadosClima(resultado);
        setClimaConsultando(false);
      }
    });
    return () => {
      vigente = false;
    };
    // Se dispara al abrir/cambiar de establecimiento, con los lotes activos
    // de ese momento. Agregar un lote después no re-consulta solo: usar
    // "Actualizar" (evita disparar una consulta con cada lote que se dibuja).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establecimientoId]);

  useEffect(() => {
    let vigente = true;
    credencialesListas().then((ok) => {
      if (vigente) setCredencialesOk(ok);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const { establecimiento, lotes } = state;

  function handleStartDrawEstablecimiento() {
    setNotice(null);
    setDrawMode("establecimiento");
    mapRef.current?.startDrawEstablecimiento();
  }

  function handleStartDrawLote() {
    setNotice(null);
    setDrawMode("lote");
    mapRef.current?.startDrawLote();
  }

  function handleCancelDraw() {
    mapRef.current?.cancelDraw();
    setDrawMode("idle");
  }

  function handleEstablecimientoDrawn(polygon: PolygonFeature) {
    setDrawMode("idle");
    setModal({ type: "nombre-establecimiento", polygon });
  }

  function handleLoteDrawn(polygon: PolygonFeature) {
    setDrawMode("idle");
    if (!establecimiento) return;

    if (!isFullyContained(polygon, establecimiento.polygon)) {
      setNotice({
        kind: "error",
        text: "El lote debe quedar completamente dentro del límite del establecimiento. Intentá de nuevo.",
      });
      return;
    }

    const solapado = lotes.find((l) => l.activo && polygonsOverlap(polygon, l.polygon));
    if (solapado) {
      setNotice({
        kind: "error",
        text: `El lote se superpone con el Lote ${solapado.numero}${
          solapado.apodo ? ` (${solapado.apodo})` : ""
        }. Ajustá los límites para que no se pisen.`,
      });
      return;
    }

    const nuevoLote: Lote = {
      id: crypto.randomUUID(),
      numero: state.nextLoteNumero,
      apodo: "",
      polygon,
      activo: true,
      createdAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      lotes: [...prev.lotes, nuevoLote],
      nextLoteNumero: prev.nextLoteNumero + 1,
    }));
    setSelectedLoteId(nuevoLote.id);
    setNotice(null);
  }

  function handleBoundaryEdited(polygon: PolygonFeature) {
    if (!establecimiento) return;
    const actualizado: Establecimiento = { ...establecimiento, polygon };
    const fueraDeLimite = lotes.filter(
      (l) => l.activo && !isFullyContained(l.polygon, polygon),
    );
    setState((prev) => ({ ...prev, establecimiento: actualizado }));
    setEditingBoundary(false);
    if (fueraDeLimite.length > 0) {
      const nombres = fueraDeLimite.map((l) => `Lote ${l.numero}`).join(", ");
      setNotice({
        kind: "warning",
        text: `El nuevo límite dejó fuera a: ${nombres}. Revisá esos lotes.`,
      });
    }
  }

  function handleStartEditBoundary() {
    setNotice(null);
    setEditingBoundary(true);
    mapRef.current?.startEditBoundary();
  }

  function handleSaveEditBoundary() {
    mapRef.current?.saveEditBoundary();
  }

  function handleCancelEditBoundary() {
    mapRef.current?.cancelEditBoundary();
    setEditingBoundary(false);
  }

  function handleSelectLote(id: string) {
    setSelectedLoteId(id);
    const lote = lotes.find((l) => l.id === id);
    if (lote) mapRef.current?.flyTo(lote.polygon);
  }

  function handleToggleActivoLote(id: string) {
    setState((prev) => ({
      ...prev,
      lotes: prev.lotes.map((l) => (l.id === id ? { ...l, activo: !l.activo } : l)),
    }));
  }

  function handleConfirmDeleteLote() {
    if (!modal || modal.type !== "confirm-delete-lote") return;
    const id = modal.loteId;
    setState((prev) => ({ ...prev, lotes: prev.lotes.filter((l) => l.id !== id) }));
    setSelectedLoteId((current) => (current === id ? null : current));
    setResultados(({ [id]: _borrado, ...resto }) => resto);
    closeModal();
  }

  function handleConfirmDeleteEstablecimiento() {
    setState({ establecimiento: null, lotes: [], nextLoteNumero: 1 });
    setSelectedLoteId(null);
    setNotice(null);
    setResultados({});
    setUltimoAnalisis(null);
    closeModal();
  }

  function closeModal() {
    setModal(null);
  }

  function handleModalConfirm(value: string) {
    if (!modal) return;
    if (modal.type === "nombre-establecimiento") {
      const nuevo: Establecimiento = {
        id: crypto.randomUUID(),
        nombre: value,
        polygon: modal.polygon,
      };
      setState({ establecimiento: nuevo, lotes: [], nextLoteNumero: 1 });
    } else if (modal.type === "rename-establecimiento") {
      setState((prev) =>
        prev.establecimiento
          ? { ...prev, establecimiento: { ...prev.establecimiento, nombre: value } }
          : prev,
      );
    } else if (modal.type === "rename-lote") {
      setState((prev) => ({
        ...prev,
        lotes: prev.lotes.map((l) =>
          l.id === modal.loteId ? { ...l, apodo: value } : l,
        ),
      }));
    }
    closeModal();
  }

  const lotesActivosParaMapa = lotes.filter((l) => l.activo);

  async function handleActualizarClima() {
    if (climaConsultando || lotesActivosParaMapa.length === 0) return;
    setClimaConsultando(true);
    const resultado = await consultarClimaLotes(lotesActivosParaMapa);
    setResultadosClima(resultado);
    setClimaConsultando(false);
  }

  async function handleAnalizar() {
    if (analizando || lotesActivosParaMapa.length === 0) return;
    setAnalizando(true);
    setErrorAnalisis(null);
    try {
      const respuestas = await analizarLotes(lotesActivosParaMapa);
      const porLote: Record<string, ResultadoLote> = {};
      for (const respuesta of respuestas) porLote[respuesta.loteId] = respuesta;
      setResultados(porLote);
      setUltimoAnalisis(Date.now());

      const errores = respuestas.filter(
        (r): r is Extract<ResultadoLote, { estado: "error" }> => r.estado === "error",
      );
      // Si falló todo, casi siempre es un problema único (credenciales, red,
      // cuota) y conviene mostrarlo una sola vez arriba del ranking.
      if (errores.length === respuestas.length && errores.length > 0) {
        setErrorAnalisis(errores[0].mensaje);
      } else if (errores.length > 0) {
        setErrorAnalisis(
          `${errores.length} de ${respuestas.length} lotes no se pudieron consultar.`,
        );
      }
    } finally {
      setAnalizando(false);
    }
  }

  const condicionPorLote = useMemo(() => {
    const porLote: Record<string, CondicionVisual> = {};
    for (const resultado of Object.values(resultados)) {
      if (resultado.estado === "ok") {
        const { categoria, puntaje, ndvi } = resultado.condicion;
        porLote[resultado.loteId] = {
          color: COLOR_CATEGORIA[categoria],
          etiqueta: `${ETIQUETA_CATEGORIA[categoria]} · ${puntaje}/100 · NDVI ${ndvi.mediana.toFixed(2)}`,
        };
      } else if (resultado.estado === "radar") {
        const { rvi } = resultado.condicion;
        porLote[resultado.loteId] = {
          color: COLOR_RADAR,
          etiqueta: `Radar Sentinel-1 (respaldo) · RVI ${rvi.mediana.toFixed(2)}`,
        };
      } else {
        porLote[resultado.loteId] = {
          color: COLOR_SIN_DATOS,
          etiqueta: "Sin dato satelital reciente",
        };
      }
    }
    return porLote;
  }, [resultados]);

  return (
    <div className="app-layout">
      <Sidebar
        establecimiento={establecimiento}
        lotes={lotes}
        showInactivos={showInactivos}
        selectedLoteId={selectedLoteId}
        drawMode={drawMode}
        editingBoundary={editingBoundary}
        onToggleShowInactivos={() => setShowInactivos((v) => !v)}
        onSelectLote={handleSelectLote}
        onStartDrawEstablecimiento={handleStartDrawEstablecimiento}
        onStartDrawLote={handleStartDrawLote}
        onCancelDraw={handleCancelDraw}
        onStartEditBoundary={handleStartEditBoundary}
        onSaveEditBoundary={handleSaveEditBoundary}
        onCancelEditBoundary={handleCancelEditBoundary}
        onRenameEstablecimiento={() => setModal({ type: "rename-establecimiento" })}
        onDeleteEstablecimiento={() => setModal({ type: "confirm-delete-establecimiento" })}
        onRenameLote={(id) => setModal({ type: "rename-lote", loteId: id })}
        onToggleActivoLote={handleToggleActivoLote}
        onDeleteLote={(id) => setModal({ type: "confirm-delete-lote", loteId: id })}
        panelClima={
          <ClimaPanel
            lotesActivos={lotesActivosParaMapa}
            resultados={resultadosClima}
            consultando={climaConsultando}
            selectedLoteId={selectedLoteId}
            onActualizar={handleActualizarClima}
            onSelectLote={handleSelectLote}
          />
        }
        panelCondicion={
          <CondicionPanel
            lotesActivos={lotesActivosParaMapa}
            resultados={resultados}
            analizando={analizando}
            ultimoAnalisis={ultimoAnalisis}
            errorGlobal={errorAnalisis}
            credencialesOk={credencialesOk}
            selectedLoteId={selectedLoteId}
            onAnalizar={handleAnalizar}
            onSelectLote={handleSelectLote}
          />
        }
      />


      <main className="map-area">
        {notice && (
          <div className={`notice notice-${notice.kind}`}>
            <span>{notice.text}</span>
            <button className="notice-close" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}
        <MapView
          ref={mapRef}
          establecimiento={establecimiento}
          lotesVisibles={lotesActivosParaMapa}
          selectedLoteId={selectedLoteId}
          condicionPorLote={condicionPorLote}
          onEstablecimientoDrawn={handleEstablecimientoDrawn}
          onLoteDrawn={handleLoteDrawn}
          onBoundaryEdited={handleBoundaryEdited}
          onSelectLote={handleSelectLote}
        />
      </main>

      {modal && modal.type === "nombre-establecimiento" && (
        <PromptModal
          title="Nombrá tu establecimiento"
          label="Nombre"
          placeholder="Ej. Estancia Los Álamos"
          confirmText="Crear"
          onConfirm={handleModalConfirm}
          onCancel={closeModal}
        />
      )}
      {modal && modal.type === "rename-establecimiento" && establecimiento && (
        <PromptModal
          title="Renombrar establecimiento"
          label="Nombre"
          initialValue={establecimiento.nombre}
          onConfirm={handleModalConfirm}
          onCancel={closeModal}
        />
      )}
      {modal && modal.type === "rename-lote" && (
        <PromptModal
          title="Apodo del lote"
          label="Apodo"
          placeholder="Ej. Molino"
          initialValue={lotes.find((l) => l.id === modal.loteId)?.apodo ?? ""}
          onConfirm={handleModalConfirm}
          onCancel={closeModal}
        />
      )}
      {modal && modal.type === "confirm-delete-lote" && (
        <ConfirmModal
          title="Eliminar lote"
          message={(() => {
            const lote = lotes.find((l) => l.id === modal.loteId);
            const nombre = lote
              ? `Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ""}`
              : "este lote";
            return `¿Seguro que querés eliminar ${nombre}? Esta acción no se puede deshacer.`;
          })()}
          onConfirm={handleConfirmDeleteLote}
          onCancel={closeModal}
        />
      )}
      {modal && modal.type === "confirm-delete-establecimiento" && establecimiento && (
        <ConfirmModal
          title="Eliminar establecimiento"
          message={`¿Seguro que querés eliminar "${establecimiento.nombre}"? Se perderá su límite y vas a tener que dibujarlo de nuevo. Esta acción no se puede deshacer.`}
          onConfirm={handleConfirmDeleteEstablecimiento}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
