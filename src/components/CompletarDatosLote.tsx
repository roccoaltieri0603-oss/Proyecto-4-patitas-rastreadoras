import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import type { FaltaDelLote } from "../api/estimacion";
import { registrarUsoLote } from "../api/historial";
import { actualizarLote } from "../api/rodeo";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { NOMBRES_PASTURA, type Lote, type TipoPastura } from "../types";

export interface AccionesCompletarLote {
  onLoteActualizado: (lote: Lote) => void;
  onPastoreoRegistrado: () => void;
  onActualizarClima: (loteId: string) => void;
  actualizandoClima: boolean;
}

interface CompletarDatosLoteProps extends AccionesCompletarLote {
  loteId: string;
  falta: FaltaDelLote;
}

const DISPARADOR =
  "foco-campo inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--color-campo-600)]/30 bg-[var(--color-campo-50)] px-2.5 py-1 text-[0.72rem] font-semibold text-[var(--color-campo-700)] transition-colors duration-150 hover:bg-[var(--color-campo-100)] disabled:cursor-not-allowed disabled:opacity-50";
const GUARDAR =
  "foco-campo inline-flex cursor-pointer items-center rounded-full border-0 bg-[var(--color-verde-accion)] px-3.5 py-1.5 text-[0.75rem] font-semibold text-gray-900 transition-colors duration-150 hover:bg-[var(--color-lima)] disabled:cursor-not-allowed disabled:opacity-50";
const CANCELAR = "cursor-pointer border-0 bg-transparent px-1 py-1.5 text-[0.75rem] text-gray-500 hover:text-gray-800";
const CAMPO = "min-h-[34px] w-full rounded-lg border border-gray-200 bg-white px-2.5 text-[0.8rem] outline-none focus:border-[var(--color-campo-600)] focus:shadow-[0_0_0_3px_var(--color-campo-100)]";
const PREGUNTA = "text-[0.78rem] font-semibold leading-snug text-gray-800";
const ETIQUETA = "text-[0.66rem] font-bold tracking-[0.06em] text-gray-500 uppercase";

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function IconoMas() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function IconoActualizar({ girando }: { girando: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={girando ? "animate-spin" : ""}>
      <path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 1.5V5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DISPARA: Record<FaltaDelLote, { texto: string; permiso: "editar_lotes" | "registrar_usos" | "actualizar_clima" }> = {
  pastura: { texto: "Agregar pastura", permiso: "editar_lotes" },
  "ultimo-pastoreo": { texto: "Cargar último pastoreo", permiso: "registrar_usos" },
  clima: { texto: "Actualizar clima", permiso: "actualizar_clima" },
};

/**
 * El botón para cargar, sin salir del mapa, lo que le falta a un lote para
 * entrar al orden con su etapa real. La pastura y la fecha del último pastoreo
 * se guardan acá mismo; el pastoreo con hora y animales sigue en la ficha.
 */
export default function CompletarDatosLote({ loteId, falta, onLoteActualizado, onPastoreoRegistrado, onActualizarClima, actualizandoClima }: CompletarDatosLoteProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const idFormulario = useId();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoPastura | "">("");
  const [fecha, setFecha] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { texto, permiso } = DISPARA[falta];

  // Sin permiso para cargarlo, el lote igual dice qué le falta en su motivo.
  if (!puede(permiso)) return null;

  function cerrar() {
    setAbierto(false); setError(null); setTipo(""); setFecha("");
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (guardando) return;
    setGuardando(true); setError(null);
    try {
      if (falta === "pastura") {
        if (!tipo) return;
        onLoteActualizado(await actualizarLote(establecimientoId, loteId, { tipoPastura: tipo }));
      } else {
        if (!fecha) return;
        await registrarUsoLote(establecimientoId, loteId, fecha);
        onPastoreoRegistrado();
      }
      cerrar();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo guardar. Intentá nuevamente.");
    } finally { setGuardando(false); }
  }

  // Los clics del formulario no tienen que seleccionar el lote de la card que lo contiene.
  return (
    <div className="mt-2" onClick={(evento) => evento.stopPropagation()}>
      {falta === "clima" ? (
        <button type="button" className={DISPARADOR} disabled={actualizandoClima} onClick={() => onActualizarClima(loteId)}>
          <IconoActualizar girando={actualizandoClima} />
          {actualizandoClima ? "Actualizando clima…" : texto}
        </button>
      ) : !abierto ? (
        <button type="button" className={DISPARADOR} aria-expanded={false} aria-controls={idFormulario} onClick={() => setAbierto(true)}>
          <IconoMas />
          {texto}
        </button>
      ) : (
        <form id={idFormulario} onSubmit={guardar} className="flex flex-col gap-2 rounded-xl border border-[var(--color-campo-100)] bg-[var(--color-campo-50)]/70 p-2.5">
          {falta === "pastura" ? (
            <label className="flex flex-col gap-1">
              <span className={ETIQUETA}>Tipo de pastura</span>
              <select className={CAMPO} value={tipo} disabled={guardando} autoFocus onChange={(evento) => setTipo(evento.target.value as TipoPastura | "")}>
                <option value="">Elegí una…</option>
                {(Object.keys(NOMBRES_PASTURA) as TipoPastura[]).map((clave) => <option key={clave} value={clave}>{NOMBRES_PASTURA[clave]}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className={PREGUNTA}>¿Qué día salieron los animales por última vez?</span>
                <input className={CAMPO} type="date" max={hoy()} value={fecha} disabled={guardando} autoFocus onChange={(evento) => setFecha(evento.target.value)} />
              </label>
              <p className="m-0 text-[0.7rem] leading-snug text-gray-500">
                Si no la sabés, no hace falta inventarla: se sigue contando desde el alta del lote.{" "}
                <Link to={`/establecimientos/${establecimientoId}/lotes/${loteId}?cargar=pastoreo`} className="font-semibold text-[var(--color-campo-700)] underline underline-offset-2">
                  Con hora y animales, en la ficha
                </Link>
              </p>
            </>
          )}
          {error && <p role="alert" className="m-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[0.72rem] text-red-800">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="submit" className={GUARDAR} disabled={guardando || (falta === "pastura" ? !tipo : !fecha)}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className={CANCELAR} disabled={guardando} onClick={cerrar}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
