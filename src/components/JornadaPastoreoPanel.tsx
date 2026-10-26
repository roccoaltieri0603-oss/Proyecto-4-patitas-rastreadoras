import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { eliminarUsoLote, finalizarJornada, iniciarJornada, modificarJornada, registrarUsoLote, type DatosJornada, type UsoLote } from "../api/historial";
import { crearMedicionAltura, modificarMedicionAltura, obtenerMedicionesAltura, type MedicionAltura } from "../api/mediciones";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import CamposMedicionAltura, { MEDICION_VACIA, datosDeMedicion, problemaMedicion, valoresDeMedicion, type ValoresMedicion } from "./CamposMedicionAltura";
import ConfirmModal from "./ConfirmModal";
import Button from "./ui/Button";
import Modal, { MODAL_CARD_CLASS } from "./ui/Modal";
import { APAGADO, PASTILLA_CLARA, PASTILLA_VERDE, TARJETA, VOLANTA } from "./ui/PantallaDatos";

/**
 * Jornada de pastoreo, cargada a mano: cuándo entraron y salieron los
 * animales, cuántos por categoría de la planilla de campo y cómo quedó el lote
 * al salir. No hay GPS ni dispositivos detrás.
 *
 * Día y hora van en campos separados y sin límites del navegador: con un solo
 * campo de fecha y hora, los mínimos y máximos del navegador dejaban sin
 * ninguna hora válida al cargar un pastoreo terminado. Todo se valida acá,
 * con mensajes claros, y el backend vuelve a validar.
 */

const TARJETA_INTERIOR = "rounded-2xl border border-gray-200/80 bg-white p-[18px]";
const ETIQUETA = "text-[0.72rem] font-bold tracking-[0.06em] text-gray-500 uppercase";
const PREGUNTA = "m-0 text-[0.92rem] font-semibold text-gray-900";
const CAMPO = "mt-1 min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[var(--color-campo-600)] focus:shadow-[0_0_0_3px_var(--color-campo-100)]";
const BOTON_TEXTO = "cursor-pointer border-0 bg-transparent p-0 text-[0.8rem] font-semibold text-[var(--color-campo-700)] underline underline-offset-2 hover:text-[var(--color-campo-900)] disabled:cursor-not-allowed disabled:opacity-50";
const ZONA = "America/Argentina/Buenos_Aires";
/** Tolera relojes de dispositivo un poco adelantados, igual que el backend. */
const MARGEN_FUTURO_MS = 5 * 60_000;

/** Día y hora tal como los escribe el usuario, en la hora del dispositivo. */
interface Momento { fecha: string; hora: string }
const MOMENTO_VACIO: Momento = { fecha: "", hora: "" };

function dos(valor: number): string {
  return String(valor).padStart(2, "0");
}

export function momentoDe(fecha: Date): Momento {
  return { fecha: `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`, hora: `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}` };
}

export function instanteDe(momento: Momento): Date | null {
  if (!momento.fecha || !momento.hora) return null;
  const instante = new Date(`${momento.fecha}T${momento.hora}`);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

function hoy(): string {
  return momentoDe(new Date()).fecha;
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

interface Animales { adultos: string; toretesVaconas: string; terneros: string }
const SIN_ANIMALES: Animales = { adultos: "", toretesVaconas: "", terneros: "" };

function animalesDe(uso: UsoLote): Animales {
  return {
    adultos: uso.animales.adultos?.toString() ?? "",
    toretesVaconas: uso.animales.toretesVaconas?.toString() ?? "",
    terneros: uso.animales.terneros?.toString() ?? "",
  };
}

export function problemaAnimales(animales: Animales): string | null {
  const valores = [animales.adultos, animales.toretesVaconas, animales.terneros].map(numeroOpcional);
  if (valores.some((valor) => valor !== null && (!Number.isInteger(valor) || valor < 0))) return "La cantidad de animales tiene que ser un número entero.";
  if (valores.reduce<number>((suma, valor) => suma + (valor ?? 0), 0) === 0) return "Indicá cuántos animales entraron: al menos una categoría.";
  return null;
}

export function problemaMomento(valor: Momento, que: string): string | null {
  const instante = instanteDe(valor);
  if (!instante) return `Completá el día y la hora en que ${que}.`;
  if (instante.getTime() > Date.now() + MARGEN_FUTURO_MS) return `El momento en que ${que} no puede ser futuro.`;
  return null;
}

/** La salida contra la entrada, con la entrada dicha para que se entienda el error. */
export function problemaSalida(salida: Momento, entrada: Date | null): string | null {
  const problema = problemaMomento(salida, "salieron los animales");
  if (problema) return problema;
  const instanteSalida = instanteDe(salida) as Date;
  if (entrada && instanteSalida <= entrada) return `La salida tiene que ser después de la entrada (${momento(entrada.toISOString())}).`;
  return null;
}

function datosAnimales(animales: Animales): Pick<DatosJornada, "adultos" | "toretesVaconas" | "terneros"> {
  return { adultos: numeroOpcional(animales.adultos), toretesVaconas: numeroOpcional(animales.toretesVaconas), terneros: numeroOpcional(animales.terneros) };
}

/**
 * "¿Cómo quedó el lote?" se guarda como una medición de salida asociada al uso,
 * con la fecha del día en que salieron los animales. Si ya había una, se corrige.
 */
async function guardarRemanente(establecimientoId: string, loteId: string, usoId: string, diaSalida: string, remanente: ValoresMedicion, existente: MedicionAltura | null): Promise<void> {
  const datos = datosDeMedicion(remanente);
  if (!datos) return;
  const completa = { ...datos, fecha: diaSalida, momento: "salida" as const, usoId };
  if (existente) await modificarMedicionAltura(establecimientoId, loteId, existente.id, completa);
  else await crearMedicionAltura(establecimientoId, loteId, completa);
}

const AVISO_REMANENTE_SIN_GUARDAR = "El pastoreo se guardó, pero no la medición de cómo quedó el lote";

function CampoMomento({ etiqueta, valor, onCambio, deshabilitado }: { etiqueta: string; valor: Momento; onCambio: (valor: Momento) => void; deshabilitado: boolean }) {
  return <fieldset className="m-0 border-0 p-0">
    <div className="flex items-baseline justify-between gap-2">
      <legend className={ETIQUETA}>{etiqueta}</legend>
      <button type="button" className={BOTON_TEXTO} disabled={deshabilitado} onClick={() => onCambio(momentoDe(new Date()))}>Ahora</button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col text-[0.78rem] text-gray-600">
        Día
        <input className={CAMPO} type="date" value={valor.fecha} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valor, fecha: evento.target.value })} />
      </label>
      <label className="flex flex-col text-[0.78rem] text-gray-600">
        Hora
        <input className={CAMPO} type="time" value={valor.hora} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valor, hora: evento.target.value })} />
      </label>
    </div>
  </fieldset>;
}

function CamposAnimales({ valores, onCambio, deshabilitado }: { valores: Animales; onCambio: (valores: Animales) => void; deshabilitado: boolean }) {
  return <fieldset className="m-0 border-0 p-0">
    <legend className={ETIQUETA}>¿Cuántos animales?</legend>
    <div className="mt-1 grid grid-cols-3 items-end gap-2">
      {([["adultos", "Adultos"], ["toretesVaconas", "Toretes o vaconas"], ["terneros", "Terneros"]] as const).map(([campo, nombre]) =>
        <label key={campo} className="flex flex-col text-[0.78rem] text-gray-600">
          {nombre}
          <input className={CAMPO} type="number" inputMode="numeric" placeholder="0" value={valores[campo]} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valores, [campo]: evento.target.value })} />
        </label>)}
    </div>
    <p className="m-0 mt-1 text-[0.75rem] text-gray-500">Completá al menos una categoría; las otras pueden quedar vacías.</p>
  </fieldset>;
}

/** Medir es opcional: queda plegado para que no estorbe a quien no midió. */
function CamposRemanente({ valores, onCambio, deshabilitado, abierto = false }: { valores: ValoresMedicion; onCambio: (valores: ValoresMedicion) => void; deshabilitado: boolean; abierto?: boolean }) {
  return <details className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2" open={abierto || Boolean(valores.instrumento)}>
    <summary className="cursor-pointer text-[0.85rem] font-semibold text-gray-800">¿Cómo quedó el lote? <span className="font-normal text-gray-500">(opcional, si mediste la altura)</span></summary>
    <div className="mt-2"><CamposMedicionAltura valores={valores} onCambio={onCambio} deshabilitado={deshabilitado} permitirSinMedir /></div>
  </details>;
}

function Acciones({ guardando, textoGuardar, onCancelar }: { guardando: boolean; textoGuardar: string; onCancelar: () => void }) {
  return <div className="flex flex-wrap items-center gap-2">
    <button type="submit" className={PASTILLA_VERDE} disabled={guardando}>{guardando ? "Guardando..." : textoGuardar}</button>
    <button type="button" className="cursor-pointer border-0 bg-transparent px-2 py-2 text-sm text-gray-500 hover:text-gray-800" disabled={guardando} onClick={onCancelar}>Cancelar</button>
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
  const [entrada, setEntrada] = useState(() => uso.ingresoAt ? momentoDe(new Date(uso.ingresoAt)) : MOMENTO_VACIO);
  const [salida, setSalida] = useState(() => uso.salidaAt ? momentoDe(new Date(uso.salidaAt)) : MOMENTO_VACIO);
  const [animales, setAnimales] = useState(() => animalesDe(uso));
  const [remanente, setRemanente] = useState<ValoresMedicion>(MEDICION_VACIA);
  const [medicionSalida, setMedicionSalida] = useState<MedicionAltura | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una jornada abierta sigue abierta al editarla: la salida se carga con "Salieron los animales".
  const conSalida = Boolean(uso.salidaAt);

  useEffect(() => {
    if (!uso.salidaAt) return;
    let vigente = true;
    // Sin la migración 018 no hay mediciones: el bloque queda vacío y al guardar se informa.
    obtenerMedicionesAltura(establecimientoId, loteId, { usoId: uso.id })
      .then((mediciones) => {
        const medida = mediciones.find((medicion) => medicion.momento === "salida") ?? null;
        if (!vigente || !medida) return;
        setMedicionSalida(medida);
        setRemanente(valoresDeMedicion(medida));
      })
      .catch(() => {});
    return () => { vigente = false; };
  }, [establecimientoId, loteId, uso.id, uso.salidaAt]);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    const problema = problemaMomento(entrada, "entraron los animales") ?? problemaAnimales(animales)
      ?? (conSalida ? problemaSalida(salida, instanteDe(entrada)) ?? problemaMedicion(remanente) : null);
    if (problema) { setError(problema); return; }
    setGuardando(true); setError(null);
    try {
      await modificarJornada(establecimientoId, loteId, uso.id, {
        ingresoAt: (instanteDe(entrada) as Date).toISOString(),
        ...datosAnimales(animales),
        ...(conSalida ? { salidaAt: (instanteDe(salida) as Date).toISOString() } : {}),
      });
    } catch (motivo) {
      setError(mensajeError(motivo, "No se pudo guardar la jornada."));
      setGuardando(false);
      return;
    }
    try {
      if (conSalida) await guardarRemanente(establecimientoId, loteId, uso.id, salida.fecha, remanente, medicionSalida);
      onGuardado();
    } catch (motivo) {
      setError(`${AVISO_REMANENTE_SIN_GUARDAR}: ${mensajeError(motivo, "error desconocido")}.`);
    } finally { setGuardando(false); }
  }

  return <Modal onDismiss={onCancelar}>
    <form noValidate className={MODAL_CARD_CLASS} onMouseDown={(evento) => evento.stopPropagation()} onSubmit={guardar}>
      <h2 className="m-0 text-lg">Editar jornada de pastoreo</h2>
      <CampoMomento etiqueta="Entraron" valor={entrada} onCambio={setEntrada} deshabilitado={guardando} />
      <CamposAnimales valores={animales} onCambio={setAnimales} deshabilitado={guardando} />
      {conSalida && <>
        <CampoMomento etiqueta="Salieron" valor={salida} onCambio={setSalida} deshabilitado={guardando} />
        <CamposRemanente valores={remanente} onCambio={setRemanente} deshabilitado={guardando} />
      </>}
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
  /** Viene del orden de pastoreo: abre el formulario de un pastoreo terminado y lleva la vista hasta él. */
  enfocarPastoreoTerminado?: boolean;
}

/** Cuánto dura el resaltado al llegar desde el orden de pastoreo. */
const MS_RESALTADO = 2400;

type Formulario = "entrada" | "salida" | "terminado" | null;

export default function JornadaPastoreoPanel({ loteId, ultimoUso, diasDescanso, onCambio, enfocarPastoreoTerminado = false }: JornadaPastoreoPanelProps) {
  const { establecimientoId, puede } = useEstablecimiento();
  const abierta = ultimoUso?.enCurso ? ultimoUso : null;
  const [formulario, setFormulario] = useState<Formulario>(() => (enfocarPastoreoTerminado && !abierta ? "terminado" : null));
  const [entrada, setEntrada] = useState<Momento>(MOMENTO_VACIO);
  const [salida, setSalida] = useState<Momento>(MOMENTO_VACIO);
  const [animales, setAnimales] = useState<Animales>(SIN_ANIMALES);
  const [remanente, setRemanente] = useState<ValoresMedicion>(MEDICION_VACIA);
  const [fechaSola, setFechaSola] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<UsoLote | null>(null);
  const seccion = useRef<HTMLElement>(null);
  const [resaltada, setResaltada] = useState(false);
  const puedeRegistrar = puede("registrar_usos");
  // Borrar usa el mismo permiso que editar o borrar un uso desde el historial.
  const puedeBorrar = puede("modificar_usos");

  useEffect(() => {
    if (!enfocarPastoreoTerminado) return;
    seccion.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setResaltada(true);
    const temporizador = window.setTimeout(() => setResaltada(false), MS_RESALTADO);
    return () => window.clearTimeout(temporizador);
  }, [enfocarPastoreoTerminado]);

  /** Entrar y salir arrancan en "ahora", que es lo habitual; un pastoreo terminado, vacío. */
  function abrir(cual: Exclude<Formulario, null>) {
    setError(null);
    setAnimales(SIN_ANIMALES);
    setRemanente(MEDICION_VACIA);
    setFechaSola("");
    setEntrada(cual === "entrada" ? momentoDe(new Date()) : MOMENTO_VACIO);
    setSalida(cual === "salida" ? momentoDe(new Date()) : MOMENTO_VACIO);
    setFormulario(cual);
  }

  function cerrar() {
    setError(null);
    setFormulario(null);
  }

  async function ejecutar(accion: () => Promise<unknown>, porDefecto: string) {
    setGuardando(true); setError(null);
    try { await accion(); await onCambio(); cerrar(); }
    catch (motivo) { setError(mensajeError(motivo, porDefecto)); }
    finally { setGuardando(false); }
  }

  async function borrar() {
    if (!aBorrar) return;
    const uso = aBorrar;
    setABorrar(null);
    await ejecutar(() => eliminarUsoLote(establecimientoId, loteId, uso.id), "No se pudo borrar la jornada.");
  }

  /** Guarda la jornada y, después, cómo quedó el lote; si falla sólo lo segundo, lo dice sin perder lo primero. */
  async function conRemanente(guardarJornada: () => Promise<UsoLote>, diaSalida: string | null, porDefecto: string) {
    setGuardando(true); setError(null);
    let uso: UsoLote;
    try { uso = await guardarJornada(); }
    catch (motivo) { setError(mensajeError(motivo, porDefecto)); setGuardando(false); return; }
    let aviso: string | null = null;
    try {
      if (diaSalida) await guardarRemanente(establecimientoId, loteId, uso.id, diaSalida, remanente, null);
    } catch (motivo) {
      aviso = `${AVISO_REMANENTE_SIN_GUARDAR}: ${mensajeError(motivo, "error desconocido")}. Cargala con "Cargar medición".`;
    }
    try { await onCambio(); } finally {
      setGuardando(false);
      setFormulario(null);
      setError(aviso);
    }
  }

  function guardarEntrada(evento: React.FormEvent) {
    evento.preventDefault();
    const problema = problemaMomento(entrada, "entraron los animales") ?? problemaAnimales(animales);
    if (problema) { setError(problema); return; }
    void conRemanente(() => iniciarJornada(establecimientoId, loteId, { ingresoAt: (instanteDe(entrada) as Date).toISOString(), ...datosAnimales(animales), salidaAt: null }), null, "No se pudo registrar la entrada.");
  }

  function guardarSalida(evento: React.FormEvent) {
    evento.preventDefault();
    if (!abierta?.ingresoAt) return;
    const problema = problemaSalida(salida, new Date(abierta.ingresoAt)) ?? problemaMedicion(remanente);
    if (problema) { setError(problema); return; }
    void conRemanente(
      () => finalizarJornada(establecimientoId, loteId, abierta.id, { salidaAt: (instanteDe(salida) as Date).toISOString(), alturaRemanenteCm: null }),
      salida.fecha, "No se pudo registrar la salida.",
    );
  }

  function guardarTerminado(evento: React.FormEvent) {
    evento.preventDefault();
    const problema = problemaMomento(entrada, "entraron los animales") ?? problemaSalida(salida, instanteDe(entrada)) ?? problemaAnimales(animales) ?? problemaMedicion(remanente);
    if (problema) { setError(problema); return; }
    void conRemanente(
      () => iniciarJornada(establecimientoId, loteId, { ingresoAt: (instanteDe(entrada) as Date).toISOString(), ...datosAnimales(animales), salidaAt: (instanteDe(salida) as Date).toISOString() }),
      salida.fecha, "No se pudo guardar el pastoreo.",
    );
  }

  const FORMULARIO = `${TARJETA_INTERIOR} mt-[14px] flex flex-col gap-4`;

  return <section ref={seccion} className={`${TARJETA} scroll-mt-4 p-[22px] transition-shadow duration-500 ${resaltada ? "shadow-[0_0_0_3px_var(--color-lima)]" : ""}`}>
    <div className="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row">
      <div><p className={VOLANTA}>Registro de campo</p><h2 className="m-0 text-[1.3rem] font-semibold text-gray-900">Pastoreo</h2></div>
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
    </div> : <div className={TARJETA_INTERIOR}>
      <div className="flex items-start justify-between gap-2">
        <p className={`${ETIQUETA} m-0`}>Último pastoreo</p>
        {ultimoUso && puedeBorrar && <Button variant="link-danger" disabled={guardando} onClick={() => setABorrar(ultimoUso)}>Borrar</Button>}
      </div>
      {ultimoUso ? <>
        <strong className="mt-1 block text-gray-900">{diasDescanso === null ? "Sin datos" : `Descansa hace ${diasDescanso} ${diasDescanso === 1 ? "día" : "días"}`}</strong>
        <p className={`${APAGADO} m-0 mt-1`}>{ultimoUso.salidaAt ? `Salieron el ${momento(ultimoUso.salidaAt)}` : `Uso del ${fechaCorta(ultimoUso.fecha)}, sin horario`}{describirAnimales(ultimoUso) ? ` · ${describirAnimales(ultimoUso)}` : ""}{ultimoUso.alturaRemanenteCm !== null ? ` · remanente ${ultimoUso.alturaRemanenteCm} cm` : ""}</p>
      </> : <strong className="mt-1 block text-gray-900">Sin pastoreos registrados</strong>}
    </div>}

    {puedeRegistrar && formulario === null && <div className="mt-[14px] flex flex-wrap gap-2">
      {abierta
        ? <button type="button" className={PASTILLA_VERDE} onClick={() => abrir("salida")}>Salieron los animales</button>
        : <>
          <button type="button" className={PASTILLA_VERDE} onClick={() => abrir("entrada")}>Entraron animales</button>
          <button type="button" className={PASTILLA_CLARA} onClick={() => abrir("terminado")}>Cargar un pastoreo que ya terminó</button>
        </>}
    </div>}

    {formulario === "entrada" && <form noValidate className={FORMULARIO} onSubmit={guardarEntrada}>
      <p className={PREGUNTA}>Entraron animales</p>
      <CampoMomento etiqueta="¿Cuándo entraron?" valor={entrada} onCambio={setEntrada} deshabilitado={guardando} />
      <CamposAnimales valores={animales} onCambio={setAnimales} deshabilitado={guardando} />
      {error && <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
      <Acciones guardando={guardando} textoGuardar="Guardar entrada" onCancelar={cerrar} />
    </form>}

    {formulario === "salida" && abierta && <form noValidate className={FORMULARIO} onSubmit={guardarSalida}>
      <p className={PREGUNTA}>Salieron los animales</p>
      <CampoMomento etiqueta="¿Cuándo salieron?" valor={salida} onCambio={setSalida} deshabilitado={guardando} />
      <CamposRemanente valores={remanente} onCambio={setRemanente} deshabilitado={guardando} />
      {error && <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
      <Acciones guardando={guardando} textoGuardar="Guardar salida" onCancelar={cerrar} />
    </form>}

    {formulario === "terminado" && <form noValidate className={FORMULARIO} onSubmit={guardarTerminado}>
      <p className={PREGUNTA}>Cargar un pastoreo que ya terminó</p>
      <CampoMomento etiqueta="¿Cuándo entraron?" valor={entrada} onCambio={setEntrada} deshabilitado={guardando} />
      <CampoMomento etiqueta="¿Cuándo salieron?" valor={salida} onCambio={setSalida} deshabilitado={guardando} />
      <CamposAnimales valores={animales} onCambio={setAnimales} deshabilitado={guardando} />
      <CamposRemanente valores={remanente} onCambio={setRemanente} deshabilitado={guardando} />
      {error && <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
      <Acciones guardando={guardando} textoGuardar="Guardar pastoreo" onCancelar={cerrar} />
      <div className="border-t border-gray-100 pt-3">
        <p className="m-0 text-[0.82rem] text-gray-600">¿No sabés las horas ni los animales? Registrá sólo el día en que salieron:</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input className={`${CAMPO} mt-0 w-auto`} type="date" value={fechaSola} disabled={guardando} onChange={(evento) => setFechaSola(evento.target.value)} aria-label="Día en que salieron los animales" />
          <button type="button" className={PASTILLA_CLARA} disabled={!fechaSola || guardando}
            onClick={() => {
              if (fechaSola > hoy()) { setError("El día del pastoreo no puede ser futuro."); return; }
              void ejecutar(() => registrarUsoLote(establecimientoId, loteId, fechaSola), "No se pudo registrar el día.");
            }}>
            Registrar sólo el día
          </button>
        </div>
      </div>
    </form>}

    {formulario === null && error && <p role="alert" className="mt-3 mb-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}

    {aBorrar && <ConfirmModal
      title={aBorrar.ingresoAt ? "Borrar jornada de pastoreo" : "Borrar uso"}
      message={mensajeBorrarUso(aBorrar)}
      confirmText="Borrar"
      onCancel={() => setABorrar(null)}
      onConfirm={() => void borrar()}
    />}
  </section>;
}
