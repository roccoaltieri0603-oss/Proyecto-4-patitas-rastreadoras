import { useState } from "react";
import { ApiError } from "../api/client";
import { simularPastoreo, type SimulacionPastoreo } from "../api/simulacion";

/**
 * Herramienta de DEMO para la presentación: muestra cómo reaccionaría el
 * sistema si el lote se pastoreara hoy.
 *
 * Todo lo que sale de acá es una simulación y va rotulado como tal. El punto
 * de partida no es un número elegido a mano: es el NDVI más bajo del historial
 * real de ese lote. La estimación de recuperación es la misma recta de mínimos
 * cuadrados que ya usa la ficha, leída contra el nivel habitual del lote.
 *
 * No registra un uso, no toca `usos_lote` ni el historial satelital, y no
 * persiste absolutamente nada: el estado vive en este componente y se pierde al
 * recargar o al cambiar de lote.
 */

interface SimulacionPastoreoPanelProps {
  loteId: string;
  /** Nombre del lote, sólo para el texto del cartel. */
  nombreLote: string;
}

const CAJA = "rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50 p-[22px]";
const BADGE = "inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-1 text-[0.68rem] font-extrabold tracking-[0.08em] text-white uppercase";
const BOTON = "cursor-pointer rounded-lg border-2 border-violet-600 bg-white px-4 py-2.5 text-sm font-bold text-violet-700 transition-colors hover:enabled:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60";
const DATO = "rounded-xl border border-violet-200 bg-white p-3.5";
const ETIQUETA = "block text-[0.7rem] font-bold uppercase tracking-[0.06em] text-violet-500";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export default function SimulacionPastoreoPanel({ loteId, nombreLote }: SimulacionPastoreoPanelProps) {
  const [simulacion, setSimulacion] = useState<SimulacionPastoreo | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simular() {
    if (simulando) return;
    setSimulando(true);
    setError(null);
    try {
      setSimulacion(await simularPastoreo(loteId));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo generar la simulación.");
    } finally {
      setSimulando(false);
    }
  }

  return <section className={`${CAJA} mx-auto mb-6 max-w-[1180px]`}>
    <div className="mb-4 flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
      <div>
        <span className={BADGE}>
          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
          Demo · no es un dato real
        </span>
        <h2 className="mt-2.5 mb-1 text-[1.35rem] text-violet-900">Simular pastoreo</h2>
        <p className="m-0 max-w-[62ch] text-[0.9rem] leading-snug text-violet-800">
          Herramienta de presentación: muestra qué diría el sistema si el ganado pastoreara
          hoy {nombreLote}. <strong>No registra un uso</strong> ni guarda nada en el historial.
        </p>
      </div>
      <button type="button" className={BOTON} onClick={simular} disabled={simulando}>
        {simulando ? "Simulando..." : "Simular pastoreo (demo)"}
      </button>
    </div>

    {error && <p className="m-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}

    {simulacion && <div className="flex flex-col gap-3 border-t-2 border-dashed border-violet-300 pt-4">
      <p className="m-0 text-[0.78rem] font-bold uppercase tracking-[0.06em] text-violet-600">
        Resultado simulado · {simulacion.puntosReales} fecha{simulacion.puntosReales === 1 ? "" : "s"} óptica{simulacion.puntosReales === 1 ? "" : "s"} real{simulacion.puntosReales === 1 ? "" : "es"} detrás
        {simulacion.origen === "copernicus" && " · serie consultada a Copernicus, no guardada"}
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <article className={DATO}>
          <span className={ETIQUETA}>Partida simulada</span>
          <strong className="mt-1 block text-[1.3rem] text-violet-900">
            {simulacion.piso ? `NDVI ${simulacion.piso.ndvi.toFixed(2)}` : "Sin datos"}
          </strong>
          <small className="block text-[0.78rem] leading-snug text-violet-700">
            {simulacion.piso
              ? `Mínimo real del lote, observado el ${fecha(simulacion.piso.fecha)} · puntaje ${simulacion.piso.puntaje}`
              : "El lote no tiene observaciones ópticas persistidas"}
          </small>
        </article>

        <article className={DATO}>
          <span className={ETIQUETA}>Se considera recuperado en</span>
          <strong className="mt-1 block text-[1.3rem] text-violet-900">
            {simulacion.umbralRecuperado === null ? "Sin datos" : `Puntaje ${Math.round(simulacion.umbralRecuperado)}`}
          </strong>
          <small className="block text-[0.78rem] leading-snug text-violet-700">
            Nivel habitual del propio lote: la mediana de los puntajes de su serie real
          </small>
        </article>

        <article className={DATO}>
          <span className={ETIQUETA}>Recuperación estimada</span>
          <strong className="mt-1 block text-[1.3rem] text-violet-900">
            {simulacion.recuperacion ? `~${simulacion.recuperacion.dias} días` : "No se puede estimar"}
          </strong>
          <small className="block text-[0.78rem] leading-snug text-violet-700">
            {simulacion.recuperacion
              ? `Al ritmo de su propia serie: +${simulacion.recuperacion.pendienteSemanal.toFixed(1)} puntos por semana`
              : "La serie real del lote no alcanza para proyectar"}
          </small>
        </article>
      </div>

      {simulacion.mensaje && (
        <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[0.85rem] leading-snug text-amber-900">
          {simulacion.mensaje}
        </p>
      )}

      <p className="m-0 text-[0.78rem] leading-snug text-violet-700">
        Proyección lineal simple sobre los puntajes reales del lote — no es un modelo entrenado
        ni una recomendación de manejo. Nada de esto se guardó: al recargar la página desaparece
        y volvés a ver sólo el estado real.
      </p>

      <div>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-[0.82rem] font-semibold text-violet-700 underline"
          onClick={() => { setSimulacion(null); setError(null); }}
        >
          Salir de la simulación
        </button>
      </div>
    </div>}
  </section>;
}
