import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { crearMedicionAltura, eliminarMedicionAltura, obtenerMedicionesAltura, type MedicionAltura, type MomentoMedicion } from "../api/mediciones";
import { fechaCorta } from "../estimacion/presentacion";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import CamposMedicionAltura, { CAMPO, ETIQUETA, MEDICION_VACIA, datosDeMedicion, problemaMedicion, type ValoresMedicion } from "./CamposMedicionAltura";
import ConfirmModal from "./ConfirmModal";
import Button from "./ui/Button";
import AvisoInfo from "./ui/AvisoInfo";
import Modal from "./ui/Modal";
import { APAGADO, PASTILLA_CLARA, TARJETA, VOLANTA } from "./ui/PantallaDatos";

/**
 * Mediciones de altura del pasto, cargadas en el campo. Son observaciones
 * reales y se guardan en cm. Con ellas la estimación calcula el pasto en pie.
 */

const MODAL = "flex max-h-[90vh] w-[min(92vw,30rem)] flex-col gap-3 overflow-y-auto rounded-lg bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]";

export const NOMBRE_MOMENTO: Record<MomentoMedicion, string> = {
  recorrida: "en una recorrida",
  "antes-de-entrar": "antes de entrar",
  salida: "al sacar los animales",
};

function hoy(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function mensajeError(error: unknown, porDefecto: string): string {
  return error instanceof ApiError ? error.message : porDefecto;
}

export function describirMedicion(medicion: MedicionAltura): string {
  const desvio = medicion.desvioCm !== null ? ` ± ${medicion.desvioCm.toLocaleString("es-AR")}` : "";
  return `${fechaCorta(medicion.fecha)} · ${NOMBRE_MOMENTO[medicion.momento]} · ${medicion.instrumento} · ${medicion.alturaPromedioCm.toLocaleString("es-AR")}${desvio} cm · ${medicion.cantidadLecturas} lecturas`;
}

function CargarMedicionModal({ loteId, onGuardado, onCancelar }: { loteId: string; onGuardado: () => void; onCancelar: () => void }) {
  const { establecimientoId } = useEstablecimiento();
  const [fecha, setFecha] = useState(hoy());
  const [momento, setMomento] = useState<MomentoMedicion>("recorrida");
  const [valores, setValores] = useState<ValoresMedicion>({ ...MEDICION_VACIA, instrumento: "plato" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!fecha) { setError("Elegí el día de la medición."); return; }
    if (fecha > hoy()) { setError("La medición no puede tener fecha futura."); return; }
    const problema = problemaMedicion(valores);
    const datos = datosDeMedicion(valores);
    if (problema || !datos) { setError(problema ?? "Elegí el instrumento."); return; }
    setGuardando(true); setError(null);
    try {
      await crearMedicionAltura(establecimientoId, loteId, { ...datos, fecha, momento });
      onGuardado();
    } catch (motivo) {
      setError(mensajeError(motivo, "No se pudo guardar la medición."));
    } finally { setGuardando(false); }
  }

  return <Modal onDismiss={onCancelar}>
    <form noValidate className={MODAL} onMouseDown={(evento) => evento.stopPropagation()} onSubmit={guardar}>
      <h2 className="m-0 text-lg">Cargar medición de altura</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col">
          <span className={ETIQUETA}>Fecha</span>
          <input className={CAMPO} type="date" value={fecha} disabled={guardando} onChange={(evento) => setFecha(evento.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Cuándo</span>
          <select className={CAMPO} value={momento} disabled={guardando} onChange={(evento) => setMomento(evento.target.value as MomentoMedicion)}>
            <option value="recorrida">En una recorrida</option>
            <option value="antes-de-entrar">Antes de entrar los animales</option>
            <option value="salida">Al sacar los animales</option>
          </select>
        </label>
      </div>
      <CamposMedicionAltura valores={valores} onCambio={setValores} deshabilitado={guardando} permitirSinMedir={false} />
      {error && <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={guardando}>{guardando ? "Guardando..." : "Guardar medición"}</Button>
      </div>
    </form>
  </Modal>;
}

export default function MedicionesAlturaPanel({ loteId, refresco, onCambio }: { loteId: string; refresco: unknown; onCambio: () => Promise<void> | void }) {
  const { establecimientoId, puede } = useEstablecimiento();
  const [mediciones, setMediciones] = useState<MedicionAltura[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aBorrar, setABorrar] = useState<MedicionAltura | null>(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    obtenerMedicionesAltura(establecimientoId, loteId, { limit: 10 })
      .then((resultado) => { if (vigente) setMediciones(resultado); })
      .catch((motivo) => { if (vigente) { setMediciones([]); setError(mensajeError(motivo, "No se pudieron leer las mediciones.")); } });
    return () => { vigente = false; };
  }, [establecimientoId, loteId, refresco]);

  async function borrar() {
    if (!aBorrar) return;
    const medicion = aBorrar;
    setABorrar(null);
    try { await eliminarMedicionAltura(establecimientoId, loteId, medicion.id); await onCambio(); }
    catch (motivo) { setError(mensajeError(motivo, "No se pudo borrar la medición.")); }
  }

  return <section className={`${TARJETA} p-4 md:p-[22px]`}>
    <div className="mb-3 flex flex-col items-start justify-between gap-3 md:flex-row">
      <div>
        <p className={VOLANTA}>Registro de campo</p>
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-[1.3rem] font-semibold text-gray-900">Mediciones de altura</h2>
          <AvisoInfo tono="info" titulo="Mediciones de altura">Con plato o regla. El día que medís, la ficha dice cuánto pasto hay, si la pastura tiene una conversión a kilos con fuente.</AvisoInfo>
        </div>
      </div>
      {puede("registrar_usos") && <button type="button" className={PASTILLA_CLARA} onClick={() => setCargando(true)}>Cargar medición</button>}
    </div>
    {mediciones === null && !error && <p className={APAGADO}>Cargando…</p>}
    {mediciones?.length === 0 && !error && <p className={`${APAGADO} m-0`}>Todavía no hay mediciones de altura en este lote.</p>}
    {mediciones && mediciones.length > 0 && <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[0.9rem] text-gray-800">
      {mediciones.map((medicion) => <li key={medicion.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
        <span>{describirMedicion(medicion)}</span>
        {puede("modificar_usos") && <Button variant="link-danger" onClick={() => setABorrar(medicion)}>Borrar</Button>}
      </li>)}
    </ul>}
    {error && <p role="alert" className="mt-2 mb-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
    {cargando && <CargarMedicionModal loteId={loteId} onCancelar={() => setCargando(false)} onGuardado={() => { setCargando(false); void onCambio(); }} />}
    {aBorrar && <ConfirmModal
      title="Borrar medición"
      message={`Se borra la medición del ${describirMedicion(aBorrar)}. Deja de contar para el pasto en pie. No se puede deshacer.`}
      confirmText="Borrar"
      onCancel={() => setABorrar(null)}
      onConfirm={() => void borrar()}
    />}
  </section>;
}
