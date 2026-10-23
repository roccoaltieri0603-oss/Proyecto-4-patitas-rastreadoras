import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { eliminarUsoLote, finalizarJornada, iniciarJornada, modificarJornada, registrarUsoLote, type DatosJornada, type UsoLote } from "../api/historial";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import ConfirmModal from "./ConfirmModal";
import Button from "./ui/Button";
import Modal, { MODAL_CARD_CLASS } from "./ui/Modal";
import { APAGADO, PASTILLA_CLARA, PASTILLA_VERDE, TARJETA, VOLANTA } from "./ui/PantallaDatos";

/**
 * Jornada de pastoreo, cargada a mano: cuándo entraron y salieron los
 * animales, cuántos por categoría de la planilla de campo y la altura del
 * remanente al salir. No hay GPS ni dispositivos detrás.
 */

const TARJETA_INTERIOR = "rounded-2xl border border-gray-200/80 bg-white p-[18px]";
const ETIQUETA = "text-[0.72rem] font-bold tracking-[0.06em] text-gray-500 uppercase";
const CAMPO = "mt-1 min-h-[38px] rounded-lg border border-gray-200 bg-white px-3 text-sm";
const ZONA = "America/Argentina/Buenos_Aires";

/** Valor para un <input type="datetime-local">, en la hora del dispositivo. */
function aCampoFechaHora(fecha: Date): string {
  const dos = (valor: number) => String(valor).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

/** El campo viene en hora local; el backend recibe un instante ISO con zona. */
function desdeCampoFechaHora(valor: string): string {
  return new Date(valor).toISOString();
}

function hoy(): string {
  return aCampoFechaHora(new Date()).slice(0, 10);
}

export function momento(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function fechaCorta(calendario: string): string {
  const [anio, mes, dia] = calendario.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(Date.UTC(anio, mes - 1, dia)));
}

/** "40 adultos, 10 terneros": sólo las categorías cargadas. */
export function describirAnimales(uso: UsoLote): string | null {
  const partes = [
    uso.animales.adultos ? `${uso.animales.adultos} ${uso.animales.adultos === 1 ? "adulto" : "adultos"}` : null,
    uso.animales.toretesVaconas ? `${uso.animales.toretesVaconas} toretes o vaconas` : null,
    uso.animales.terneros ? `${uso.animales.terneros} ${uso.animales.terneros === 1 ? "ternero" : "terneros"}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/** Una línea por uso, para el historial: lo que se cargó, sin rellenar lo que falta. */
export function describirUso(uso: UsoLote): string {
  if (!uso.ingresoAt) return `${fechaCorta(uso.fecha)} · sólo fecha, sin horario`;
  const partes = [
    uso.salidaAt ? `${momento(uso.ingresoAt)} → ${momento(uso.salidaAt)}` : `Desde ${momento(uso.ingresoAt)} · animales adentro`,
    uso.diasOcupacion !== null ? `${uso.diasOcupacion.toLocaleString("es-AR")} días` : null,
    describirAnimales(uso),
    uso.alturaRemanenteCm !== null ? `remanente ${uso.alturaRemanenteCm.toLocaleString("es-AR")} cm` : uso.salidaAt ? "remanente sin medir" : null,
  ].filter(Boolean);
  return partes.join(" · ");
}

function mensajeError(error: unknown, porDefecto: string): string {
  return error instanceof ApiError ? error.message : porDefecto;
}

function numeroOpcional(valor: string): number | null {
  if (valor.trim() === "") return null;
  return Number(valor);
}

interface ValoresFormulario {
  entrada: string;
  adultos: string;
  toretesVaconas: string;
  terneros: string;
  yaSalieron: boolean;
  salida: string;
  altura: string;
}

function valoresDesde(uso: UsoLote | null): ValoresFormulario {
  const ahora = aCampoFechaHora(new Date());
  return {
    entrada: uso?.ingresoAt ? aCampoFechaHora(new Date(uso.ingresoAt)) : ahora,
    adultos: uso?.animales.adultos?.toString() ?? "",
    toretesVaconas: uso?.animales.toretesVaconas?.toString() ?? "",
    terneros: uso?.animales.terneros?.toString() ?? "",
    yaSalieron: Boolean(uso?.salidaAt),
    salida: uso?.salidaAt ? aCampoFechaHora(new Date(uso.salidaAt)) : ahora,
    altura: uso?.alturaRemanenteCm?.toString() ?? "",
  };
}

/** Lo que el usuario puede corregir antes de mandar; el backend vuelve a validar todo. */
function problemaDe(valores: ValoresFormulario): string | null {
  const animales = [valores.adultos, valores.toretesVaconas, valores.terneros].map(numeroOpcional);
  if (animales.some((valor) => valor !== null && (!Number.isInteger(valor) || valor < 0))) return "La cantidad de animales tiene que ser un número entero.";
  if (animales.reduce<number>((suma, valor) => suma + (valor ?? 0), 0) === 0) return "Indicá cuántos animales entraron.";
  if (valores.yaSalieron && new Date(valores.salida) <= new Date(valores.entrada)) return "La salida tiene que ser posterior a la entrada.";
  const altura = numeroOpcional(valores.altura);
  if (valores.yaSalieron && altura !== null && (!(altura > 0) || altura > 300)) return "La altura del remanente tiene que estar entre 0 y 300 cm.";
  return null;
}

function datosDesde(valores: ValoresFormulario): DatosJornada & { ingresoAt: string } {
  return {
    ingresoAt: desdeCampoFechaHora(valores.entrada),
    adultos: numeroOpcional(valores.adultos),
    toretesVaconas: numeroOpcional(valores.toretesVaconas),
    terneros: numeroOpcional(valores.terneros),
    salidaAt: valores.yaSalieron ? desdeCampoFechaHora(valores.salida) : null,
    alturaRemanenteCm: valores.yaSalieron ? numeroOpcional(valores.altura) : null,
  };
}

function CamposJornada({ valores, onCambio, deshabilitado, permitirAbierta }: {
  valores: ValoresFormulario;
  onCambio: (valores: ValoresFormulario) => void;
  deshabilitado: boolean;
  /** Al editar una jornada que ya salió no se ofrece reabrirla. */
  permitirAbierta: boolean;
}) {
  const ahora = aCampoFechaHora(new Date());
  const cambiar = (campo: keyof ValoresFormulario) => (evento: React.ChangeEvent<HTMLInputElement>) =>
    onCambio({ ...valores, [campo]: evento.target.type === "checkbox" ? evento.target.checked : evento.target.value });
  return <div className="flex flex-col gap-3">
    <label className="flex flex-col">
      <span className={ETIQUETA}>Entrada del ganado</span>
      <input className={CAMPO} type="datetime-local" required max={ahora} value={valores.entrada} disabled={deshabilitado} onChange={cambiar("entrada")} />
    </label>
    <fieldset className="m-0 border-0 p-0">
      <legend className={ETIQUETA}>Animales que entran</legend>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {([["adultos", "Adultos"], ["toretesVaconas", "Toretes o vaconas"], ["terneros", "Terneros o terneras"]] as const).map(([campo, nombre]) =>
          <label key={campo} className="flex flex-col text-[0.78rem] text-gray-600">
            {nombre}
            <input className={CAMPO} type="number" inputMode="numeric" min={0} step={1} value={valores[campo]} disabled={deshabilitado} onChange={cambiar(campo)} />
          </label>)}
      </div>
    </fieldset>
    {permitirAbierta && <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={valores.yaSalieron} disabled={deshabilitado} onChange={cambiar("yaSalieron")} />
      Los animales ya salieron (registrar un pastoreo terminado)
    </label>}
    {valores.yaSalieron && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex flex-col">
        <span className={ETIQUETA}>Salida del ganado</span>
        <input className={CAMPO} type="datetime-local" required min={valores.entrada} max={ahora} value={valores.salida} disabled={deshabilitado} onChange={cambiar("salida")} />
      </label>
      <label className="flex flex-col">
        <span className={ETIQUETA}>Altura del remanente (cm)</span>
        <input className={CAMPO} type="number" inputMode="decimal" min={0} max={300} step={0.5} placeholder="Si se midió" value={valores.altura} disabled={deshabilitado} onChange={cambiar("altura")} />
      </label>
    </div>}
  </div>;
}

/** Qué se va a borrar, dicho de forma que se reconozca antes de confirmar. */
export function mensajeBorrarUso(uso: UsoLote): string {
  const cual = uso.ingresoAt
    ? `la jornada que empezó el ${momento(uso.ingresoAt)}${describirAnimales(uso) ? ` (${describirAnimales(uso)})` : ""}`
    : `el uso del ${fechaCorta(uso.fecha)}`;
  return `Se borra ${cual}. Deja de figurar en la planilla y de contar para el descanso y la condición del lote. No se puede deshacer.`;
}

/** Editar una jornada ya cargada, desde el historial de usos. */
export function EditarJornadaModal({ loteId, uso, onGuardado, onCancelar }: { loteId: string; uso: UsoLote; onGuardado: () => void; onCancelar: () => void }) {
  const { establecimientoId } = useEstablecimiento();
  const [valores, setValores] = useState(() => valoresDesde(uso));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    const problema = problemaDe(valores);
    if (problema) { setError(problema); return; }
    setGuardando(true); setError(null);
    try {
      const datos = datosDesde(valores);
      // Una jornada abierta sigue abierta al editarla: la salida se carga con "Finalizar".
      await modificarJornada(establecimientoId, loteId, uso.id, uso.enCurso ? { ...datos, salidaAt: undefined, alturaRemanenteCm: undefined } : datos);
      onGuardado();
    } catch (motivo) {
      setError(mensajeError(motivo, "No se pudo guardar la jornada."));
    } finally { setGuardando(false); }
  }

  return <Modal onDismiss={onCancelar}>
    <form className={MODAL_CARD_CLASS} onMouseDown={(evento) => evento.stopPropagation()} onSubmit={guardar}>
      <h2 className="m-0 text-lg">Editar jornada de pastoreo</h2>
      <CamposJornada valores={valores} onCambio={setValores} deshabilitado={guardando} permitirAbierta={false} />
      {error && <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Button>
      </div>
    </form>
  </Modal>;
}

interface JornadaPastoreoPanelProps {
  loteId: string;
  ultimoUso: (UsoLote & { fechaFin: string }) | null;
  diasDescanso: number | null;
  /** Se llama después de guardar, para recargar la ficha. */
  onCambio: () => Promise<void> | void;
}

export default function JornadaPastoreoPanel({ loteId, ultimoUso, diasDescanso, onCambio }: JornadaPastoreoPanelProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const [valores, setValores] = useState(() => valoresDesde(null));
  const [salida, setSalida] = useState(() => aCampoFechaHora(new Date()));
  const [altura, setAltura] = useState("");
  const [fechaSola, setFechaSola] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<UsoLote | null>(null);
  const abierta = ultimoUso?.enCurso ? ultimoUso : null;
  const puedeRegistrar = puede("registrar_usos");
  // Borrar usa el mismo permiso que editar o borrar un uso desde el historial.
  const puedeBorrar = puede("modificar_usos");

  async function borrar() {
    if (!aBorrar) return;
    const uso = aBorrar;
    setABorrar(null);
    await ejecutar(() => eliminarUsoLote(establecimientoId, loteId, uso.id), "No se pudo borrar la jornada.");
  }

  async function ejecutar(accion: () => Promise<unknown>, porDefecto: string) {
    setGuardando(true); setError(null);
    try { await accion(); await onCambio(); }
    catch (motivo) { setError(mensajeError(motivo, porDefecto)); }
    finally { setGuardando(false); }
  }

  async function iniciar(evento: React.FormEvent) {
    evento.preventDefault();
    const problema = problemaDe(valores);
    if (problema) { setError(problema); return; }
    await ejecutar(async () => { await iniciarJornada(establecimientoId, loteId, datosDesde(valores)); setValores(valoresDesde(null)); }, "No se pudo iniciar la jornada.");
  }

  async function finalizar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!abierta?.ingresoAt) return;
    if (new Date(salida) <= new Date(abierta.ingresoAt)) { setError("La salida tiene que ser posterior a la entrada."); return; }
    const alturaCm = numeroOpcional(altura);
    if (alturaCm !== null && (!(alturaCm > 0) || alturaCm > 300)) { setError("La altura del remanente tiene que estar entre 0 y 300 cm."); return; }
    await ejecutar(async () => {
      await finalizarJornada(establecimientoId, loteId, abierta.id, { salidaAt: desdeCampoFechaHora(salida), alturaRemanenteCm: alturaCm });
      setAltura(""); setSalida(aCampoFechaHora(new Date()));
    }, "No se pudo finalizar la jornada.");
  }

  return <section className={`${TARJETA} p-[22px]`}>
    <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
      <div><p className={VOLANTA}>Registro de campo</p><h2 className="m-0 text-[1.3rem] font-semibold text-gray-900">Jornada de pastoreo</h2></div>
      <Link className={`${PASTILLA_CLARA} no-underline`} to={`/establecimientos/${establecimientoId}/registro-usos?loteId=${loteId}`}>Ver planilla del potrero</Link>
    </div>

    {abierta ? <div className={`${TARJETA_INTERIOR} border-l-[6px] border-l-[var(--color-campo-600)]`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong className="block text-[1.1rem] text-gray-900">Hay animales en el lote</strong>
        {puedeBorrar && <Button variant="link-danger" disabled={guardando} onClick={() => setABorrar(abierta)}>Borrar jornada</Button>}
      </div>
      <p className={`${APAGADO} m-0 mt-1`}>
        Entraron el {abierta.ingresoAt ? momento(abierta.ingresoAt) : "—"}{describirAnimales(abierta) ? ` · ${describirAnimales(abierta)}` : ""}
      </p>
      {puedeRegistrar && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={finalizar}>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Salida del ganado</span>
          <input className={CAMPO} type="datetime-local" required min={abierta.ingresoAt ? aCampoFechaHora(new Date(abierta.ingresoAt)) : undefined} max={aCampoFechaHora(new Date())} value={salida} disabled={guardando} onChange={(evento) => setSalida(evento.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Altura del remanente (cm)</span>
          <input className={CAMPO} type="number" inputMode="decimal" min={0} max={300} step={0.5} placeholder="Si se midió" value={altura} disabled={guardando} onChange={(evento) => setAltura(evento.target.value)} />
        </label>
        <button type="submit" className={PASTILLA_VERDE} disabled={guardando}>{guardando ? "Guardando..." : "Finalizar jornada"}</button>
      </form>}
    </div> : <div className="grid grid-cols-1 items-start gap-[14px] md:grid-cols-2">
      <div className={TARJETA_INTERIOR}>
        <div className="flex items-start justify-between gap-2">
          <p className={`${ETIQUETA} m-0`}>Último pastoreo</p>
          {ultimoUso && puedeBorrar && <Button variant="link-danger" disabled={guardando} onClick={() => setABorrar(ultimoUso)}>Borrar</Button>}
        </div>
        {ultimoUso ? <>
          <strong className="mt-1 block text-gray-900">{diasDescanso === null ? "Sin datos" : `Descansa hace ${diasDescanso} ${diasDescanso === 1 ? "día" : "días"}`}</strong>
          <p className={`${APAGADO} m-0 mt-1`}>{ultimoUso.salidaAt ? `Salieron el ${momento(ultimoUso.salidaAt)}` : `Uso del ${fechaCorta(ultimoUso.fecha)}, sin horario`}{describirAnimales(ultimoUso) ? ` · ${describirAnimales(ultimoUso)}` : ""}{ultimoUso.alturaRemanenteCm !== null ? ` · remanente ${ultimoUso.alturaRemanenteCm} cm` : ""}</p>
        </> : <strong className="mt-1 block text-gray-900">Sin pastoreos registrados</strong>}
      </div>

      {puedeRegistrar && <form className={TARJETA_INTERIOR} onSubmit={iniciar}>
        <p className={`${ETIQUETA} m-0 mb-3`}>{valores.yaSalieron ? "Registrar un pastoreo terminado" : "Iniciar jornada"}</p>
        <CamposJornada valores={valores} onCambio={setValores} deshabilitado={guardando} permitirAbierta />
        <button type="submit" className={`${PASTILLA_VERDE} mt-3`} disabled={guardando}>
          {guardando ? "Guardando..." : valores.yaSalieron ? "Guardar pastoreo" : "Iniciar jornada"}
        </button>
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer">¿No sabés la hora ni los animales? Registrá sólo la fecha</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input className={CAMPO} type="date" max={hoy()} value={fechaSola} disabled={guardando} onChange={(evento) => setFechaSola(evento.target.value)} aria-label="Fecha del pastoreo" />
            <button type="button" className={PASTILLA_CLARA} disabled={!fechaSola || guardando}
              onClick={() => void ejecutar(async () => { await registrarUsoLote(establecimientoId, loteId, fechaSola); setFechaSola(""); }, "No se pudo registrar el uso.")}>
              Registrar fecha
            </button>
          </div>
        </details>
      </form>}
    </div>}

    {error && <p role="alert" className="mt-3 mb-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}

    {aBorrar && <ConfirmModal
      title={aBorrar.ingresoAt ? "Borrar jornada de pastoreo" : "Borrar uso"}
      message={mensajeBorrarUso(aBorrar)}
      confirmText="Borrar"
      onCancel={() => setABorrar(null)}
      onConfirm={() => void borrar()}
    />}
  </section>;
}
