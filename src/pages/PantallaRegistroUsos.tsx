// Planilla de uso de potreros, armada sobre los registros de uso que el
// establecimiento ya lleva en `usos_lote`.
//
// Es la parte de la planilla de campo "Registro de manejo de potreros en la
// finca" que el proyecto puede sostener con datos reales hoy. Los días de
// ocupación, los animales que ingresan y las recomendaciones de manejo
// necesitan jornadas de pastoreo y ganado, que siguen pausados en CLAUDE.md:
// se muestran como "sin datos" y nunca se completan con un valor inventado.

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

// Encabezados: azul para el grupo superior, verde para el inferior. Sobrios,
// como la planilla en papel.
const GRUPO = "border border-[#2c4f7c] bg-brand px-3 py-2 text-center text-[0.74rem] font-extrabold uppercase tracking-[0.06em] text-white";
const SUBGRUPO = "border border-[#2f855a] bg-[#e6f2ea] px-3 py-2 text-left text-[0.74rem] font-extrabold uppercase tracking-[0.05em] text-[#24543c]";
const CELDA = "border border-gray-200 px-3 py-2 align-top";
const SIN_DATOS = "text-[0.82rem] italic text-gray-400";

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

function SinDatos({ children }: { children: string }) {
  return <span className={SIN_DATOS}>{children}</span>;
}

function Encabezados() {
  return (
    <thead>
      <tr>
        <th className={GRUPO} colSpan={2} scope="colgroup">Potrero</th>
        <th className={GRUPO} colSpan={2} scope="colgroup">Uso registrado</th>
        <th className={GRUPO} colSpan={2} scope="colgroup">Días</th>
      </tr>
      <tr>
        <th className={SUBGRUPO} scope="col">Potrero</th>
        <th className={SUBGRUPO} scope="col">Superficie (ha)</th>
        <th className={SUBGRUPO} scope="col">Fecha</th>
        <th className={SUBGRUPO} scope="col">Origen</th>
        <th className={SUBGRUPO} scope="col">Descanso previo</th>
        <th className={SUBGRUPO} scope="col">Ocupación</th>
      </tr>
    </thead>
  );
}

function Fila({ registro, lote }: { registro: RegistroDeUso; lote: LoteDelRegistro | undefined }) {
  const hectareas = superficie(lote);
  return (
    <tr className="even:bg-[#f7faf8]">
      <th scope="row" className={`${CELDA} text-left font-bold text-brand`}>{nombreLote(lote)}</th>
      <td className={CELDA}>{hectareas ?? <SinDatos>Sin datos</SinDatos>}</td>
      <td className={`${CELDA} whitespace-nowrap`}>{fecha(registro.fecha)}</td>
      <td className={CELDA}>{registro.origen}</td>
      <td className={CELDA}>
        {registro.fechaUsoAnterior === null || registro.diasDescanso === null
          ? <SinDatos>Primer uso registrado</SinDatos>
          : <>
              <strong className="text-brand">{registro.diasDescanso} {registro.diasDescanso === 1 ? "día" : "días"}</strong>
              <span className="block text-[0.78rem] text-gray-500">desde el {fecha(registro.fechaUsoAnterior)}</span>
            </>}
      </td>
      {/* Necesita fecha de salida, que todavía no se registra. */}
      <td className={CELDA}><SinDatos>Sin datos</SinDatos></td>
    </tr>
  );
}

function NotaDeAlcance() {
  return (
    <p className={`${TEXTO_APAGADO} mt-3`}>
      Los <strong>días de ocupación</strong> salen de la fecha de salida del potrero, y las columnas de
      animales y de recomendaciones de manejo de la planilla en papel dependen de las jornadas de
      pastoreo y del ganado. Nada de eso se registra todavía, así que la planilla lo muestra como
      "sin datos" en lugar de completarlo con un número. En el Excel esas columnas están, pero vacías,
      para completarlas a mano en el campo.
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

  return (
    <PantallaDatos
      volanta="Registro de manejo de potreros"
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
