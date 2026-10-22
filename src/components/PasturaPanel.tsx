import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { actualizarLote } from "../api/rodeo";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { NOMBRES_PASTURA, type Lote, type TipoPastura } from "../types";
import { APAGADO, PASTILLA_VERDE, TARJETA, VOLANTA } from "./ui/PantallaDatos";

interface PasturaPanelProps {
  lote: Lote;
  onGuardado: (lote: Lote) => void;
}

const CAMPO = "mt-1 min-h-[38px] rounded-lg border border-gray-200 bg-white px-3 text-sm";
const ETIQUETA = "text-[0.72rem] font-bold tracking-[0.06em] text-gray-400 uppercase";

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

/**
 * Tipo de pastura y fecha de siembra del lote. Sin tipo cargado, la ficha dice
 * "Sin tipo de pastura": la estimación de forraje no elige una por su cuenta.
 */
export default function PasturaPanel({ lote, onGuardado }: PasturaPanelProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const [tipo, setTipo] = useState<TipoPastura | "">(lote.tipoPastura ?? "");
  const [siembra, setSiembra] = useState(lote.fechaSiembra ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTipo(lote.tipoPastura ?? "");
    setSiembra(lote.fechaSiembra ?? "");
  }, [lote.tipoPastura, lote.fechaSiembra]);

  const sinCambios = tipo === (lote.tipoPastura ?? "") && siembra === (lote.fechaSiembra ?? "");

  async function guardar() {
    if (guardando || sinCambios) return;
    setGuardando(true); setError(null);
    try {
      onGuardado(await actualizarLote(establecimientoId, lote.id, { tipoPastura: tipo || null, fechaSiembra: siembra || null }));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo guardar la pastura. Intentá nuevamente.");
    } finally { setGuardando(false); }
  }

  return <section className={`${TARJETA} p-[22px]`}>
    <p className={VOLANTA}>Pastura</p>
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <strong className="block text-[1.05rem] text-gray-900">{lote.tipoPastura ? NOMBRES_PASTURA[lote.tipoPastura] : "Sin tipo de pastura"}</strong>
        <p className={`${APAGADO} m-0 mt-1`}>{lote.fechaSiembra ? `Sembrada el ${fecha(lote.fechaSiembra)}` : "Sin fecha de siembra"}</p>
      </div>
      {puede("editar_lotes") && <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className={ETIQUETA}>Tipo de pastura</span>
          <select className={CAMPO} value={tipo} disabled={guardando} onChange={(event) => setTipo(event.target.value as TipoPastura | "")}>
            <option value="">Sin tipo de pastura</option>
            {(Object.keys(NOMBRES_PASTURA) as TipoPastura[]).map((clave) => <option key={clave} value={clave}>{NOMBRES_PASTURA[clave]}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Fecha de siembra</span>
          <input className={CAMPO} type="date" max={hoy()} value={siembra} disabled={guardando} onChange={(event) => setSiembra(event.target.value)} />
        </label>
        <button type="button" className={PASTILLA_VERDE} onClick={guardar} disabled={guardando || sinCambios}>{guardando ? "Guardando..." : "Guardar pastura"}</button>
      </div>}
    </div>
    {error && <p role="alert" className="mt-3 mb-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
  </section>;
}
