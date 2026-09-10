// Mockup de la pantalla de dispositivos GPS: conexión y batería de los collares.
//
// Todavía NO hay backend de GPS (ver CLAUDE.md y docs/OPEN_QUESTIONS.md). Esta
// pantalla existe para fijar la forma de la interfaz y, sobre todo, el contrato
// de datos que el backend tiene que devolver (src/api/dispositivos.ts).
// Mientras el backend no exista, los datos salen de src/demo/dispositivosSimulados.ts
// y la pantalla lo avisa arriba de todo, bien visible.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { ApiError } from "../api/client";
import {
  obtenerDispositivos,
  obtenerHistorialBateria,
  type Dispositivo,
  type EstadoConexion,
  type MuestraBateria,
} from "../api/dispositivos";
import {
  DISPOSITIVOS_SIMULADOS,
  USAR_DISPOSITIVOS_SIMULADOS,
  historialBateriaSimulado,
} from "../demo/dispositivosSimulados";
import Button from "../components/ui/Button";

// Mismas constantes de estilo que la ficha de lote, para que las dos pantallas
// de datos se vean iguales.
const TARJETA = "rounded-2xl border border-gray-200 bg-white shadow-[0_3px_12px_rgba(30,58,95,0.06)]";
const TEXTO_APAGADO = "text-[0.9rem] text-gray-500";
const VOLANTA = "mb-1 text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[#2f855a]";
const TITULO_SECCION = "m-0 text-brand";

/** Debajo de este porcentaje el collar necesita atención. Provisional, producto no lo definió. */
const BATERIA_BAJA_PORCENTAJE = 20;

const ETIQUETAS_CONEXION: Record<EstadoConexion, string> = {
  "en-linea": "En línea",
  "sin-senal": "Sin señal",
  "nunca-conectado": "Nunca conectado",
};

const COLORES_CONEXION: Record<EstadoConexion, string> = {
  "en-linea": "bg-green-100 text-green-800",
  "sin-senal": "bg-amber-100 text-amber-800",
  "nunca-conectado": "bg-gray-200 text-gray-600",
};

function nombreVisible(dispositivo: Dispositivo): string {
  return dispositivo.apodo ?? dispositivo.identificadorEquipo;
}

function tieneBateriaBaja(dispositivo: Dispositivo): boolean {
  return dispositivo.bateriaPorcentaje !== null && dispositivo.bateriaPorcentaje < BATERIA_BAJA_PORCENTAJE;
}

function formatearUltimaSenal(ultimaSenal: string | null): string {
  if (!ultimaSenal) return "Sin datos";
  const minutos = Math.floor((Date.now() - new Date(ultimaSenal).getTime()) / 60000);
  if (minutos < 1) return "Hace menos de un minuto";
  if (minutos < 60) return `Hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;
  return `Hace ${Math.floor(horas / 24)} días`;
}

function formatearMomento(momento: string): string {
  return new Date(momento).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function formatearCoordenada(valor: number): string {
  return valor.toFixed(5);
}

function mensajeDeError(motivo: unknown): string {
  if (motivo instanceof ApiError) return motivo.message;
  return "No se pudieron cargar los dispositivos. Intentá nuevamente.";
}

function AvisoDatosSimulados() {
  return (
    <div
      role="note"
      className="mx-auto mb-[18px] max-w-[1180px] rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <strong>Pantalla de prueba.</strong> Todavía no hay dispositivos GPS reales ni backend que los
      guarde: lo que ves abajo son datos simulados para acordar el diseño y qué información tiene que
      devolver el servidor. Nada de esto se persiste.
    </div>
  );
}

function ChipConexion({ conexion }: { conexion: EstadoConexion }) {
  return (
    <span className={`rounded-full px-3 py-1.5 text-[0.8rem] font-extrabold ${COLORES_CONEXION[conexion]}`}>
      {ETIQUETAS_CONEXION[conexion]}
    </span>
  );
}

function BarraBateria({ porcentaje }: { porcentaje: number | null }) {
  // Sin dato es "Sin datos", nunca 0%: un collar que no reporta no es un collar descargado.
  if (porcentaje === null) return <p className={TEXTO_APAGADO}>Batería: Sin datos</p>;
  const color = porcentaje < BATERIA_BAJA_PORCENTAJE ? "bg-red-500" : porcentaje < 50 ? "bg-amber-500" : "bg-green-600";
  return (
    <div>
      <div className="mb-1 flex justify-between text-[0.82rem] text-gray-500">
        <span>Batería</span>
        <strong className="text-brand">{porcentaje}%</strong>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="img"
        aria-label={`Batería ${porcentaje} por ciento`}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}

function TarjetaResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <article className={`${TARJETA} p-4`}>
      <span className="block text-gray-500">{etiqueta}</span>
      <strong className="mt-[7px] block text-[1.35rem] text-brand">{valor}</strong>
    </article>
  );
}

function TarjetaDispositivo({
  dispositivo,
  seleccionado,
  onSeleccionar,
}: {
  dispositivo: Dispositivo;
  seleccionado: boolean;
  onSeleccionar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSeleccionar}
      aria-pressed={seleccionado}
      className={`${TARJETA} w-full cursor-pointer p-[18px] text-left transition-colors ${seleccionado ? "border-brand ring-2 ring-brand/30" : "hover:border-gray-300"}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong className="block text-brand">{nombreVisible(dispositivo)}</strong>
          <span className={TEXTO_APAGADO}>{dispositivo.identificadorEquipo}</span>
        </div>
        <ChipConexion conexion={dispositivo.conexion} />
      </div>
      <BarraBateria porcentaje={dispositivo.bateriaPorcentaje} />
      <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 text-[0.85rem] sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Última señal</dt>
          <dd className="m-0">{formatearUltimaSenal(dispositivo.ultimaSenal)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Lote</dt>
          <dd className="m-0">{dispositivo.numeroLote === null ? "Sin datos" : `Lote ${dispositivo.numeroLote}`}</dd>
        </div>
      </dl>
    </button>
  );
}

function GraficoBateria({ muestras }: { muestras: MuestraBateria[] }) {
  if (muestras.length < 2) return <p className={TEXTO_APAGADO}>Sin historial de batería.</p>;
  const ancho = 320;
  const alto = 90;
  const margen = 6;
  const posicionX = (indice: number) => margen + (indice / (muestras.length - 1)) * (ancho - margen * 2);
  const posicionY = (porcentaje: number) => margen + ((100 - porcentaje) / 100) * (alto - margen * 2);
  const linea = muestras.map((muestra, indice) => `${posicionX(indice)},${posicionY(muestra.porcentaje)}`).join(" ");
  return (
    <svg
      className="mt-2 block h-[90px] w-full"
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label="Evolución de la batería"
    >
      <rect x={margen} y={margen} width={ancho - margen * 2} height={alto - margen * 2} fill="#f8fafc" />
      <line x1={margen} x2={ancho - margen} y1={posicionY(50)} y2={posicionY(50)} stroke="#e5e7eb" />
      <polyline points={linea} fill="none" stroke="#2f855a" strokeWidth="3" />
    </svg>
  );
}

function PanelDetalleDispositivo({
  dispositivo,
  historialBateria,
  onCerrar,
}: {
  dispositivo: Dispositivo;
  historialBateria: MuestraBateria[];
  onCerrar: () => void;
}) {
  return (
    <aside className={`${TARJETA} h-fit p-[22px]`} aria-label={`Detalle de ${nombreVisible(dispositivo)}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className={VOLANTA}>Detalle</p>
          <h2 className={`${TITULO_SECCION} text-[1.2rem]`}>{nombreVisible(dispositivo)}</h2>
        </div>
        <Button variant="secondary" size="sm" onClick={onCerrar}>Cerrar</Button>
      </div>
      <ChipConexion conexion={dispositivo.conexion} />
      <div className="mt-4">
        <BarraBateria porcentaje={dispositivo.bateriaPorcentaje} />
        <p className={`${TEXTO_APAGADO} mt-3`}>Últimas 12 horas</p>
        <GraficoBateria muestras={historialBateria} />
      </div>
      <dl className="mt-4 flex flex-col gap-2 text-[0.88rem]">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Identificador</dt>
          <dd className="m-0">{dispositivo.identificadorEquipo}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Última señal</dt>
          <dd className="m-0">{dispositivo.ultimaSenal ? formatearMomento(dispositivo.ultimaSenal) : "Sin datos"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Latitud</dt>
          <dd className="m-0">{dispositivo.ubicacion ? formatearCoordenada(dispositivo.ubicacion.latitud) : "Sin datos"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Longitud</dt>
          <dd className="m-0">{dispositivo.ubicacion ? formatearCoordenada(dispositivo.ubicacion.longitud) : "Sin datos"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Precisión</dt>
          <dd className="m-0">
            {dispositivo.ubicacion?.precisionMetros === null || !dispositivo.ubicacion
              ? "Sin datos"
              : `± ${dispositivo.ubicacion.precisionMetros} m`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Lote</dt>
          <dd className="m-0">{dispositivo.numeroLote === null ? "Sin datos" : `Lote ${dispositivo.numeroLote}`}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Animal</dt>
          <dd className="m-0">{dispositivo.animalId ?? "Sin asignar"}</dd>
        </div>
      </dl>
      <p className={`${TEXTO_APAGADO} mt-4`}>
        Falta definir con producto cada cuánto reporta el equipo, desde cuándo se considera "sin
        señal" y con qué batería hay que avisar.
      </p>
    </aside>
  );
}

export default function PantallaDispositivosGps() {
  const { establecimientoId, establecimiento } = useEstablecimiento();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [idSeleccionado, setIdSeleccionado] = useState<string | null>(null);
  const [historialBateria, setHistorialBateria] = useState<MuestraBateria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDispositivos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // Mientras no exista el backend, los datos salen del módulo de demo.
      setDispositivos(USAR_DISPOSITIVOS_SIMULADOS ? DISPOSITIVOS_SIMULADOS : await obtenerDispositivos(establecimientoId));
    } catch (motivo) {
      setError(mensajeDeError(motivo));
    } finally {
      setCargando(false);
    }
  }, [establecimientoId]);

  useEffect(() => { void cargarDispositivos(); }, [cargarDispositivos]);

  const dispositivoSeleccionado = useMemo(
    () => dispositivos.find((dispositivo) => dispositivo.id === idSeleccionado) ?? null,
    [dispositivos, idSeleccionado],
  );

  useEffect(() => {
    if (!dispositivoSeleccionado) { setHistorialBateria([]); return; }
    if (USAR_DISPOSITIVOS_SIMULADOS) {
      setHistorialBateria(historialBateriaSimulado(dispositivoSeleccionado));
      return;
    }
    let vigente = true;
    obtenerHistorialBateria(establecimientoId, dispositivoSeleccionado.id)
      .then((muestras) => { if (vigente) setHistorialBateria(muestras); })
      .catch(() => { if (vigente) setHistorialBateria([]); });
    return () => { vigente = false; };
  }, [dispositivoSeleccionado, establecimientoId]);

  const enLinea = dispositivos.filter((dispositivo) => dispositivo.conexion === "en-linea").length;
  const sinSenal = dispositivos.filter((dispositivo) => dispositivo.conexion !== "en-linea").length;
  const conBateriaBaja = dispositivos.filter(tieneBateriaBaja).length;

  const estadoDePantalla = "grid min-h-screen place-content-center justify-items-center gap-2.5 bg-gray-100 p-6 text-center";
  if (cargando) return <main className={estadoDePantalla}><p>Cargando dispositivos...</p></main>;

  return (
    <main className="min-h-screen bg-gray-100 px-4 pt-7 pb-14 text-gray-800 md:px-[clamp(16px,4vw,64px)]">
      <header className="mx-auto mb-6 max-w-[1180px]">
        <Link className="font-bold text-brand no-underline" to={`/establecimientos/${establecimientoId}`}>
          ← Volver al mapa
        </Link>
        <div className="mt-[18px]">
          <p className={VOLANTA}>Dispositivos GPS</p>
          <h1 className={`${TITULO_SECCION} text-[clamp(1.8rem,4vw,2.7rem)]`}>Conexión y batería</h1>
          <p className="mt-1 text-gray-500">{establecimiento?.nombre ?? "Sin establecimiento"}</p>
        </div>
      </header>

      {USAR_DISPOSITIVOS_SIMULADOS && <AvisoDatosSimulados />}

      {error && (
        <div className="mx-auto mb-[18px] max-w-[1180px] rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="mx-auto mb-6 grid max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <TarjetaResumen etiqueta="Dispositivos" valor={String(dispositivos.length)} />
        <TarjetaResumen etiqueta="En línea" valor={String(enLinea)} />
        <TarjetaResumen etiqueta="Sin señal" valor={String(sinSenal)} />
        <TarjetaResumen etiqueta="Batería baja" valor={String(conBateriaBaja)} />
      </section>

      {dispositivos.length === 0 ? (
        <section className={`${TARJETA} mx-auto max-w-[1180px] p-[22px] text-center`}>
          <p className={TEXTO_APAGADO}>Todavía no hay dispositivos dados de alta en este establecimiento.</p>
        </section>
      ) : (
        <div className="mx-auto grid max-w-[1180px] gap-4 lg:grid-cols-[1fr_360px]">
          <section className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {dispositivos.map((dispositivo) => (
              <TarjetaDispositivo
                key={dispositivo.id}
                dispositivo={dispositivo}
                seleccionado={dispositivo.id === idSeleccionado}
                onSeleccionar={() => setIdSeleccionado(dispositivo.id === idSeleccionado ? null : dispositivo.id)}
              />
            ))}
          </section>
          {dispositivoSeleccionado && (
            <PanelDetalleDispositivo
              dispositivo={dispositivoSeleccionado}
              historialBateria={historialBateria}
              onCerrar={() => setIdSeleccionado(null)}
            />
          )}
        </div>
      )}
    </main>
  );
}
