import type { FaltaDelLote, GrupoOrden, LoteOrdenado } from "../api/estimacion";
import { ETAPA_PASTO, GRUPO_ORDEN, fechaCorta, kgRedondo, porcentajeRebrote } from "../estimacion/presentacion";
import type { EstadoOrdenPastoreo } from "../hooks/useOrdenPastoreo";
import type { Lote } from "../types";
import CompletarDatosLote, { type AccionesCompletarLote } from "./CompletarDatosLote";
import AvisoInfo from "./ui/AvisoInfo";
import Button from "./ui/Button";
import Modal, { MODAL_CARD_CLASS } from "./ui/Modal";
import { useState, type ReactNode } from "react";

const AVISO_SIN_PASTOREO = "Sin un pastoreo registrado, el descanso se cuenta desde que el lote se creó en RODEO, así que el lote está como mínimo así de avanzado. Cargá cuándo salieron los animales por última vez para ver su etapa real.";

interface OrdenPastoreoPanelProps extends AccionesCompletarLote {
  orden: EstadoOrdenPastoreo;
  lotes: Lote[];
  onSelectLote: (id: string) => void;
  onVerOrden: () => void;
}

/** Los que se pueden pastorear hoy, en el orden del backend. */
const CANDIDATOS: GrupoOrden[] = ["listo", "pasado", "esperar-al-piso"];
const MAXIMO_VISIBLES = 3;

/** Qué le falta a un lote, dicho en una línea; el clima usa el motivo del backend, que dice qué día falta. */
export function textoFalta(lote: LoteOrdenado): string {
  const textos: Record<FaltaDelLote, string> = {
    pastura: "Sin tipo de pastura no se puede estimar.",
    "ultimo-pastoreo": "Falta el último pastoreo.",
    clima: lote.motivos[0] ?? "Falta el clima de hoy.",
  };
  return lote.falta ? textos[lote.falta] : "";
}

export function PuntoGrupo({ grupo }: { grupo: GrupoOrden }) {
  const { color, hueco } = GRUPO_ORDEN[grupo];
  return (
    <i
      aria-hidden="true"
      className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2"
      style={{ borderColor: color, background: hueco ? "white" : color }}
    />
  );
}

function nombreLote(lote: LoteOrdenado, lotes: Map<string, Lote>): string {
  const apodo = lotes.get(lote.loteId)?.apodo;
  return apodo ? `Lote ${lote.numero} — ${apodo}` : `Lote ${lote.numero}`;
}

/**
 * Los dos o tres números que resumen el lote, cada uno sólo si existe. Nada se
 * completa con un supuesto: lo que el backend manda en `null` no aparece.
 */
function datosResumen(lote: LoteOrdenado): Array<{ etiqueta: string; valor: string }> {
  const datos: Array<{ etiqueta: string; valor: string }> = [];
  if (lote.progresoRebrote !== null) datos.push({ etiqueta: "Rebrote", valor: porcentajeRebrote(lote.progresoRebrote) });
  if (lote.listoEl) datos.push({ etiqueta: "Listo el", valor: fechaCorta(lote.listoEl) });
  if (lote.pastoEnPieKgMsHa !== null) datos.push({ etiqueta: "Pasto en pie", valor: `${kgRedondo(lote.pastoEnPieKgMsHa)} kg` });
  if (lote.diasHastaPasado !== null) datos.push({ etiqueta: "Se pasa en", valor: `${lote.diasHastaPasado} d` });
  return datos;
}

/**
 * Barra del avance del rebrote. Sólo cuando hay número real que mostrar: quien
 * la usa decide si tiene progreso, acá nunca se asume un cero.
 *
 * `color` y `rotulo` los agrega la card de Condición, donde el Figma la dibuja
 * con el color de la condición y el encabezado "Regeneración 100%".
 */
export function BarraRebrote({ progreso, color, rotulo }: { progreso: number; color?: string; rotulo?: string }) {
  const porcentaje = Math.min(100, Math.max(0, Math.round(progreso * 100)));
  return (
    <div className="mt-1.5">
      {rotulo && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[0.72rem] text-gray-500">{rotulo}</span>
          <span className="text-[0.78rem] font-bold text-gray-900 tabular-nums">{porcentaje}%</span>
        </div>
      )}
      <div className={`${rotulo ? "h-1.5" : "h-1"} w-full overflow-hidden rounded-full bg-[var(--color-campo-100)]`} role="presentation">
        <div className="h-full rounded-full" style={{ width: `${porcentaje}%`, background: color ?? "var(--color-campo-600)" }} />
      </div>
    </div>
  );
}

/**
 * La tarjeta de un lote dentro del orden: nombre, en qué etapa está, el motivo
 * y los pocos números que lo resumen. `destacado` la usa el lote que se está
 * recomendando; el resto va en blanco.
 */
function CardLote({ lote, nombre, etiqueta, insignia, destacado = false, mostrarFalta = false, avisoPiso = true, onSelect, acciones }: {
  lote: LoteOrdenado;
  nombre: string;
  /** Volanta de la tarjeta, por ejemplo "El próximo". */
  etiqueta?: string;
  /** Lo que va arriba a la izquierda: la posición en el orden, si la tiene. */
  insignia?: ReactNode;
  destacado?: boolean;
  /** En "Les faltan datos" importa qué falta, no el motivo del orden. */
  mostrarFalta?: boolean;
  /** false cuando el aviso ya está una vez arriba del grupo. */
  avisoPiso?: boolean;
  onSelect: () => void;
  acciones: AccionesCompletarLote;
}) {
  const grupo = GRUPO_ORDEN[lote.grupo];
  const datos = datosResumen(lote);
  return (
    <li
      className="flex gap-2.5 rounded-xl border-2 p-2.5 text-[0.8rem]"
      style={{ borderColor: grupo.color, background: destacado ? `${grupo.color}14` : "white" }}
    >
      {insignia}
      <div className="min-w-0 flex-1">
        {etiqueta && <span className="block text-[0.62rem] font-bold tracking-[0.08em] text-[var(--color-campo-700)] uppercase">{etiqueta}</span>}
        <div className="flex items-center gap-1.5">
          <button type="button" className={NOMBRE_BOTON} onClick={onSelect}>{nombre}</button>
          {/* Sin pastoreos la etapa es un piso, no la real: hay que decirlo. */}
          {avisoPiso && lote.falta === "ultimo-pastoreo" && <AvisoInfo titulo="Sin pastoreos registrados">{AVISO_SIN_PASTOREO}</AvisoInfo>}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[0.66rem] font-semibold" style={{ background: `${grupo.color}1f`, color: grupo.color }}>
            <PuntoGrupo grupo={lote.grupo} />
            {lote.etapa ? ETAPA_PASTO[lote.etapa].texto : grupo.texto}
          </span>
          {lote.pisoPesado && <span className="rounded-full bg-sky-100 px-1.5 py-px text-[0.66rem] font-semibold text-sky-800">Piso pesado</span>}
        </div>

        {mostrarFalta && lote.falta && <p className="m-0 mt-1 leading-snug text-gray-600">{textoFalta(lote)}</p>}
        {lote.progresoRebrote !== null && <BarraRebrote progreso={lote.progresoRebrote} />}

        {datos.length > 0 && (
          <dl className="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {datos.map(({ etiqueta: clave, valor }) => (
              <div key={clave} className="flex items-baseline gap-1">
                <dt className="m-0 text-[0.64rem] text-gray-400 uppercase">{clave}</dt>
                <dd className="m-0 text-[0.72rem] font-bold text-gray-800 tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
        )}

        {lote.falta && <CompletarDatosLote loteId={lote.loteId} falta={lote.falta} {...acciones} />}
      </div>
    </li>
  );
}

/**
 * El detalle de los lotes a los que les falta un dato, cada uno con el
 * formulario para cargarlo. Vive en la ventana de la alerta; se exporta para
 * poder probar que sigue diciendo qué falta y ofreciendo cargarlo.
 */
export function ListaFaltantes({ lotes, porId, acciones }: { lotes: LoteOrdenado[]; porId: Map<string, Lote>; acciones: AccionesCompletarLote }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {lotes.map((lote) => (
        <li key={lote.loteId} className="rounded-xl border-2 border-[var(--color-lima)] p-2.5">
          <p className="m-0 text-[0.95rem] font-bold text-gray-900">{nombreLote(lote, porId)}</p>
          <p className="m-0 mt-0.5 text-[0.8rem] leading-snug text-gray-600">{textoFalta(lote)}</p>
          {lote.falta && <CompletarDatosLote loteId={lote.loteId} falta={lote.falta} {...acciones} />}
        </li>
      ))}
    </ul>
  );
}

const NOMBRE_BOTON = "cursor-pointer border-0 bg-transparent p-0 text-left text-[0.95rem] font-bold leading-tight text-gray-900 underline underline-offset-2";
const ENLACE_VERDE = "cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[0.72rem] font-semibold text-[var(--color-campo-700)] hover:underline";

/**
 * La respuesta a "¿a cuál mando la hacienda hoy?", arriba de la lista de
 * lotes. Debajo, los lotes a los que les falta un dato que el usuario puede
 * cargar ahí mismo. El detalle de cada uno y el orden completo quedan en
 * Condición.
 */
export default function OrdenPastoreoPanel({ orden, lotes, onSelectLote, onVerOrden, onLoteActualizado, onPastoreoRegistrado, onActualizarClima, actualizandoClima }: OrdenPastoreoPanelProps) {
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [faltantesAbiertos, setFaltantesAbiertos] = useState(false);
  const acciones: AccionesCompletarLote = { onLoteActualizado, onPastoreoRegistrado, onActualizarClima, actualizandoClima };
  if (orden.estado === "cargando") return <p className="m-0 text-[0.78rem] text-gray-500">Armando el orden de los lotes…</p>;
  if (orden.estado === "error") return <p className="m-0 text-[0.78rem] text-gray-500">No se pudo armar el orden de los lotes: {orden.mensaje}</p>;
  const { lotes: ordenados, leyenda } = orden.orden;
  if (ordenados.length === 0) return null;

  const porId = new Map(lotes.map((lote) => [lote.id, lote]));
  const candidatos = ordenados.filter((lote) => CANDIDATOS.includes(lote.grupo));
  const visibles = candidatos.slice(0, MAXIMO_VISIBLES);
  const proximo = candidatos.length === 0 ? ordenados.find((lote) => lote.grupo === "rebrotando") : undefined;
  const mostrados = [...visibles, ...(proximo ? [proximo] : [])];
  const conFaltantes = ordenados.filter((lote) => lote.falta && !mostrados.includes(lote));
  const resto = ordenados.filter((lote) => !mostrados.includes(lote) && !conFaltantes.includes(lote));
  // Campo nuevo: todavía no se cargó nada en ningún lote.
  const todosSinDatos = ordenados.every((lote) => lote.falta === "pastura" || lote.falta === "ultimo-pastoreo");
  // Si a todos les falta lo mismo, el motivo se dice una vez arriba en vez de
  // repetir el mismo renglón debajo de cada lote.
  const faltanLoMismoTodos: FaltaDelLote | null =
    conFaltantes.length > 0 && conFaltantes.every((lote) => lote.falta === conFaltantes[0].falta) ? conFaltantes[0].falta : null;
  const cuentas = (Object.keys(GRUPO_ORDEN) as GrupoOrden[])
    .map((grupo) => [grupo, resto.filter((lote) => lote.grupo === grupo).length] as const)
    .filter(([, cantidad]) => cantidad > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-campo-100)] bg-white" aria-labelledby="orden-pastoreo-titulo">
      {/* Encabezado verde: ancla la respuesta del día y separa esta tarjeta del
          resto de la sidebar. */}
      <div className="flex items-center justify-between gap-2 bg-[var(--color-campo-50)] px-3 py-2">
        <h3 id="orden-pastoreo-titulo" className="m-0 text-[0.7rem] font-bold tracking-[0.08em] text-[var(--color-campo-900)] uppercase">Hoy, para pastorear</h3>
        <button type="button" onClick={onVerOrden} className={ENLACE_VERDE}>Ver el orden →</button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {visibles.length > 0 ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {visibles.map((lote) => (
              <CardLote
                key={lote.loteId}
                lote={lote}
                nombre={nombreLote(lote, porId)}
                destacado={lote === visibles[0]}
                insignia={
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-campo-600)] text-[0.7rem] font-bold text-white tabular-nums">
                    {lote.posicion}
                  </span>
                }
                onSelect={() => onSelectLote(lote.loteId)}
                acciones={acciones}
              />
            ))}
          </ol>
        ) : (
          // Nada listo: una sola frase clara y, pegado, cuál viene primero.
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[0.85rem] font-bold text-gray-900">
              Ningún lote está listo hoy.
              {todosSinDatos && <>{" "}<button type="button" onClick={() => setAyudaAbierta(true)} className={ENLACE_VERDE}>¿Por qué?</button></>}
            </p>
            {proximo && (
              <ul className="m-0 flex list-none flex-col p-0">
                <CardLote
                  lote={proximo}
                  nombre={nombreLote(proximo, porId)}
                  etiqueta="El próximo"
                  destacado
                  onSelect={() => onSelectLote(proximo.loteId)}
                  acciones={acciones}
                />
              </ul>
            )}
          </div>
        )}

        {/* Una sola alerta en vez de una tarjeta por lote: lo que importa en la
            pantalla principal es que falta algo y cuántos. El detalle y los
            formularios para cargarlo viven en la ventana. */}
        {conFaltantes.length > 0 && (
          <button
            type="button"
            onClick={() => setFaltantesAbiertos(true)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-2 border-amber-300 bg-amber-50 p-2.5 text-left transition-colors hover:bg-amber-100"
          >
            <span aria-hidden="true" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-amber-400 text-[0.95rem] font-bold text-amber-950">!</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.85rem] font-bold text-amber-950">
                {conFaltantes.length === 1 ? "1 lote sin datos" : `${conFaltantes.length} lotes sin datos`}
              </span>
              <span className="block text-[0.74rem] leading-snug text-amber-900">
                {faltanLoMismoTodos ? textoFalta(conFaltantes[0]) : "Les falta un dato para entrar al orden."}
              </span>
            </span>
            <span aria-hidden="true" className="flex-none text-amber-700">›</span>
          </button>
        )}

        {cuentas.length > 0 && (
          <p className="m-0 flex flex-wrap gap-1.5 text-[0.7rem] text-gray-500">
            {cuentas.map(([grupo, cantidad]) => (
              <span key={grupo} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5">
                <PuntoGrupo grupo={grupo} />
                {GRUPO_ORDEN[grupo].texto.toLowerCase()} <b className="tabular-nums">{cantidad}</b>
              </span>
            ))}
          </p>
        )}

        {/* La leyenda va adentro del cuerpo blanco, como en el Figma: antes era
            una barra verde al pie que cortaba la tarjeta en dos. */}
        <p className="m-0 text-[0.68rem] text-gray-500">{leyenda}</p>
      </div>

      {faltantesAbiertos && <Modal onDismiss={() => setFaltantesAbiertos(false)}>
        <div className="flex max-h-[80vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2.5 overflow-y-auto rounded-lg bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]" onMouseDown={(evento) => evento.stopPropagation()}>
          {/* Cierra con la cruz o con el clic afuera: el "Listo" del pie era un
              botón de más para una ventana que no guarda nada por sí misma. */}
          <div className="flex items-center gap-1.5">
            <h2 className="m-0 text-lg">Lotes sin datos</h2>
            {faltanLoMismoTodos === "ultimo-pastoreo" && <AvisoInfo titulo="Sin pastoreos registrados">{AVISO_SIN_PASTOREO}</AvisoInfo>}
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setFaltantesAbiertos(false)}
              className="foco-campo ml-auto grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-lg leading-none text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              ×
            </button>
          </div>
          <p className="m-0 text-sm leading-normal text-gray-700">
            Estos lotes no entran al orden hasta que les cargues lo que falta. Podés hacerlo acá mismo.
          </p>
          <ListaFaltantes lotes={conFaltantes} porId={porId} acciones={acciones} />
        </div>
      </Modal>}

      {ayudaAbierta && <Modal onDismiss={() => setAyudaAbierta(false)}>
        <div className={MODAL_CARD_CLASS} onMouseDown={(evento) => evento.stopPropagation()}>
          <h2 className="m-0 text-lg">Faltan datos de tus lotes</h2>
          <p className="m-0 text-sm leading-normal text-gray-700">
            Para saber a qué lote mandar los animales, RODEO necesita dos cosas de cada lote:
            <b> qué pastura tiene</b> y <b>cuándo salieron los animales por última vez</b>.
          </p>
          <p className="m-0 text-sm leading-normal text-gray-700">
            Las cargás desde “Les faltan datos”, acá abajo. El clima y las imágenes se actualizan solos.
          </p>
          <div className="mt-1.5 flex justify-end">
            <Button type="button" variant="primary" onClick={() => setAyudaAbierta(false)}>Entendido</Button>
          </div>
        </div>
      </Modal>}
    </section>
  );
}
