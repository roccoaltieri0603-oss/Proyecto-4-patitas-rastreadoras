import { Link } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
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
type Tab = "lotes" | "clima" | "condicion" | "notificaciones";
const ORDENES_LOTES = ["Favoritos primero", "Número: menor a mayor", "Número: mayor a menor", "Apodo: A-Z", "Superficie: mayor a menor", "Superficie: menor a mayor"] as const;
type OrdenLotes = typeof ORDENES_LOTES[number];

interface SidebarProps {
  establecimiento: Establecimiento | null;
  lotes: Lote[];
  showInactivos: boolean;
  selectedLoteId: string | null;
  drawMode: DrawMode;
  editingBoundary: boolean;
  editingLoteId: string | null;
  puedeDeshacerLote: boolean;
  onDeshacerEditLote: () => void;
  onToggleFavorito: (id: string) => void;
  onSeleccionMultipleChange: (ids: string[]) => void;
  onVerEstablecimiento: () => void;
  onActualizarSeleccionados: (ids: string[], fuente: "satelite" | "clima") => void;
  operacionBatch: "satelite" | "clima" | null;
  batchBloqueado: boolean;
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
  onRenameLote: (id: string) => void;
  onToggleActivoLote: (id: string) => void;
  onDeleteLote: (id: string) => void;
  usuarioNombre: string;
  onLogout: () => void;
  /** El backend tiene configurado el microservicio de sugerencia con IA. */
  iaDisponible: boolean;
  iaGenerando: boolean;
  iaError: string | null;
  onSugerirLotes: () => void;
  /** Cartel de revisión de la propuesta; sólo aparece cuando hay uno vigente. */
  panelSugerencias?: ReactNode;
  /** Panel de clima; se muestra en su propia sección. */
  panelClima?: ReactNode;
  panelLote?: ReactNode;
  /** Panel de condición satelital; se muestra en su propia sección. */
  panelCondicion?: ReactNode;
}

const TABS: { id: Tab; etiqueta: string }[] = [
  { id: "condicion", etiqueta: "Condición" },
  { id: "clima", etiqueta: "Clima" },
  { id: "notificaciones", etiqueta: "Notificaciones" },
  { id: "lotes", etiqueta: "Lotes" },
];

export default function Sidebar({
  establecimiento,
  lotes,
  showInactivos,
  selectedLoteId,
  drawMode,
  editingBoundary,
  editingLoteId,
  puedeDeshacerLote,
  onDeshacerEditLote,
  onToggleFavorito,
  onSeleccionMultipleChange,
  onVerEstablecimiento,
  onActualizarSeleccionados,
  operacionBatch,
  batchBloqueado,
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
  onRenameLote,
  onToggleActivoLote,
  onDeleteLote,
  usuarioNombre,
  onLogout,
  iaDisponible,
  iaGenerando,
  iaError,
  onSugerirLotes,
  panelSugerencias,
  panelClima,
  panelLote,
  panelCondicion,
}: SidebarProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const [tab, setTab] = useState<Tab>("lotes");
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [busquedaLotes, setBusquedaLotes] = useState("");
  const [ordenLotes, setOrdenLotes] = useState<OrdenLotes>("Favoritos primero");
  const [seleccionMultiple, setSeleccionMultiple] = useState(false);
  const [lotesSeleccionados, setLotesSeleccionados] = useState<string[]>([]);
  const notificaciones = useNotificaciones(Boolean(establecimiento && !onboardingStep));

  useEffect(() => {
    onSeleccionMultipleChange(lotesSeleccionados);
  }, [lotesSeleccionados, onSeleccionMultipleChange]);

  useEffect(() => {
    if (selectedLoteId) setTab("lotes");
  }, [selectedLoteId]);

  useEffect(() => {
    setLotesSeleccionados((ids) => ids.filter((id) => lotes.some((lote) => lote.id === id && lote.activo)));
  }, [lotes]);

  useEffect(() => {
    if (drawMode !== "idle" || editingBoundary || editingLoteId) {
      setSeleccionMultiple(false);
      setLotesSeleccionados([]);
    }
  }, [drawMode, editingBoundary, editingLoteId]);

  // El cartel de la propuesta vive en "Lotes": si aparece uno, hay que llevar
  // al usuario ahí o no lo ve.
  const haySugerencias = Boolean(panelSugerencias);
  useEffect(() => {
    if (haySugerencias) setTab("lotes");
  }, [haySugerencias]);

  useEffect(() => {
    if (!ajustesAbiertos) return;
    const cerrarConEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setAjustesAbiertos(false); };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [ajustesAbiertos]);

  const lotesVisibles = showInactivos ? lotes : lotes.filter((l) => l.activo);
  const busqueda = busquedaLotes.trim().toLocaleLowerCase();
  const lotesFiltrados = lotesVisibles.filter((lote) =>
    `Lote ${lote.numero}`.toLocaleLowerCase().includes(busqueda) ||
    (lote.apodo ?? "").toLocaleLowerCase().includes(busqueda),
  );
  const superficies = new Map(ordenLotes.startsWith("Superficie:")
    ? lotesFiltrados.map((lote) => [lote.id, areaHectareas(lote.polygon)] as const)
    : []);
  lotesFiltrados.sort((a, b) => {
    switch (ordenLotes) {
      case "Número: menor a mayor": return a.numero - b.numero;
      case "Número: mayor a menor": return b.numero - a.numero;
      case "Apodo: A-Z": {
        const apodoA = (a.apodo ?? "").trim();
        const apodoB = (b.apodo ?? "").trim();
        return Number(!apodoA) - Number(!apodoB) ||
          apodoA.localeCompare(apodoB, "es", { sensitivity: "accent" }) || a.numero - b.numero;
      }
      case "Superficie: mayor a menor": return superficies.get(b.id)! - superficies.get(a.id)! || a.numero - b.numero;
      case "Superficie: menor a mayor": return superficies.get(a.id)! - superficies.get(b.id)! || a.numero - b.numero;
      default: return Number(b.favorito) - Number(a.favorito) || a.numero - b.numero;
    }
  });
  const superficieTotalHa = lotes
    .filter((l) => l.activo)
    .reduce((acc, l) => acc + areaHectareas(l.polygon), 0);

  // La sugerencia mira el establecimiento entero: no tiene sentido pedirla con
  // un dibujo o una edición a medias sobre el mapa.
  const iaBloqueada = iaGenerando || guardando || drawMode !== "idle" || editingBoundary || Boolean(editingLoteId);
  const etiquetaIa = iaGenerando ? "Analizando..." : "Subdividir con IA";

  // La sidebar flota sobre el mapa a alto completo, como en el diseño. Al estar fuera del flujo, el <main> del mapa ocupa todo el ancho
  // solo: no hace falta cambiar la estructura ni remontar Leaflet.
  const enOnboarding = Boolean(onboardingStep);
  const claseFlotante = "absolute top-3 bottom-3 left-3 z-[1200] flex min-h-0 w-[clamp(280px,33.8vw,433px)] max-w-[calc(100%-1.5rem)] flex-col gap-[clamp(0.5rem,1.17vw,0.9375rem)] overflow-y-auto rounded-[clamp(20px,3.1vw,40px)] bg-[var(--color-vidrio)] p-[clamp(0.6rem,1.17vw,0.9375rem)] font-display backdrop-blur-[20px]";
  // Fuera del onboarding: panel angosto, flotando sobre el mapa con un borde fino de mapa alrededor.
  const claseAside = enOnboarding
    ? claseFlotante
    : "absolute top-1.5 bottom-1.5 left-1.5 z-[1200] flex min-h-0 w-[clamp(300px,24vw,360px)] max-w-[calc(100%-0.75rem)] flex-col gap-2 rounded-2xl border border-gray-300 bg-gray-200 p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.3)]";

  return (
    <aside className={claseAside}>
      {!(establecimiento && !enOnboarding) && (<nav className="flex flex-wrap gap-3 text-sm"><Link to="/" className="rounded bg-white/90 px-3 py-2 text-brand">Mis establecimientos</Link>{establecimientoId && <Link to={`/establecimientos/${establecimientoId}/equipo`} className="rounded bg-white/90 px-3 py-2 text-brand">Equipo</Link>}{establecimientoId && <Link to={`/establecimientos/${establecimientoId}/dispositivos`} className="rounded bg-white/90 px-3 py-2 text-brand">Dispositivos</Link>}</nav>)}
      {!establecimiento && !enOnboarding && <h1 className="m-0 text-2xl tracking-[0.05em] text-brand">RODEO</h1>}

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
          {panelSugerencias ?? (
            <>
              <p className="texto-foto p-[clamp(0.4rem,0.78vw,0.625rem)] text-[clamp(0.9rem,2.03vw,1.62rem)] font-medium tracking-[-0.05em] text-white">
                Ahora marcá tu primer lote dentro del establecimiento, con los mismos
                clicks: uno por vértice y doble click para cerrarlo.
              </p>
              <BotonAccion onClick={onStartDrawLote} hidden={!puede("crear_lotes")} disabled={guardando || drawMode !== "idle"}>
                {drawMode === "lote" ? "Marcando el lote..." : "Marcar tu primer lote"}
              </BotonAccion>
              {iaDisponible && puede("usar_ia") && (
                <button
                  type="button"
                  className="texto-foto foco-campo w-full cursor-pointer rounded-[clamp(18px,3.1vw,40px)] border-2 border-white/70 bg-white/10 p-[clamp(0.5rem,0.78vw,0.625rem)] text-center text-[clamp(0.8rem,1.72vw,1.37rem)] font-medium tracking-[-0.05em] text-white transition-colors enabled:hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onSugerirLotes}
                  disabled={iaBloqueada}
                >
                  {etiquetaIa}
                </button>
              )}
              {iaError && (
                <p role="alert" className="texto-foto m-0 rounded-xl border border-white/40 bg-red-900/40 p-2 text-[0.78rem] text-white">
                  {iaError}
                </p>
              )}
            </>
          )}
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
        <div className="relative flex min-h-0 flex-1 flex-col gap-2">
          <header className="flex flex-shrink-0 items-center justify-between gap-2 px-1.5">
            <h1 className="m-0 min-w-0 truncate text-2xl tracking-[0.02em] text-brand">
              {establecimiento.nombre}
            </h1>
            <button
              type="button"
              aria-label="Ajustes"
              aria-haspopup="menu"
              aria-expanded={ajustesAbiertos}
              className="flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-gray-300 text-lg text-gray-800 hover:bg-gray-400"
              onClick={() => setAjustesAbiertos((v) => !v)}
            >
              ⚙
            </button>
          </header>

          {ajustesAbiertos && (
            <>
              <div className="fixed inset-0 z-[1250]" aria-hidden="true" onClick={() => setAjustesAbiertos(false)} />
              <div role="menu" className="absolute right-1 top-11 z-[1300] flex w-64 flex-col gap-1 rounded-2xl bg-white p-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
                <div className="flex min-w-0 flex-col gap-0.5 border-b border-gray-200 pb-2">
                  <span className="text-[0.7rem] uppercase tracking-[0.05em] text-slate-400">Sesión activa</span>
                  <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-700">{usuarioNombre}</strong>
                  <span className={MUTED}>Superficie activa: {superficieTotalHa.toFixed(2)} ha</span>
                </div>
                <Link role="menuitem" to="/" className="rounded-md px-2 py-2 font-semibold text-brand hover:bg-gray-100">Mis establecimientos</Link>
                {establecimientoId && <Link role="menuitem" to={`/establecimientos/${establecimientoId}/equipo`} className="rounded-md px-2 py-2 font-semibold text-brand hover:bg-gray-100">Equipo</Link>}
                {establecimientoId && <Link role="menuitem" to={`/establecimientos/${establecimientoId}/dispositivos`} className="rounded-md px-2 py-2 font-semibold text-brand hover:bg-gray-100">Dispositivos</Link>}
                {puede("renombrar_establecimiento") && (
                  <button role="menuitem" type="button" className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-2 text-left font-semibold text-brand hover:bg-gray-100" onClick={() => { setAjustesAbiertos(false); onRenameEstablecimiento(); }}>
                    Renombrar establecimiento
                  </button>
                )}
                {puede("editar_limite_establecimiento") && !editingBoundary && !editingLoteId && (
                  <button role="menuitem" type="button" className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-2 text-left font-semibold text-brand hover:bg-gray-100" onClick={() => { setAjustesAbiertos(false); setTab("lotes"); onStartEditBoundary(); }}>
                    Editar límite
                  </button>
                )}
                <button role="menuitem" type="button" className="cursor-pointer rounded-md border-0 border-t border-gray-200 bg-transparent px-2 py-2 text-left font-semibold text-red-700 hover:bg-gray-100" onClick={onLogout}>
                  Cerrar sesión
                </button>
              </div>
            </>
          )}

          {/* Pestañas tipo separador de carpeta (Figma): la activa es blanca y
              se funde con la tarjeta de contenido. */}
          <div className="flex min-h-0 flex-1 flex-col">
          <nav className="relative z-10 flex flex-shrink-0 items-end gap-0.5 px-1.5 text-sm" role="tablist" aria-label="Secciones">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`inline-flex min-w-0 flex-auto cursor-pointer items-center justify-center gap-1 truncate whitespace-nowrap rounded-t-xl border-2 border-b-0 px-1 text-[0.8rem] font-semibold transition-colors ${
                  tab === t.id
                    ? "-mb-0.5 border-[var(--color-lima)] bg-gray-100 pt-2.5 pb-3 text-gray-900"
                    : "border-transparent bg-gray-400 pt-2 pb-2.5 text-gray-800 hover:bg-gray-300 hover:text-gray-900"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.etiqueta}
                {t.id === "lotes" && lotesVisibles.length > 0 && (
                  <span className={`rounded-full px-1.5 text-[0.7rem] leading-[1.5] ${tab === t.id ? "bg-[var(--color-lima)]/35 text-gray-900" : "bg-black/15"}`}>{lotesVisibles.length}</span>
                )}
                {t.id === "notificaciones" && notificaciones.noLeidas > 0 && (
                  <span className={`rounded-full px-1.5 text-[0.7rem] leading-[1.5] ${tab === t.id ? "bg-[var(--color-lima)]/35 text-gray-900" : "bg-black/15"}`} aria-label={`${notificaciones.noLeidas} notificaciones sin leer`}>{notificaciones.noLeidas}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border-2 border-[var(--color-lima)] bg-gray-100 p-2">
            {tab === "lotes" && (
              <Panel className="min-h-0">
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
                  <div className="flex items-center gap-2">
                    {drawMode === "lote" ? (
                      <Button variant="secondary" onClick={onCancelDraw}>
                        Cancelar dibujo
                      </Button>
                    ) : (
                      <button
                        type="button"
                        title="Agregar lote"
                        aria-label="Agregar lote"
                        hidden={!puede("crear_lotes")}
                        onClick={onStartDrawLote}
                        className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-[var(--color-brand)] text-xl leading-none text-white transition-colors hover:bg-[var(--color-brand-dark)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +
                      </button>
                    )}
                    <button
                      type="button"
                      title="Ver establecimiento"
                      aria-label="Ver establecimiento"
                      onClick={onVerEstablecimiento}
                      className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-lg border-2 border-[var(--color-brand)] bg-white text-base leading-none text-[var(--color-brand)] transition-colors hover:bg-gray-100"
                    >
                      🔍
                    </button>
                    {iaDisponible && puede("usar_ia") && !panelSugerencias && (
                      <button
                        type="button"
                        title={etiquetaIa}
                        aria-label={etiquetaIa}
                        onClick={onSugerirLotes}
                        disabled={iaBloqueada}
                        className={`flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-[var(--color-lima)] text-base leading-none text-gray-900 transition-colors hover:bg-[var(--color-verde-accion)] disabled:cursor-not-allowed disabled:opacity-50 ${iaGenerando ? "animate-pulse" : ""}`}
                      >
                        ✨
                      </button>
                    )}
                  </div>
                )}

                {iaError && !panelSugerencias && (
                  <p role="alert" className="m-0 rounded-md border border-red-300 bg-red-100 p-2 text-[0.8rem] text-red-800">
                    {iaError}
                  </p>
                )}
                {panelSugerencias && (
                  <div className="border-t border-gray-200 pt-2.5">{panelSugerencias}</div>
                )}

                <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-2.5">
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

                <input
                  type="search"
                  aria-label="Buscar lotes"
                  placeholder="Buscar..."
                  value={busquedaLotes}
                  onChange={(e) => setBusquedaLotes(e.target.value)}
                  disabled={Boolean(editingLoteId)}
                  className="w-1/2 min-w-0 rounded-md border border-gray-300 px-2.5 py-2 text-[0.95rem]"
                />

                <label className="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
                  Ordenar lotes
                  <select value={ordenLotes} onChange={(e) => setOrdenLotes(e.target.value as OrdenLotes)} className="min-h-11 w-full min-w-0 rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm">
                    {ORDENES_LOTES.map((orden) => <option key={orden} value={orden}>{orden}</option>)}
                  </select>
                </label>

                {seleccionMultiple && drawMode === "idle" && !editingBoundary && !editingLoteId ? (
                  <div className="flex flex-col gap-2">
                    <p className={MUTED} aria-live="polite">{lotesSeleccionados.length} lotes seleccionados</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={!puede("actualizar_satelite") || !lotesSeleccionados.length || batchBloqueado} onClick={() => onActualizarSeleccionados(lotesSeleccionados, "satelite")}>
                        {operacionBatch === "satelite" ? "Actualizando satélite..." : "Actualizar satélite"}
                      </Button>
                      <Button size="sm" disabled={!puede("actualizar_clima") || !lotesSeleccionados.length || batchBloqueado} onClick={() => onActualizarSeleccionados(lotesSeleccionados, "clima")}>
                        {operacionBatch === "clima" ? "Actualizando clima..." : "Actualizar clima"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setSeleccionMultiple(false); setLotesSeleccionados([]); }}>
                        Cancelar selección
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" disabled={batchBloqueado} onClick={() => setSeleccionMultiple(true)}>
                    Seleccionar varios
                  </Button>
                )}

                {lotesFiltrados.length === 0 && (
                  <p className={MUTED}>{busqueda ? "No se encontraron lotes." : "Todavía no hay lotes para mostrar."}</p>
                )}

                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {lotesFiltrados.map((lote) => {
                    const ha = areaHectareas(lote.polygon);
                    const selected = lote.id === selectedLoteId;
                    return (
                      <li
                        key={lote.id}
                        className={`${rankingItemClass(selected)} ${lote.activo ? "" : "opacity-60"}`}
                        onClick={() => onSelectLote(lote.id)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {seleccionMultiple && lote.activo && (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar Lote ${lote.numero} para actualizar`}
                              checked={lotesSeleccionados.includes(lote.id)}
                              disabled={Boolean(operacionBatch)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const marcado = e.target.checked;
                                setLotesSeleccionados((ids) => marcado ? [...ids, lote.id] : ids.filter((id) => id !== lote.id));
                              }}
                            />
                          )}
                          <button
                            type="button"
                            aria-label={`${lote.favorito ? "Quitar" : "Marcar"} favorito: Lote ${lote.numero}`}
                            aria-pressed={lote.favorito}
                            title={lote.favorito ? "Quitar favorito" : "Marcar favorito"}
                            disabled={guardando || drawMode !== "idle" || editingBoundary || Boolean(editingLoteId)}
                            className="cursor-pointer border-0 bg-transparent p-0 text-xl text-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={(e) => { e.stopPropagation(); onToggleFavorito(lote.id); }}
                          >
                            {lote.favorito ? "★" : "☆"}
                          </button>
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
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="primary" onClick={(e) => { e.stopPropagation(); onSaveEditLote(); }} disabled={guardando}>
                                  Guardar límite
                                </Button>
                                <Button variant="secondary" onClick={(e) => { e.stopPropagation(); onDeshacerEditLote(); }} disabled={guardando || !puedeDeshacerLote} className="disabled:opacity-50">
                                  Deshacer
                                </Button>
                                <Button variant="secondary" onClick={(e) => { e.stopPropagation(); onCancelEditLote(); }} disabled={guardando}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : selected && !editingLoteId ? (
                              <Button variant="link" onClick={(e) => { e.stopPropagation(); onStartEditLote(lote.id); }} hidden={!puede("editar_geometria_lotes")} disabled={guardando || Boolean(operacionBatch)}>
                                Editar límite
                              </Button>
                            ) : null}
                            <Button
                              hidden={selected && editingLoteId === lote.id || !puede("editar_lotes")}
                              variant="link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRenameLote(lote.id);
                              }}
                            >
                              Apodo
                            </Button>
                            <Button
                              hidden={selected && editingLoteId === lote.id || !puede("activar_lotes")}
                              variant="link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleActivoLote(lote.id);
                              }}
                            >
                              {lote.activo ? "Desactivar" : "Activar"}
                            </Button>
                            <Button
                              hidden={selected && editingLoteId === lote.id || !puede("eliminar_lotes")}
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
          </div>
        </div>
      )}

      {enOnboarding && <div
        className="mt-auto flex flex-shrink-0 items-center justify-between gap-3 border-t border-white/25 px-2 pt-3"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className="texto-foto text-[0.7rem] uppercase tracking-[0.05em] text-white/70"
          >
            Sesión activa
          </span>
          <strong
            className="texto-foto overflow-hidden text-ellipsis whitespace-nowrap text-[0.86rem] text-white"
          >
            {usuarioNombre}
          </strong>
        </div>
        <button
          type="button"
          className="texto-foto foco-campo shrink-0 cursor-pointer rounded border-0 bg-transparent text-[0.82rem] text-white underline hover:text-[var(--color-verde-accion)]"
          onClick={onLogout}
        >
          Cerrar sesión
        </button>
      </div>}
    </aside>
  );
}
