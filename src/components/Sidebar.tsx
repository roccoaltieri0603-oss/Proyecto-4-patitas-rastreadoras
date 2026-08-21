import { type ReactNode, useEffect, useState } from "react";
import type { Establecimiento, Lote } from "../types";
import { areaHectareas } from "../geo";
import { useNotificaciones } from "../hooks/useNotificaciones";
import NotificationsPanel from "./NotificationsPanel";

export type DrawMode = "idle" | "establecimiento" | "lote";
type Tab = "establecimiento" | "lotes" | "clima" | "condicion" | "notificaciones";

interface SidebarProps {
  establecimiento: Establecimiento | null;
  lotes: Lote[];
  showInactivos: boolean;
  selectedLoteId: string | null;
  drawMode: DrawMode;
  editingBoundary: boolean;
  editingLoteId: string | null;
  onboardingStep?: 1 | 2;
  guardando?: boolean;
  onToggleShowInactivos: () => void;
  onSelectLote: (id: string) => void;
  onOpenFicha: (id: string) => void;
  onStartDrawEstablecimiento: () => void;
  onStartDrawLote: () => void;
  onCancelDraw: () => void;
  onStartEditBoundary: () => void;
  onSaveEditBoundary: () => void;
  onCancelEditBoundary: () => void;
  onStartEditLote: (id: string) => void;
  onSaveEditLote: () => void;
  onCancelEditLote: () => void;
  onRenameEstablecimiento: () => void;
  onDeleteEstablecimiento: () => void;
  onRenameLote: (id: string) => void;
  onToggleActivoLote: (id: string) => void;
  onDeleteLote: (id: string) => void;
  usuarioNombre: string;
  onLogout: () => void;
  /** Panel de clima; se muestra en su propia sección. */
  panelClima?: ReactNode;
  panelLote?: ReactNode;
  /** Panel de condición satelital; se muestra en su propia sección. */
  panelCondicion?: ReactNode;
}

const TABS: { id: Tab; etiqueta: string }[] = [
  { id: "establecimiento", etiqueta: "Establecimiento" },
  { id: "lotes", etiqueta: "Lotes" },
  { id: "clima", etiqueta: "Clima" },
  { id: "notificaciones", etiqueta: "Notificaciones" },
  { id: "condicion", etiqueta: "Condición" },
];

export default function Sidebar({
  establecimiento,
  lotes,
  showInactivos,
  selectedLoteId,
  drawMode,
  editingBoundary,
  editingLoteId,
  onboardingStep,
  guardando = false,
  onToggleShowInactivos,
  onSelectLote,
  onOpenFicha,
  onStartDrawEstablecimiento,
  onStartDrawLote,
  onCancelDraw,
  onStartEditBoundary,
  onSaveEditBoundary,
  onCancelEditBoundary,
  onStartEditLote,
  onSaveEditLote,
  onCancelEditLote,
  onRenameEstablecimiento,
  onDeleteEstablecimiento,
  onRenameLote,
  onToggleActivoLote,
  onDeleteLote,
  usuarioNombre,
  onLogout,
  panelClima,
  panelLote,
  panelCondicion,
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("lotes");
  const notificaciones = useNotificaciones(Boolean(establecimiento && !onboardingStep));

  useEffect(() => {
    if (selectedLoteId) setTab("lotes");
  }, [selectedLoteId]);

  const lotesVisibles = showInactivos ? lotes : lotes.filter((l) => l.activo);
  const superficieTotalHa = lotes
    .filter((l) => l.activo)
    .reduce((acc, l) => acc + areaHectareas(l.polygon), 0);
  const tieneLotes = lotes.length > 0;
  const lotesInactivosOcultos = !showInactivos ? lotes.filter((l) => !l.activo).length : 0;

  return (
    <aside className="sidebar">
      <h1 className="app-title">RODEO</h1>

      {onboardingStep && (
        <div className="panel onboarding-progress">
          <p className="setup-kicker">Configuración inicial</p>
          <p><strong>Paso {onboardingStep} de 2</strong></p>
          <p className="setup-muted">{onboardingStep === 1 ? "○ Establecimiento" : "✓ Establecimiento"}</p>
          <p className="setup-muted">{onboardingStep === 2 ? "● Primer lote" : "○ Primer lote"}</p>
          {onboardingStep === 1 && <p>Dibujá el límite de tu establecimiento y asignale un nombre.</p>}
          {onboardingStep === 2 && <>
            <p>Ahora dibujá tu primer lote dentro del establecimiento.</p>
            <button className="btn btn-primary" onClick={onStartDrawLote} disabled={guardando || drawMode !== "idle"}>
              {drawMode === "lote" ? "Dibujando lote..." : "Dibujar primer lote"}
            </button>
          </>}
        </div>
      )}

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
            {TABS.filter((t) => !onboardingStep || t.id === "lotes").map((t) => (
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
                {t.id === "notificaciones" && notificaciones.noLeidas > 0 && (
                  <span className="sidebar-tab-badge" aria-label={`${notificaciones.noLeidas} notificaciones sin leer`}>{notificaciones.noLeidas}</span>
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
                      disabled
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
                            {selected && !editingLoteId && (
                              <button
                                className="btn-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenFicha(lote.id);
                                }}
                              >
                                Ver ficha
                              </button>
                            )}
                            {selected && editingLoteId === lote.id ? (
                              <div className="button-row">
                                <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onSaveEditLote(); }} disabled={guardando}>
                                  Guardar límite
                                </button>
                                <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); onCancelEditLote(); }} disabled={guardando}>
                                  Cancelar
                                </button>
                              </div>
                            ) : selected && !editingLoteId ? (
                              <button className="btn-link" onClick={(e) => { e.stopPropagation(); onStartEditLote(lote.id); }} disabled={guardando}>
                                Editar límite
                              </button>
                            ) : null}
                            <button
                              hidden={selected && editingLoteId === lote.id}
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRenameLote(lote.id);
                              }}
                            >
                              Apodo
                            </button>
                            <button
                              hidden={selected && editingLoteId === lote.id}
                              className="btn-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleActivoLote(lote.id);
                              }}
                            >
                              {lote.activo ? "Desactivar" : "Activar"}
                            </button>
                            <button
                              hidden={selected && editingLoteId === lote.id}
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
                {panelLote}
              </div>
            )}

            {tab === "clima" && panelClima}
            {tab === "condicion" && panelCondicion}
            {tab === "notificaciones" && <NotificationsPanel lotes={lotes} {...notificaciones} onRetry={notificaciones.recargar} onMarcarLeida={notificaciones.marcarLeida} onMarcarTodas={notificaciones.marcarTodas} onAnterior={notificaciones.anterior} onSiguiente={notificaciones.siguiente} />}
          </div>
        </>
      )}

      <div className="sidebar-account">
        <div>
          <span className="sidebar-account-label">Sesión activa</span>
          <strong>{usuarioNombre}</strong>
        </div>
        <button className="btn-link" onClick={onLogout}>Cerrar sesión</button>
      </div>
    </aside>
  );
}
