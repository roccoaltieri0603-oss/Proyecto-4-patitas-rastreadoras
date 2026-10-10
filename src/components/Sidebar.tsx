import { Link } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { type ReactNode, useEffect, useState } from "react";
import type { Establecimiento, Lote } from "../types";
import { areaHectareas } from "../geo";
import { useNotificaciones } from "../hooks/useNotificaciones";
import NotificationsPanel from "./NotificationsPanel";
import BotonAccion from "./ui/BotonAccion";
import BotonSubdividirIA from "./ui/BotonSubdividirIA";
import Button from "./ui/Button";
import Panel from "./ui/Panel";
import PasoOnboarding from "./ui/PasoOnboarding";
import TarjetaVidrio from "./ui/TarjetaVidrio";
import IconoFiltro from "./ui/IconoFiltro";
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
  onSaveEditBoundary: () => void;
  onCancelEditBoundary: () => void;
  onStartEditLote: (id: string) => void;
  onSaveEditLote: () => void;
  onCancelEditLote: () => void;
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
  onSaveEditBoundary,
  onCancelEditBoundary,
  onStartEditLote,
  onSaveEditLote,
  onCancelEditLote,
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
  const { establecimientoId, puede, membresia } = useEstablecimiento();
  const puedeVerNotificaciones = membresia?.rol !== "VISOR";
  const [tab, setTab] = useState<Tab>("lotes");
  const [busquedaLotes, setBusquedaLotes] = useState("");
  const [ordenLotes, setOrdenLotes] = useState<OrdenLotes>("Favoritos primero");
  const [seleccionMultiple, setSeleccionMultiple] = useState(false);
  const [lotesSeleccionados, setLotesSeleccionados] = useState<string[]>([]);
  const notificaciones = useNotificaciones(Boolean(establecimiento && !onboardingStep && puedeVerNotificaciones));

  useEffect(() => {
    onSeleccionMultipleChange(lotesSeleccionados);
  }, [lotesSeleccionados, onSeleccionMultipleChange]);

  useEffect(() => {
    // Clima y Condición expanden la card del lote seleccionado en su propia
    // pestaña: ahí hay que quedarse. Sólo se redirige desde las que no la muestran.
    if (selectedLoteId) setTab((actual) => (actual === "clima" || actual === "condicion" ? actual : "lotes"));
  }, [selectedLoteId]);

  useEffect(() => {
    if (!puedeVerNotificaciones && tab === "notificaciones") setTab("lotes");
  }, [puedeVerNotificaciones, tab]);

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
  const claseFlotante = "absolute top-3 bottom-3 left-3 z-[1200] flex min-h-0 w-[clamp(480px,46vw,600px)] max-w-[calc(100%-1.5rem)] flex-col gap-[clamp(0.5rem,1.17vw,0.9375rem)] overflow-y-auto sin-barra-scroll rounded-[clamp(20px,3.1vw,40px)] bg-[var(--color-vidrio)] p-[clamp(0.6rem,1.17vw,0.9375rem)] font-display backdrop-blur-[20px]";
  // Fuera del onboarding: panel angosto, flotando sobre el mapa con un borde fino de mapa alrededor.
  const claseAside = enOnboarding
    ? claseFlotante
    : "absolute top-3 bottom-3 left-3 z-[1200] flex min-h-0 w-[var(--ancho-sidebar)] max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-[28px] bg-vidrio-claro p-3 shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-[18px]";

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
                <BotonSubdividirIA
                  type="button"
                  className="w-full"
                  onClick={onSugerirLotes}
                  disabled={iaBloqueada}
                  generando={iaGenerando}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`flex-none transition-transform duration-300 ${iaGenerando ? "animate-pulse" : "group-hover:rotate-12 group-hover:scale-110"}`}>
                    <path
                      d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                      fill="currentColor"
                    />
                  </svg>
                  {etiquetaIa}
                </BotonSubdividirIA>
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
          <header className="flex flex-shrink-0 flex-col gap-0.5 px-2 pt-1">
            <h1 className="m-0 min-w-0 truncate text-2xl font-medium tracking-[-0.03em] text-gray-900">
              {establecimiento.nombre}
            </h1>
            <span className="text-[0.72rem] text-gray-700">
              Superficie activa: {superficieTotalHa.toFixed(2)} ha
            </span>
          </header>

          {/* Pestañas tipo separador de carpeta (Figma): la activa es blanca y
              se funde con la tarjeta de contenido; las otras quedan en vidrio claro. */}
          <div className="flex min-h-0 flex-1 flex-col">
          <nav className="relative z-10 flex flex-shrink-0 items-end gap-1 px-2 text-sm" role="tablist" aria-label="Secciones">
            {TABS.filter((t) => t.id !== "notificaciones" || puedeVerNotificaciones).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`foco-campo inline-flex min-w-0 flex-auto cursor-pointer items-center justify-center gap-1 truncate whitespace-nowrap rounded-t-2xl border-0 px-1.5 text-[0.8rem] font-medium text-gray-900 transition-colors duration-150 ${
                  tab === t.id
                    ? "bg-white pt-2.5 pb-2.5"
                    : "bg-white/45 pt-2 pb-2 hover:bg-white/70"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.etiqueta}
                {t.id === "lotes" && lotesVisibles.length > 0 && (
                  <span className="rounded-full bg-[var(--color-lima)] px-1.5 text-[0.7rem] font-semibold leading-[1.5] text-gray-900">{lotesVisibles.length}</span>
                )}
                {t.id === "notificaciones" && notificaciones.noLeidas > 0 && (
                  <span className="rounded-full bg-[var(--color-lima)] px-1.5 text-[0.7rem] font-semibold leading-[1.5] text-gray-900" aria-label={`${notificaciones.noLeidas} notificaciones sin leer`}>{notificaciones.noLeidas}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sin-barra-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-3">
            {tab === "lotes" && (
              <Panel plano className="min-h-0">
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
                        className="group flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--color-campo-700)] text-white shadow-[0_3px_10px_rgba(59,100,50,0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--color-campo-600)] hover:shadow-[0_5px_14px_rgba(59,100,50,0.55)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="transition-transform duration-300 group-hover:rotate-90">
                          <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      title="Ver establecimiento"
                      aria-label="Ver establecimiento"
                      onClick={onVerEstablecimiento}
                      className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-2xl border-2 border-[var(--color-brand)] bg-white text-[var(--color-brand)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:text-accent hover:shadow-md active:translate-y-0"
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M17 17l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                    {iaDisponible && puede("usar_ia") && !panelSugerencias && (
                      <BotonSubdividirIA
                        type="button"
                        title={etiquetaIa}
                        onClick={onSugerirLotes}
                        disabled={iaBloqueada}
                        generando={iaGenerando}
                      >
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="-rotate-45 transition-transform duration-300 group-hover:-rotate-[55deg]">
                          <path d="M9.5 2.5c.3 2.6 1 4.2 2.1 5.3 1.1 1.1 2.7 1.8 5.3 2.1-2.6.3-4.2 1-5.3 2.1-1.1 1.1-1.8 2.7-2.1 5.3-.3-2.6-1-4.2-2.1-5.3-1.1-1.1-2.7-1.8-5.3-2.1 2.6-.3 4.2-1 5.3-2.1 1.1-1.1 1.8-2.7 2.1-5.3Z" />
                        </svg>
                      </BotonSubdividirIA>
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

                <div className="flex flex-col items-center gap-2 border-t border-gray-200 pt-2.5">
                  <h3 className="m-0 text-center text-base">Lotes ({lotesVisibles.length})</h3>
                  <div className="flex overflow-hidden rounded-full border border-gray-300 text-[0.82rem] font-semibold">
                    <button
                      type="button"
                      onClick={() => showInactivos && onToggleShowInactivos()}
                      aria-pressed={!showInactivos}
                      className={`px-4 py-1.5 transition-colors ${!showInactivos ? "bg-[var(--color-lima)] text-gray-900" : "bg-white text-gray-500 hover:bg-gray-100"}`}
                    >
                      Activos
                    </button>
                    <button
                      type="button"
                      onClick={() => !showInactivos && onToggleShowInactivos()}
                      aria-pressed={showInactivos}
                      className={`px-4 py-1.5 transition-colors ${showInactivos ? "bg-[#f3ead6] text-[#8a6d3b]" : "bg-white text-gray-500 hover:bg-gray-100"}`}
                    >
                      Inactivos
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-none">
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
                      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M17 17l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <input
                      type="search"
                      aria-label="Buscar lotes"
                      placeholder="Buscar"
                      value={busquedaLotes}
                      onChange={(e) => setBusquedaLotes(e.target.value)}
                      disabled={Boolean(editingLoteId)}
                      className="w-28 min-w-0 rounded-full border border-gray-300 py-1.5 pl-6 pr-2.5 text-[0.8rem]"
                    />
                  </div>

                  <details className="group relative ml-auto">
                    <summary
                      aria-label="Ordenar lotes"
                      title="Ordenar lotes"
                      className="flex h-7 w-7 list-none items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 transition-colors marker:content-none hover:border-[var(--color-campo-600)] hover:text-[var(--color-campo-700)] [&::-webkit-details-marker]:hidden"
                    >
                      <IconoFiltro />
                    </summary>
                    <div className="absolute right-0 z-20 mt-1.5 flex w-48 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 text-[0.78rem] shadow-lg">
                      {ORDENES_LOTES.map((orden) => (
                        <button
                          key={orden}
                          type="button"
                          onClick={() => setOrdenLotes(orden)}
                          aria-pressed={ordenLotes === orden}
                          className={`rounded px-2 py-1 text-left transition-colors ${ordenLotes === orden ? "bg-[var(--color-lima)]/35 text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
                        >
                          {orden}
                        </button>
                      ))}
                    </div>
                  </details>
                </div>

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
                    const enEdicion = selected && editingLoteId === lote.id;
                    return (
                      <li
                        key={lote.id}
                        className={`${rankingItemClass(selected, true)} ${lote.activo ? "" : "opacity-70"}`}
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
                          <span className="text-[0.88rem] font-bold text-gray-900">Lote {lote.numero}</span>
                          {lote.apodo && <span className="flex-1 truncate text-[0.82rem] text-gray-500">{lote.apodo}</span>}
                          {!lote.apodo && <span className="flex-1" />}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide ${lote.activo ? "bg-[var(--color-campo-100)] text-[var(--color-campo-700)]" : "bg-[#f3ead6] text-[#8a6d3b]"}`}
                          >
                            {lote.activo ? "Activo" : "Inactivo"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.78rem]">
                          <span className="text-gray-500">{ha.toFixed(2)} ha</span>
                          <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                            {selected && !editingLoteId && (
                              <Button variant="link" onClick={() => onOpenFicha(lote.id)}>
                                Ver ficha
                              </Button>
                            )}
                            {enEdicion ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="primary" onClick={() => onSaveEditLote()} disabled={guardando}>
                                  Guardar límite
                                </Button>
                                <Button variant="secondary" onClick={() => onDeshacerEditLote()} disabled={guardando || !puedeDeshacerLote} className="disabled:opacity-50">
                                  Deshacer
                                </Button>
                                <Button variant="secondary" onClick={() => onCancelEditLote()} disabled={guardando}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : selected ? (
                              <Button variant="link" onClick={() => onStartEditLote(lote.id)} hidden={!puede("editar_geometria_lotes")} disabled={guardando || Boolean(operacionBatch)}>
                                Editar límite
                              </Button>
                            ) : null}

                            {!enEdicion && (
                              <details className="group relative">
                                <summary
                                  aria-label={`Más opciones: Lote ${lote.numero}`}
                                  title="Más opciones"
                                  className="flex h-6 w-6 list-none items-center justify-center rounded-full text-gray-400 transition-colors marker:content-none hover:bg-gray-100 hover:text-gray-700 [&::-webkit-details-marker]:hidden"
                                >
                                  <svg width="13" height="13" viewBox="0 0 4 16" fill="currentColor" aria-hidden="true">
                                    <circle cx="2" cy="2" r="1.7" />
                                    <circle cx="2" cy="8" r="1.7" />
                                    <circle cx="2" cy="14" r="1.7" />
                                  </svg>
                                </summary>
                                <div className="absolute right-0 z-20 mt-1 flex w-36 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg">
                                  <button
                                    type="button"
                                    disabled={guardando || drawMode !== "idle" || editingBoundary || Boolean(editingLoteId)}
                                    className="cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={(e) => { onToggleFavorito(lote.id); e.currentTarget.closest("details")?.removeAttribute("open"); }}
                                  >
                                    {lote.favorito ? "Quitar favorito" : "Marcar favorito"}
                                  </button>
                                  <button
                                    type="button"
                                    hidden={!puede("editar_lotes")}
                                    className="cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-gray-700 hover:bg-gray-50"
                                    onClick={(e) => { onRenameLote(lote.id); e.currentTarget.closest("details")?.removeAttribute("open"); }}
                                  >
                                    Apodo
                                  </button>
                                  <button
                                    type="button"
                                    hidden={!puede("activar_lotes")}
                                    className="cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-gray-700 hover:bg-gray-50"
                                    onClick={(e) => { onToggleActivoLote(lote.id); e.currentTarget.closest("details")?.removeAttribute("open"); }}
                                  >
                                    {lote.activo ? "Desactivar" : "Activar"}
                                  </button>
                                  <button
                                    type="button"
                                    hidden={!puede("eliminar_lotes")}
                                    className="cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-red-700 hover:bg-red-50"
                                    onClick={(e) => { onDeleteLote(lote.id); e.currentTarget.closest("details")?.removeAttribute("open"); }}
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </details>
                            )}
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
