// Mockup de la pantalla de dispositivos GPS: conexión y batería de los collares.
//
// Todavía NO hay backend de GPS (ver CLAUDE.md y docs/OPEN_QUESTIONS.md). Esta
// pantalla existe para fijar la forma de la interfaz y, sobre todo, el contrato
// de datos que el backend tiene que devolver (src/api/dispositivos.ts).
// Mientras el backend no exista, los datos salen de src/demo/dispositivosSimulados.ts
// y la pantalla lo avisa arriba de todo, bien visible.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
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
import PantallaDatos, { EstadoDePantalla, TARJETA, TITULO_SECCION, VOLANTA, APAGADO as TEXTO_APAGADO } from "../components/ui/PantallaDatos";

/** Debajo de este porcentaje el collar necesita atención. Provisional, producto no lo definió. */
const BATERIA_BAJA_PORCENTAJE = 20;

const ETIQUETAS_CONEXION: Record<EstadoConexion, string> = {
  "en-linea": "En línea",
  "sin-senal": "Sin señal",
  "nunca-conectado": "Nunca conectado",
};

const COLORES_CONEXION: Record<EstadoConexion, string> = {
  "en-linea": "bg-green-50 text-green-800",
  "sin-senal": "bg-amber-50 text-amber-800",
  "nunca-conectado": "bg-gray-100 text-gray-500",
};

const COLORES_PUNTO_CONEXION: Record<EstadoConexion, string> = {
  "en-linea": "bg-green-600",
  "sin-senal": "bg-amber-500",
  "nunca-conectado": "bg-gray-400",
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
    <div role="note" className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-900">
      <strong>Pantalla de prueba.</strong> Todavía no hay dispositivos GPS reales ni backend que los
      guarde: lo que ves abajo son datos simulados para acordar el diseño y qué información tiene que
      devolver el servidor. Nada de esto se persiste.
    </div>
  );
}

function ChipConexion({ conexion }: { conexion: EstadoConexion }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold ${COLORES_CONEXION[conexion]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${COLORES_PUNTO_CONEXION[conexion]}`} />
      {ETIQUETAS_CONEXION[conexion]}
    </span>
  );
}

function BarraBateria({ porcentaje }: { porcentaje: number | null }) {
  // Sin dato es "Sin datos", nunca 0%: un collar que no reporta no es un collar descargado.
  const color = porcentaje === null
    ? ""
    : porcentaje < BATERIA_BAJA_PORCENTAJE ? "bg-red-500" : porcentaje < 50 ? "bg-amber-500" : "bg-green-600";
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[0.78rem]">
        <span className="text-gray-500">Batería</span>
        <strong className={porcentaje === null ? "font-normal text-gray-400" : "text-gray-900"}>
          {porcentaje === null ? "Sin datos" : `${porcentaje}%`}
        </strong>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/80"
        role="img"
        aria-label={porcentaje === null ? "Batería sin datos" : `Batería ${porcentaje} por ciento`}
      >
        {porcentaje !== null && <div className={`h-full rounded-full ${color}`} style={{ width: `${porcentaje}%` }} />}
      </div>
    </div>
  );
}

function TarjetaResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <article className={`${TARJETA} p-4`}>
      <span className="block text-[0.78rem] text-gray-500">{etiqueta}</span>
      <strong className="mt-2 block text-[1.9rem] leading-none font-semibold text-gray-900">{valor}</strong>
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
      className={`${TARJETA} w-full cursor-pointer p-5 text-left transition-colors ${seleccionado ? "ring-2 ring-[var(--color-lima)]" : "hover:bg-white"}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-[0.98rem] font-semibold text-gray-900">{nombreVisible(dispositivo)}</strong>
          <span className="block truncate text-[0.78rem] text-gray-400">{dispositivo.identificadorEquipo}</span>
        </div>
        <ChipConexion conexion={dispositivo.conexion} />
      </div>
      <BarraBateria porcentaje={dispositivo.bateriaPorcentaje} />
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-200/70 pt-3 text-[0.85rem]">
        <div>
          <dt className="text-[0.74rem] text-gray-400">Última señal</dt>
          <dd className="m-0 mt-0.5 text-gray-900">{formatearUltimaSenal(dispositivo.ultimaSenal)}</dd>
        </div>
        <div>
          <dt className="text-[0.74rem] text-gray-400">Lote</dt>
          <dd className="m-0 mt-0.5 text-gray-900">{dispositivo.numeroLote === null ? "Sin datos" : `Lote ${dispositivo.numeroLote}`}</dd>
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
          <h2 className="m-0 text-[1.2rem] font-semibold text-gray-900">{nombreVisible(dispositivo)}</h2>
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

  useOcultarDock(cargando);

  if (cargando) return <EstadoDePantalla><p>Cargando dispositivos...</p></EstadoDePantalla>;

  return (
    <PantallaDatos
      volanta={establecimiento?.nombre ?? "Establecimiento"}
      titulo="Ganado"
      subtitulo="Dispositivos GPS, conexión y batería"
      encabezadoExtra={
        <>
          {USAR_DISPOSITIVOS_SIMULADOS && <AvisoDatosSimulados />}
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
              {error}
            </div>
          )}
        </>
      }
    >
      <section className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <TarjetaResumen etiqueta="Dispositivos" valor={String(dispositivos.length)} />
        <TarjetaResumen etiqueta="En línea" valor={String(enLinea)} />
        <TarjetaResumen etiqueta="Sin señal" valor={String(sinSenal)} />
        <TarjetaResumen etiqueta="Batería baja" valor={String(conBateriaBaja)} />
      </section>

      {dispositivos.length === 0 ? (
        <section className={`${TARJETA} p-[22px] text-center`}>
          <p className={TEXTO_APAGADO}>Todavía no hay dispositivos dados de alta en este establecimiento.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className={TITULO_SECCION}>
            Collares <span className="font-normal text-gray-400">{dispositivos.length}</span>
          </h2>
          {/* La columna del detalle sólo existe cuando hay un collar elegido:
              si no, la grilla dejaría un tercio de la pantalla vacío. */}
          <div className={`grid gap-4 ${dispositivoSeleccionado ? "lg:grid-cols-[1fr_340px]" : ""}`}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {dispositivos.map((dispositivo) => (
                <TarjetaDispositivo
                  key={dispositivo.id}
                  dispositivo={dispositivo}
                  seleccionado={dispositivo.id === idSeleccionado}
                  onSeleccionar={() => setIdSeleccionado(dispositivo.id === idSeleccionado ? null : dispositivo.id)}
                />
              ))}
            </div>
            {dispositivoSeleccionado && (
              <PanelDetalleDispositivo
                dispositivo={dispositivoSeleccionado}
                historialBateria={historialBateria}
                onCerrar={() => setIdSeleccionado(null)}
              />
            )}
          </div>
        </section>
      )}
    </PantallaDatos>
  );
}
