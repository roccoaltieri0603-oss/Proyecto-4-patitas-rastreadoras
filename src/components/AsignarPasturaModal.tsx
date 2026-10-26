import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api/client";
import { asignarPasturaLotes } from "../api/rodeo";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { NOMBRES_PASTURA, type Lote, type TipoPastura } from "../types";
import Modal from "./ui/Modal";

interface AsignarPasturaModalProps {
  lotes: Lote[];
  /** Los lotes tildados en la lista; puede estar vacío si se va a aplicar a todos. */
  seleccionados: string[];
  onGuardado: (lotes: Lote[]) => void;
  onCancelar: () => void;
}

const TARJETA = "flex max-h-[90vh] w-[min(92vw,30rem)] flex-col gap-4 overflow-y-auto rounded-[24px] bg-white p-5 shadow-[0_12px_36px_rgba(0,0,0,0.25)] md:p-6";
const VOLANTA = "m-0 text-[0.68rem] font-bold tracking-[0.08em] text-[var(--color-campo-700)] uppercase";
const GUARDAR =
  "foco-campo inline-flex cursor-pointer items-center rounded-full border-0 bg-[var(--color-verde-accion)] px-4 py-2 text-[0.85rem] font-semibold text-gray-900 transition-colors duration-150 hover:bg-[var(--color-lima)] disabled:cursor-not-allowed disabled:opacity-50";
const CANCELAR = "foco-campo cursor-pointer rounded-full border-0 bg-transparent px-3 py-2 text-[0.85rem] text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed";

/** A qué lotes va la pastura: los tildados, o todos los activos si se eligió aplicar a todos. En orden de número. */
export function lotesDestino(lotes: Lote[], seleccionados: string[], aTodos: boolean): Lote[] {
  return lotes
    .filter((lote) => lote.activo && (aTodos || seleccionados.includes(lote.id)))
    .sort((a, b) => a.numero - b.numero);
}

/** Los que ya tienen otra pastura: se avisa antes de reemplazarla. */
export function lotesQueCambian(destino: Lote[], tipo: TipoPastura | ""): Lote[] {
  return tipo ? destino.filter((lote) => lote.tipoPastura !== null && lote.tipoPastura !== tipo) : [];
}

function nombreLote(lote: Lote): string {
  return lote.apodo ? `Lote ${lote.numero} · ${lote.apodo}` : `Lote ${lote.numero}`;
}

function IconoCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Elegir una pastura y guardarla en varios lotes a la vez. Se abre desde
 * "Seleccionar varios"; con "Todos los lotes activos" no hace falta tildarlos.
 */
export default function AsignarPasturaModal({ lotes, seleccionados, onGuardado, onCancelar }: AsignarPasturaModalProps) {
  const { establecimientoId } = useEstablecimiento();
  const idTitulo = useId();
  const activos = lotes.filter((lote) => lote.activo);
  const [aTodos, setATodos] = useState(seleccionados.length === 0);
  const [tipo, setTipo] = useState<TipoPastura | "">("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destino = lotesDestino(lotes, seleccionados, aTodos);
  const cambian = lotesQueCambian(destino, tipo);
  const cantidad = destino.length;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!tipo || cantidad === 0 || guardando) return;
    setGuardando(true); setError(null);
    try {
      onGuardado(await asignarPasturaLotes(establecimientoId, destino.map((lote) => lote.id), tipo));
    } catch (motivo) {
      setError(motivo instanceof ApiError ? motivo.message : "No se pudo guardar la pastura. Intentá nuevamente.");
      setGuardando(false);
    }
  }

  // Al body: dentro de la sidebar, su backdrop-filter encerraría el overlay fixed en ella.
  return createPortal(
    <Modal onDismiss={() => { if (!guardando) onCancelar(); }}>
      <form noValidate className={TARJETA} role="dialog" aria-modal="true" aria-labelledby={idTitulo} onMouseDown={(evento) => evento.stopPropagation()} onSubmit={guardar}>
        <div>
          <p className={VOLANTA}>Pastura</p>
          <h2 id={idTitulo} className="m-0 mt-0.5 text-[1.3rem] font-semibold text-gray-900">Asignar pastura a varios lotes</h2>
          <p className="m-0 mt-1 text-[0.85rem] text-gray-500">Elegí una pastura y se guarda en todos los lotes de una vez.</p>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[0.78rem] font-semibold text-gray-800">¿Qué pastura tienen?</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {(Object.keys(NOMBRES_PASTURA) as TipoPastura[]).map((clave) => {
              const elegida = tipo === clave;
              return (
                <label
                  key={clave}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[0.84rem] transition-colors duration-150 has-[:focus-visible]:shadow-[0_0_0_3px_var(--color-campo-100)] ${elegida ? "border-[var(--color-campo-600)] bg-[var(--color-campo-50)] font-semibold text-[var(--color-campo-900)]" : "border-gray-200 bg-white text-gray-700 hover:border-[var(--color-campo-600)]/50 hover:bg-[var(--color-campo-50)]/60"}`}
                >
                  <input type="radio" name="tipo-pastura" value={clave} checked={elegida} disabled={guardando} onChange={() => setTipo(clave)} className="sr-only" />
                  <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${elegida ? "border-[var(--color-campo-700)] bg-[var(--color-campo-700)] text-white" : "border-gray-300 bg-white"}`}>
                    {elegida && <IconoCheck />}
                  </span>
                  {NOMBRES_PASTURA[clave]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors ${aTodos ? "border-[var(--color-campo-600)]/40 bg-[var(--color-campo-50)]" : "border-gray-200 bg-gray-50/60"}`}>
          <input type="checkbox" checked={aTodos} disabled={guardando} onChange={(evento) => setATodos(evento.target.checked)} className="peer sr-only" />
          <span aria-hidden="true" className={`relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors duration-200 peer-focus-visible:shadow-[0_0_0_3px_var(--color-campo-100)] ${aTodos ? "bg-[var(--color-campo-700)]" : "bg-gray-300"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${aTodos ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[0.84rem] font-semibold text-gray-900">Ponérsela a todos los lotes activos ({activos.length})</span>
            <span className="text-[0.75rem] leading-snug text-gray-500">
              {seleccionados.length === 0 ? "No tildaste ningún lote: para elegir algunos, cerrá y tildalos en la lista." : `Si no, sólo a los ${seleccionados.length} que tildaste.`}
            </span>
          </span>
        </label>

        <div>
          <p className="m-0 mb-1.5 text-[0.78rem] font-semibold text-gray-800">{cantidad === 1 ? "Se guarda en 1 lote" : `Se guarda en ${cantidad} lotes`}</p>
          {cantidad > 0 ? (
            <ul className="m-0 flex max-h-28 list-none flex-wrap gap-1.5 overflow-y-auto p-0">
              {destino.map((lote) => (
                <li key={lote.id} className={`rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold ${cambian.includes(lote) ? "bg-amber-100 text-amber-900" : "bg-[var(--color-campo-100)] text-[var(--color-campo-700)]"}`}>
                  {nombreLote(lote)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[0.8rem] text-gray-500">Ningún lote: tildá alguno en la lista o activá "todos los lotes activos".</p>
          )}
        </div>

        {cambian.length > 0 && (
          <p role="status" className="m-0 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[0.8rem] leading-snug text-amber-950">
            {cambian.length === 1 ? "1 lote ya tiene" : `${cambian.length} lotes ya tienen`} otra pastura cargada ({[...new Set(cambian.map((lote) => NOMBRES_PASTURA[lote.tipoPastura as TipoPastura]))].join(", ")}): se va a reemplazar por {NOMBRES_PASTURA[tipo as TipoPastura]}.
          </p>
        )}
        {error && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 p-2.5 text-[0.8rem] text-red-800">{error}</p>}

        <div className="flex items-center justify-end gap-1 border-t border-gray-100 pt-3">
          <button type="button" className={CANCELAR} disabled={guardando} onClick={onCancelar}>Cancelar</button>
          <button type="submit" className={GUARDAR} disabled={!tipo || cantidad === 0 || guardando}>
            {guardando ? "Guardando…" : cantidad === 1 ? "Asignar a 1 lote" : `Asignar a ${cantidad} lotes`}
          </button>
        </div>
      </form>
    </Modal>,
    document.body,
  );
}
