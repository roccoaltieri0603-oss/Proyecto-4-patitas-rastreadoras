import { type ReactNode, useState } from "react";
import type { Establecimiento, Lote } from "../types";
import { areaHectareas } from "../geo";

export type DrawMode = "idle" | "establecimiento" | "lote";
type Tab = "establecimiento" | "lotes" | "clima" | "condicion";

interface SidebarProps {
  establecimiento: Establecimiento | null;
  lotes: Lote[];
  showInactivos: boolean;
  selectedLoteId: string | null;
  drawMode: DrawMode;
  editingBoundary: boolean;
  onToggleShowInactivos: () => void;
  onSelectLote: (id: string) => void;
  onStartDrawEstablecimiento: () => void;
  onStartDrawLote: () => void;
  onCancelDraw: () => void;
  onStartEditBoundary: () => void;
  onSaveEditBoundary: () => void;
  onCancelEditBoundary: () => void;
  onRenameEstablecimiento: () => void;
  onDeleteEstablecimiento: () => void;
  onRenameLote: (id: string) => void;
  onToggleActivoLote: (id: string) => void;
  onDeleteLote: (id: string) => void;
  /** Panel de clima; se muestra en su propia sección. */
  panelClima?: ReactNode;
  /** Panel de condición satelital; se muestra en su propia sección. */
  panelCondicion?: ReactNode;
}

const TABS: { id: Tab; etiqueta: string }[] = [
  { id: "establecimiento", etiqueta: "Establecimiento" },
  { id: "lotes", etiqueta: "Lotes" },
  { id: "clima", etiqueta: "Clima" },
  { id: "condicion", etiqueta: "Condición" },
];

export default function Sidebar({
  establecimiento,
  lotes,
  showInactivos,
  selectedLoteId,
  drawMode,
  editingBoundary,
  onToggleShowInactivos,
  onSelectLote,
  onStartDrawEstablecimiento,
  onStartDrawLote,
  onCancelDraw,
  onStartEditBoundary,
  onSaveEditBoundary,
  onCancelEditBoundary,
  onRenameEstablecimiento,
  onDeleteEstablecimiento,
  onRenameLote,
  onToggleActivoLote,
  onDeleteLote,
  panelClima,
  panelCondicion,
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("lotes");

  const lotesVisibles = showInactivos ? lotes : lotes.filter((l) => l.activo);
  const superficieTotalHa = lotes
    .filter((l) => l.activo)
    .reduce((acc, l) => acc + areaHectareas(l.polygon), 0);
  const tieneLotes = lotes.length > 0;
  const lotesInactivosOcultos = !showInactivos ? lotes.filter((l) => !l.activo).length : 0;

  return (
    <aside className="sidebar">
      <h1 className="app-title">RODEO</h1>

      {!establecimiento && (
        <div className="panel">
          <p>
            Para empezar, dibujá el límite de tu establecimiento sobre el mapa.
            Hacé click para marcar cada vértice y doble click (o click en el
            primer punto) para cerrar el polígono.
          </p>
          {drawMode === "establecimiento" ? (
            <button className="btn btn-secondary" onClick={onCancelDraw}>
              Cancelar dibujo
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onStartDrawEstablecimiento}>
              Dibujar límite del establecimiento
            </button>
          )}
        </div>
      )}

      {establecimiento && (
        <>
          <nav className="sidebar-tabs" role="tablist" aria-label="Secciones">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`sidebar-tab ${tab === t.id ? "activo" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.etiqueta}
                {t.id === "lotes" && lotesVisibles.length > 0 && (
                  <span className="sidebar-tab-badge">{lotesVisibles.length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-contenido">
            {tab === "establecimiento" && (
              <div className="panel">
                <div className="establecimiento-header">
                  <h2>{establecimiento.nombre}</h2>
                  <button className="btn-link" onClick={onRenameEstablecimiento}>
                    Renombrar
                  </button>
                </div>
                <p className="muted">Superficie activa: {superficieTotalHa.toFixed(2)} ha</p>

                {editingBoundary ? (
                  <div className="button-row">
                    <button className="btn btn-primary" onClick={onSaveEditBoundary}>
                      Guardar límite
                    </button>
                    <button className="btn btn-secondary" onClick={onCancelEditBoundary}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="button-row">
                    {drawMode === "lote" ? (
                      <button className="btn btn-secondary" onClick={onCancelDraw}>
                        Cancelar dibujo
                      </button>
                    ) : (
                      <button className="btn btn-primary" onClick={onStartDrawLote}>
                        Agregar lote
                      </button>
                    )}
                    <button className="btn btn-secondary" onClick={onStartEditBoundary}>
                      Editar límite
                    </button>
                  </div>
                )}

                {!editingBoundary && drawMode === "idle" && (
                  <div className="button-row">
                    <button
                      className="btn btn-danger"
                      onClick={onDeleteEstablecimiento}
                      disabled={tieneLotes}
                      title={
                        tieneLotes
                          ? "Eliminá todos los lotes antes de borrar el establecimiento"
                          : undefined
                      }
                    >
                      Eliminar establecimiento
                    </button>
                  </div>
                )}
                {tieneLotes && (
                  <p className="muted small">
                    Para eliminar el establecimiento primero eliminá todos sus lotes.
                    {lotesInactivosOcultos > 0 && (
                      <>
                        {" "}
                        Tenés {lotesInactivosOcultos} lote
                        {lotesInactivosOcultos > 1 ? "s" : ""} inactivo
                        {lotesInactivosOcultos > 1 ? "s" : ""} oculto
                        {lotesInactivosOcultos > 1 ? "s" : ""}: activá "Mostrar inactivos"
                        para verlo{lotesInactivosOcultos > 1 ? "s" : ""} y eliminarlo
                        {lotesInactivosOcultos > 1 ? "s" : ""}.
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {tab === "lotes" && (
              <div className="panel lotes-panel">
                <div className="lotes-header">
                  <h3>Lotes ({lotesVisibles.length})</h3>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showInactivos}
                      onChange={onToggleShowInactivos}
                    />
                    Mostrar inactivos
                  </label>
                </div>

                {lotesVisibles.length === 0 && (
                  <p className="muted">Todavía no hay lotes para mostrar.</p>
                )}

                <ul className="lotes-list">
                  {lotesVisibles.map((lote) => {
                    const ha = areaHectareas(lote.polygon);
                    const selected = lote.id === selectedLoteId;
                    return (
                      <li
                        key={lote.id}
                        className={`lote-item ${selected ? "selected" : ""} ${
                          lote.activo ? "" : "inactivo"
                        }`}
                        onClick={() => onSelectLote(lote.id)}
                      >
                        <div className="lote-item-main">
                          <span className="lote-numero">Lote {lote.numero}</span>
                          <span className="lote-apodo">{lote.apodo || "(sin apodo)"}</span>
                          <span
                            className={`lote-estado ${lote.activo ? "activo" : "inactivo"}`}
                          >
                            {lote.activo ? "Activo" : "Inactivo"}
                          </span>
                        </div>
                        <div className="lote-item-sub">
                          <span>{ha.toFixed(2)} ha</span>
                          <div className="lote-item-actions">
                            <button
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRenameLote(lote.id);
                              }}
                            >
                              Apodo
                            </button>
                            <button
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleActivoLote(lote.id);
                              }}
                            >
                              {lote.activo ? "Desactivar" : "Activar"}
                            </button>
                            <button
                              className="btn-link btn-link-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteLote(lote.id);
                              }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {tab === "clima" && panelClima}
            {tab === "condicion" && panelCondicion}
          </div>
        </>
      )}
    </aside>
  );
}
