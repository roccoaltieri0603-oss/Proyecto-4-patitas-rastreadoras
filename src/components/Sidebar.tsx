import { type ReactNode, useEffect, useState } from "react";
import type { Establecimiento, Lote } from "../types";
import { areaHectareas } from "../geo";
import { useNotificaciones } from "../hooks/useNotificaciones";
import NotificationsPanel from "./NotificationsPanel";
import BotonAccion from "./ui/BotonAccion";
import Button from "./ui/Button";
import Panel from "./ui/Panel";
import PasoOnboarding from "./ui/PasoOnboarding";
import TarjetaVidrio from "./ui/TarjetaVidrio";
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

  // Durante el onboarding la sidebar flota sobre el mapa a sangre, como en el
  // diseño. Al estar fuera del flujo, el <main> del mapa ocupa todo el ancho
  // solo: no hace falta cambiar la estructura ni remontar Leaflet.
  const enOnboarding = Boolean(onboardingStep);
  const claseAside = enOnboarding
    ? "absolute top-3 bottom-3 left-3 z-[1200] flex min-h-0 w-[clamp(280px,33.8vw,433px)] max-w-[calc(100%-1.5rem)] flex-col gap-[clamp(0.5rem,1.17vw,0.9375rem)] overflow-y-auto rounded-[clamp(20px,3.1vw,40px)] bg-[var(--color-vidrio)] p-[clamp(0.6rem,1.17vw,0.9375rem)] font-display backdrop-blur-[20px]"
    : "flex h-full min-h-0 w-[30%] min-w-[320px] max-w-[420px] flex-col gap-4 border-r border-gray-200 bg-white p-4";

  return (
    <aside className={claseAside}>
      {!enOnboarding && <h1 className="m-0 text-2xl tracking-[0.05em] text-brand">RODEO</h1>}

      {onboardingStep && (
        <TarjetaVidrio className="gap-[clamp(1rem,3.05vw,2.44rem)]">
          <p className="texto-foto text-[clamp(1.15rem,2.58vw,2.06rem)] font-medium tracking-[-0.05em] text-white">
            Configuracion Inicial
          </p>
          <div className="flex flex-col gap-[clamp(0.75rem,1.87vw,1.5rem)]">
            <p className="texto-foto text-[clamp(1.05rem,2.34vw,1.875rem)] font-medium tracking-[-0.05em] text-white underline">
              Paso {onboardingStep} de 2
            </p>
            <div className="flex flex-col gap-[clamp(0.25rem,0.55vw,0.44rem)]">
              <PasoOnboarding
                etiqueta="Marcar tu establecimiento"
                activo={onboardingStep === 1}
                completado={onboardingStep === 2}
              />
              <PasoOnboarding etiqueta="Marcar los lotes" activo={onboardingStep === 2} />
            </div>
          </div>
        </TarjetaVidrio>
      )}

      {onboardingStep === 2 && (
        <TarjetaVidrio className="gap-[clamp(0.75rem,1.87vw,1.5rem)]">
          <p className="texto-foto p-[clamp(0.4rem,0.78vw,0.625rem)] text-[clamp(0.9rem,2.03vw,1.62rem)] font-medium tracking-[-0.05em] text-white">
            Ahora marcá tu primer lote dentro del establecimiento, con los mismos
            clicks: uno por vértice y doble click para cerrarlo.
          </p>
          <BotonAccion onClick={onStartDrawLote} disabled={guardando || drawMode !== "idle"}>
            {drawMode === "lote" ? "Marcando el lote..." : "Marcar tu primer lote"}
          </BotonAccion>
        </TarjetaVidrio>
      )}

      {!establecimiento && enOnboarding && (
        <TarjetaVidrio className="gap-[clamp(0.75rem,1.87vw,1.5rem)]">
          <p className="texto-foto p-[clamp(0.4rem,0.78vw,0.625rem)] text-[clamp(0.9rem,2.03vw,1.62rem)] font-medium tracking-[-0.05em] text-white">
            Para comenzar, marca los limites de tu establecimiento en el mapa.
            Hacé click para marcar cada vértice y doble click (o click en el
            primer punto) para cerrar el polígono.
          </p>
          {drawMode === "establecimiento" ? (
            <BotonAccion onClick={onCancelDraw}>Cancelar</BotonAccion>
          ) : (
            <BotonAccion onClick={onStartDrawEstablecimiento}>Marcar tu establecimiento</BotonAccion>
          )}
        </TarjetaVidrio>
      )}

      {!establecimiento && !enOnboarding && (
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

      {/* Durante el onboarding las pestañas no van: el diseño muestra solo los
          pasos y la instrucción del paso actual. */}
      {establecimiento && !enOnboarding && (
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

      <div
        className={`flex flex-shrink-0 items-center justify-between gap-3 pt-3 ${
          enOnboarding ? "mt-auto border-t border-white/25 px-2" : "border-t border-gray-200"
        }`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className={`text-[0.7rem] uppercase tracking-[0.05em] ${enOnboarding ? "texto-foto text-white/70" : "text-slate-400"}`}
          >
            Sesión activa
          </span>
          <strong
            className={`overflow-hidden text-ellipsis whitespace-nowrap text-[0.86rem] ${enOnboarding ? "texto-foto text-white" : "text-slate-700"}`}
          >
            {usuarioNombre}
          </strong>
        </div>
        {enOnboarding ? (
          <button
            type="button"
            className="texto-foto foco-campo shrink-0 cursor-pointer rounded border-0 bg-transparent text-[0.82rem] text-white underline hover:text-[var(--color-verde-accion)]"
            onClick={onLogout}
          >
            Cerrar sesión
          </button>
        ) : (
          <Button variant="link" onClick={onLogout}>
            Cerrar sesión
          </Button>
        )}
      </div>
    </aside>
  );
}
