// Planilla de uso de potreros, armada sobre los registros de uso que el
// establecimiento lleva en `usos_lote`, con las jornadas de pastoreo que el
// usuario carga a mano: entrada y salida con hora, animales por categoría y
// altura del remanente.
//
// La tabla sigue el diseño nuevo: siete columnas (lote, ingreso, salida, días,
// animales, carga y descanso) en lugar de los encabezados agrupados de la
// planilla en papel. Lo que el diseño no muestra como columna propia no se
// perdió: la superficie y el origen van bajo el nombre del lote, el detalle por
// categoría bajo el total de animales y el remanente bajo la salida.
//
// Lo que un renglón no tiene —un uso viejo sin hora, una jornada todavía
// abierta— queda en una raya que dice "sin datos" al pasar el mouse, y nunca se
// completa con un valor inventado.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useEstablecimiento } from "../hooks/useEstablecimiento";
import { useOcultarDock } from "../hooks/useOcultarDock";
import { ApiError } from "../api/client";
import {
  descargarRegistroDeUsosExcel,
  obtenerRegistroDeUsos,
  type LoteDelRegistro,
  type RegistroDeUso,
  type RegistroDeUsos,
} from "../api/registroUsos";
import Button from "../components/ui/Button";
import PantallaDatos, { EstadoDePantalla, TARJETA, PASTILLA_VERDE, APAGADO as TEXTO_APAGADO } from "../components/ui/PantallaDatos";

const ETIQUETA_FILTRO = "block text-[0.72rem] font-bold uppercase tracking-[0.06em] text-gray-500";
const CAMPO_FILTRO = "mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800";

const ENCABEZADO = "bg-gray-100/80 px-3 py-2.5 text-left text-[0.82rem] font-medium text-gray-500 first:rounded-l-xl last:rounded-r-xl";
const CELDA = "border-b border-gray-100 px-3 py-3 align-top";
const SUBLINEA = "block text-[0.75rem] text-gray-400";

const POR_PAGINA = 50;

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function nombreLote(lote: LoteDelRegistro | undefined): string {
  if (!lote) return "Lote sin identificar";
  return lote.apodo ? `Lote ${lote.numero} · ${lote.apodo}` : `Lote ${lote.numero}`;
}

function superficie(lote: LoteDelRegistro | undefined): string | null {
  if (!lote || lote.hectareas === null) return null;
  return `${lote.hectareas.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}

function mensajeDeError(motivo: unknown): string {
  if (motivo instanceof ApiError) return motivo.message;
  return "No se pudo cargar el registro de uso. Intentá nuevamente.";
}

/**
 * Celda sin dato. El diseño la deja en una raya; el `title` la explica con
 * palabras, porque una raya sola no dice nada en un lector de pantalla.
 */
function Vacio({ motivo = "Sin datos" }: { motivo?: string }) {
  return <span className="cursor-help text-gray-300" title={motivo}>—</span>;
}

const ZONA = "America/Argentina/Buenos_Aires";

/** Fecha y hora del campo, separadas: "20/10/2026" y "08:30". */
function fechaDe(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

function horaDe(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function Momento({ iso }: { iso: string }) {
  return <>{fechaDe(iso)}<span className={SUBLINEA}>{horaDe(iso)}</span></>;
}

/** Detalle por categoría, sólo con las que se cargaron. */
function detalleAnimales(animales: RegistroDeUso["animales"]): string | null {
  const partes: string[] = [];
  if (animales.adultos !== null) partes.push(`${animales.adultos} adultos`);
  if (animales.toretesVaconas !== null) partes.push(`${animales.toretesVaconas} toretes o vaconas`);
  if (animales.terneros !== null) partes.push(`${animales.terneros} terneros`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

function Encabezados() {
  return (
    <thead>
      <tr>
        <th className={ENCABEZADO} scope="col">Lote</th>
        <th className={ENCABEZADO} scope="col">Ingreso</th>
        <th className={ENCABEZADO} scope="col">Salida</th>
        <th className={ENCABEZADO} scope="col">Días</th>
        <th className={ENCABEZADO} scope="col">Animales</th>
        <th className={ENCABEZADO} scope="col">Carga (cab/ha)</th>
        <th className={ENCABEZADO} scope="col">Descanso</th>
      </tr>
    </thead>
  );
}

function Fila({ registro, lote }: { registro: RegistroDeUso; lote: LoteDelRegistro | undefined }) {
  const hectareas = superficie(lote);
  const detalle = detalleAnimales(registro.animales);
  return (
    <tr className="hover:bg-[#f7faf8]">
      <th scope="row" className={`${CELDA} text-left font-normal text-gray-900`}>
        {nombreLote(lote)}
        <span className={SUBLINEA}>{[hectareas, registro.origen].filter(Boolean).join(" · ")}</span>
      </th>
      <td className={`${CELDA} whitespace-nowrap`}>
        {registro.ingresoAt
          ? <Momento iso={registro.ingresoAt} />
          : <>{fecha(registro.fecha)}<span className={SUBLINEA}>sin horario</span></>}
      </td>
      <td className={`${CELDA} whitespace-nowrap`}>
        {registro.salidaAt
          ? <Momento iso={registro.salidaAt} />
          : registro.enCurso
            ? <strong className="text-[#2f855a]">En curso</strong>
            : <Vacio />}
        {registro.alturaRemanenteCm !== null && (
          <span className={SUBLINEA}>remanente {registro.alturaRemanenteCm.toLocaleString("es-AR")} cm</span>
        )}
      </td>
      <td className={CELDA}>
        {registro.diasOcupacion !== null ? registro.diasOcupacion.toLocaleString("es-AR") : <Vacio motivo="La jornada todavía está abierta o el uso se cargó sin horarios" />}
      </td>
      <td className={CELDA}>
        {registro.animales.total !== null
          ? <>{registro.animales.total.toLocaleString("es-AR")}{detalle && <span className={SUBLINEA}>{detalle}</span>}</>
          : <Vacio motivo="No se cargaron animales en este uso" />}
      </td>
      <td className={CELDA}>
        {registro.cabezasPorHa !== null ? registro.cabezasPorHa.toLocaleString("es-AR") : <Vacio motivo="Hacen falta los animales y la superficie del potrero" />}
      </td>
      <td className={CELDA}>
        {registro.fechaUsoAnterior === null || registro.diasDescanso === null
          ? <Vacio motivo="Primer uso registrado de este potrero" />
          : <>
              {registro.diasDescanso} {registro.diasDescanso === 1 ? "día" : "días"}
              <span className={SUBLINEA}>desde el {fecha(registro.fechaUsoAnterior)}</span>
            </>}
      </td>
    </tr>
  );
}

function NotaDeAlcance() {
  return (
    <p className={`${TEXTO_APAGADO} mt-3`}>
      Horarios, animales y altura del remanente son los que se cargaron en la jornada de pastoreo de cada
      lote. Los usos registrados sólo con fecha y las jornadas todavía abiertas quedan en una raya en lugar
      de completarse con un número. El descanso se cuenta desde la salida del uso anterior. La{" "}
      <strong>carga</strong> suma todas las categorías: no son equivalentes vaca. El Excel trae la planilla
      completa, con una columna por categoría y las recomendaciones de manejo vacías para completarlas a
      mano en el campo.
    </p>
  );
}

/** Vacío de la planilla, con el ícono de hoja del Figma. */
function PlanillaVacia({ sinPotreros }: { sinPotreros: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span aria-hidden="true" className="mb-1 grid h-12 w-12 place-items-center rounded-full bg-[var(--color-campo-50)]">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#2f855a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h6M10 16h6" />
        </svg>
      </span>
      <p className="m-0 font-semibold text-gray-900">
        {sinPotreros ? "Este establecimiento todavía no tiene potreros" : "No hay usos registrados con estos filtros"}
      </p>
      {!sinPotreros && <p className={`m-0 ${TEXTO_APAGADO}`}>Los usos se cargan desde la ficha de cada lote.</p>}
    </div>
  );
}

export default function PantallaRegistroUsos() {
  const { establecimientoId, establecimiento } = useEstablecimiento();
  const [parametros, setParametros] = useSearchParams();
  const [registro, setRegistro] = useState<RegistroDeUsos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los filtros viven en la URL para que una planilla filtrada se pueda
  // compartir por link, igual que la ficha de lote.
  const desde = parametros.get("desde") ?? "";
  const hasta = parametros.get("hasta") ?? "";
  const loteId = parametros.get("loteId") ?? "";
  const incluirInactivos = parametros.get("incluirInactivos") === "true";
  const offset = Number(parametros.get("offset") ?? 0) || 0;

  function cambiarFiltro(clave: string, valor: string) {
    const siguientes = new URLSearchParams(parametros);
    if (valor) siguientes.set(clave, valor); else siguientes.delete(clave);
    // Cualquier cambio de filtro vuelve a la primera página: el offset viejo
    // apuntaría a renglones de otra consulta.
    if (clave !== "offset") siguientes.delete("offset");
    setParametros(siguientes, { replace: true });
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setRegistro(await obtenerRegistroDeUsos(establecimientoId, {
        desde: desde || undefined,
        hasta: hasta || undefined,
        loteId: loteId || undefined,
        incluirInactivos: incluirInactivos || undefined,
        limit: POR_PAGINA,
        offset: offset || undefined,
      }));
    } catch (motivo) {
      setRegistro(null);
      setError(mensajeDeError(motivo));
    } finally {
      setCargando(false);
    }
  }, [establecimientoId, desde, hasta, loteId, incluirInactivos, offset]);

  useEffect(() => { void cargar(); }, [cargar]);

  // El Excel usa los mismos filtros que la tabla, pero sin paginar: el libro
  // lleva el período completo, no la página que está a la vista.
  async function descargarExcel() {
    if (descargando) return;
    setDescargando(true);
    setError(null);
    try {
      await descargarRegistroDeUsosExcel(establecimientoId, {
        desde: desde || undefined,
        hasta: hasta || undefined,
        loteId: loteId || undefined,
        incluirInactivos: incluirInactivos || undefined,
      });
    } catch (motivo) {
      setError(motivo instanceof ApiError ? motivo.message : "No se pudo generar el Excel. Intentá nuevamente.");
    } finally {
      setDescargando(false);
    }
  }

  const lotesPorId = useMemo(
    () => new Map((registro?.lotes ?? []).map((lote) => [lote.id, lote])),
    [registro],
  );

  // Sólo se puede afirmar qué potrero no tuvo uso cuando el rango entero entró
  // en una sola página; si hay más páginas, los renglones que faltan podrían
  // estar en la siguiente. Con un potrero elegido la frase sobra: ya lo dice la
  // tabla vacía.
  const sinRegistros = useMemo(() => {
    if (!registro || loteId || registro.paginacion.offset > 0 || registro.paginacion.hayMas) return [];
    const conUso = new Set(registro.registros.map((item) => item.loteId));
    return registro.lotes.filter((lote) => (lote.activo || incluirInactivos) && !conUso.has(lote.id));
  }, [registro, loteId, incluirInactivos]);

  useOcultarDock(cargando && !registro);

  if (cargando && !registro) return <EstadoDePantalla><p>Cargando registro de uso...</p></EstadoDePantalla>;

  const paginacion = registro?.paginacion;
  const hastaRenglon = paginacion ? paginacion.offset + (registro?.registros.length ?? 0) : 0;
  // El total es del período entero; las jornadas abiertas se cuentan sobre la
  // página a la vista, que es lo único que el backend mandó.
  const total = paginacion?.total ?? 0;
  const enCurso = (registro?.registros ?? []).filter((item) => item.enCurso).length;

  return (
    <PantallaDatos
      titulo="Registro de uso de potreros"
      subtitulo={establecimiento?.nombre ?? "Sin establecimiento"}
      accion={
        <button type="button" className={PASTILLA_VERDE} onClick={descargarExcel} disabled={descargando || cargando}>
          {descargando ? "Generando Excel..." : "Descargar Excel"}
        </button>
      }
    >
      <section className={`${TARJETA} p-4`} aria-label="Filtros">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col">
            <span className={ETIQUETA_FILTRO}>Potrero</span>
            <select
              className={CAMPO_FILTRO}
              value={loteId}
              onChange={(evento) => cambiarFiltro("loteId", evento.target.value)}
            >
              <option value="">Todos los potreros</option>
              {(registro?.lotes ?? []).map((lote) => (
                <option key={lote.id} value={lote.id}>
                  {nombreLote(lote)}{lote.activo ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className={ETIQUETA_FILTRO}>Desde</span>
            <input type="date" className={CAMPO_FILTRO} value={desde} max={hasta || undefined}
              onChange={(evento) => cambiarFiltro("desde", evento.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className={ETIQUETA_FILTRO}>Hasta</span>
            <input type="date" className={CAMPO_FILTRO} value={hasta} min={desde || undefined}
              onChange={(evento) => cambiarFiltro("hasta", evento.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <input type="checkbox" checked={incluirInactivos}
              onChange={(evento) => cambiarFiltro("incluirInactivos", evento.target.checked ? "true" : "")} />
            Incluir potreros inactivos
          </label>
          {(desde || hasta || loteId || incluirInactivos) && (
            <Button variant="secondary" size="sm" onClick={() => setParametros(new URLSearchParams(), { replace: true })}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <section className={`${TARJETA} p-[22px]`}>
        {!registro ? (
          <p className={TEXTO_APAGADO}>La planilla no se pudo cargar.</p>
        ) : registro.registros.length === 0 ? (
          <PlanillaVacia sinPotreros={registro.lotes.length === 0} />
        ) : (
          <>
            <p className={`${TEXTO_APAGADO} m-0 mb-3 text-[0.85rem]`}>
              {total} {total === 1 ? "uso registrado" : "usos registrados"}
              {enCurso > 0 && <> · {enCurso} en curso</>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Registro de uso de potreros del establecimiento</caption>
                <Encabezados />
                <tbody>
                  {registro.registros.map((item) => (
                    <Fila key={item.id} registro={item} lote={lotesPorId.get(item.loteId)} />
                  ))}
                </tbody>
              </table>
            </div>
            <NotaDeAlcance />
          </>
        )}

        {sinRegistros.length > 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 border-t border-gray-200/70 pt-4">
            <p className="m-0 text-[0.72rem] font-bold tracking-[0.06em] text-gray-400 uppercase">
              Sin usos registrados en este período
            </p>
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
              {sinRegistros.map((lote) => (
                <li key={lote.id} className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[0.82rem] text-gray-700">
                  {nombreLote(lote)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {paginacion && paginacion.total > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
            <span className={TEXTO_APAGADO}>
              Renglones {paginacion.offset + 1}–{hastaRenglon} de {paginacion.total}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={offset === 0 || cargando}
                onClick={() => cambiarFiltro("offset", String(Math.max(0, offset - POR_PAGINA)))}>
                Anterior
              </Button>
              <Button variant="secondary" size="sm" disabled={!paginacion.hayMas || cargando}
                onClick={() => cambiarFiltro("offset", String(offset + POR_PAGINA))}>
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </section>
    </PantallaDatos>
  );
}
