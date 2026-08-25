import { type ReactNode, useEffect, useState } from "react";
import type { Establecimiento, Lote } from "../types";
import { areaHectareas } from "../geo";
import { useNotificaciones } from "../hooks/useNotificaciones";
import NotificationsPanel from "./NotificationsPanel";
import Button from "./ui/Button";
import Panel from "./ui/Panel";
import { MUTED, rankingItemClass } from "./ui/ranking";

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
    <aside className="flex h-full min-h-0 w-[30%] min-w-[320px] max-w-[420px] flex-col gap-4 border-r border-gray-200 bg-white p-4">
      <h1 className="m-0 text-2xl tracking-[0.05em] text-brand">RODEO</h1>

      {onboardingStep && (
        <Panel>
          <p className="text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-accent">Configuración inicial</p>
          <p><strong>Paso {onboardingStep} de 2</strong></p>
          <p className="text-[0.88rem]">{onboardingStep === 1 ? "○ Establecimiento" : "✓ Establecimiento"}</p>
          <p className="text-[0.88rem]">{onboardingStep === 2 ? "● Primer lote" : "○ Primer lote"}</p>
          {onboardingStep === 1 && <p>Dibujá el límite de tu establecimiento y asignale un nombre.</p>}
          {onboardingStep === 2 && <>
            <p>Ahora dibujá tu primer lote dentro del establecimiento.</p>
            <Button variant="primary" onClick={onStartDrawLote} disabled={guardando || drawMode !== "idle"}>
              {drawMode === "lote" ? "Dibujando lote..." : "Dibujar primer lote"}
            </Button>
          </>}
        </Panel>
      )}

      {!establecimiento && (
        <Panel>
          <p>
            Para empezar, dibujá el límite de tu establecimiento sobre el mapa.
            Hacé click para marcar cada vértice y doble click (o click en el
            primer punto) para cerrar el polígono.
          </p>
          {drawMode === "establecimiento" ? (
            <Button variant="secondary" onClick={onCancelDraw}>
              Cancelar dibujo
            </Button>
          ) : (
            <Button variant="primary" onClick={onStartDrawEstablecimiento}>
              Dibujar límite del establecimiento
            </Button>
          )}
        </Panel>
      )}

      {establecimiento && (
        <>
          <nav className="flex flex-shrink-0 flex-wrap gap-1 border-b border-gray-200 pb-2" role="tablist" aria-label="Secciones">
            {TABS.filter((t) => !onboardingStep || t.id === "lotes").map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 px-2.5 py-1.5 text-[0.82rem] font-semibold transition-colors ${
                  tab === t.id ? "bg-brand text-white" : "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.etiqueta}
                {t.id === "lotes" && lotesVisibles.length > 0 && (
                  <span className={`rounded-full px-1.5 text-[0.7rem] leading-[1.5] ${tab === t.id ? "bg-white/25" : "bg-black/15"}`}>{lotesVisibles.length}</span>
                )}
                {t.id === "notificaciones" && notificaciones.noLeidas > 0 && (
                  <span className={`rounded-full px-1.5 text-[0.7rem] leading-[1.5] ${tab === t.id ? "bg-white/25" : "bg-black/15"}`} aria-label={`${notificaciones.noLeidas} notificaciones sin leer`}>{notificaciones.noLeidas}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {tab === "establecimiento" && (
              <Panel>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[1.1rem] text-gray-800">{establecimiento.nombre}</h2>
                  <Button variant="link" onClick={onRenameEstablecimiento}>
                    Renombrar
                  </Button>
                </div>
                <p className={MUTED}>Superficie activa: {superficieTotalHa.toFixed(2)} ha</p>

                {editingBoundary ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={onSaveEditBoundary}>
                      Guardar límite
                    </Button>
                    <Button variant="secondary" onClick={onCancelEditBoundary}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {drawMode === "lote" ? (
                      <Button variant="secondary" onClick={onCancelDraw}>
                        Cancelar dibujo
                      </Button>
                    ) : (
                      <Button variant="primary" onClick={onStartDrawLote}>
                        Agregar lote
                      </Button>
                    )}
                    <Button variant="secondary" onClick={onStartEditBoundary}>
                      Editar límite
                    </Button>
                  </div>
                )}

                {!editingBoundary && drawMode === "idle" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      onClick={onDeleteEstablecimiento}
                      disabled
                      title={
                        tieneLotes
                          ? "Eliminá todos los lotes antes de borrar el establecimiento"
                          : undefined
                      }
                    >
                      Eliminar establecimiento
                    </Button>
                  </div>
                )}
                {tieneLotes && (
                  <p className={MUTED}>
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
              </Panel>
            )}

            {tab === "lotes" && (
              <Panel className="min-h-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base">Lotes ({lotesVisibles.length})</h3>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[0.82rem] text-gray-600">
                    <input
                      type="checkbox"
                      checked={showInactivos}
                      onChange={onToggleShowInactivos}
                    />
                    Mostrar inactivos
                  </label>
                </div>

                {lotesVisibles.length === 0 && (
                  <p className={MUTED}>Todavía no hay lotes para mostrar.</p>
                )}

                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {lotesVisibles.map((lote) => {
                    const ha = areaHectareas(lote.polygon);
                    const selected = lote.id === selectedLoteId;
                    return (
                      <li
                        key={lote.id}
                        className={`${rankingItemClass(selected)} ${lote.activo ? "" : "opacity-60"}`}
                        onClick={() => onSelectLote(lote.id)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.88rem] font-semibold">Lote {lote.numero}</span>
                          <span className="flex-1 text-[0.88rem] text-gray-600">{lote.apodo || "(sin apodo)"}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.72rem] uppercase ${lote.activo ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}
                          >
                            {lote.activo ? "Activo" : "Inactivo"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[0.82rem] text-gray-700">
                          <span>{ha.toFixed(2)} ha</span>
                          <div className="flex gap-2.5">
                            {selected && !editingLoteId && (
                              <Button
                                variant="link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenFicha(lote.id);
                                }}
                              >
                                Ver ficha
                              </Button>
                            )}
                            {selected && editingLoteId === lote.id ? (
                              <div className="flex gap-2">
                                <Button variant="primary" onClick={(e) => { e.stopPropagation(); onSaveEditLote(); }} disabled={guardando}>
                                  Guardar límite
                                </Button>
                                <Button variant="secondary" onClick={(e) => { e.stopPropagation(); onCancelEditLote(); }} disabled={guardando}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : selected && !editingLoteId ? (
                              <Button variant="link" onClick={(e) => { e.stopPropagation(); onStartEditLote(lote.id); }} disabled={guardando}>
                                Editar límite
                              </Button>
                            ) : null}
                            <Button
                              hidden={selected && editingLoteId === lote.id}
                              variant="link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRenameLote(lote.id);
                              }}
                            >
                              Apodo
                            </Button>
                            <Button
                              hidden={selected && editingLoteId === lote.id}
                              variant="link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleActivoLote(lote.id);
                              }}
                            >
                              {lote.activo ? "Desactivar" : "Activar"}
                            </Button>
                            <Button
                              hidden={selected && editingLoteId === lote.id}
                              variant="link-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteLote(lote.id);
                              }}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {panelLote}
              </Panel>
            )}

            {tab === "clima" && panelClima}
            {tab === "condicion" && panelCondicion}
            {tab === "notificaciones" && <NotificationsPanel lotes={lotes} {...notificaciones} onRetry={notificaciones.recargar} onMarcarLeida={notificaciones.marcarLeida} onMarcarTodas={notificaciones.marcarTodas} onAnterior={notificaciones.anterior} onSiguiente={notificaciones.siguiente} />}
          </div>
        </>
      )}

      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-gray-200 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.7rem] uppercase tracking-[0.05em] text-slate-400">Sesión activa</span>
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.86rem] text-slate-700">{usuarioNombre}</strong>
        </div>
        <Button variant="link" onClick={onLogout}>Cerrar sesión</Button>
      </div>
    </aside>
  );
}
