import type { FaltaDelLote, GrupoOrden, LoteOrdenado } from "../api/estimacion";
import { GRUPO_ORDEN } from "../estimacion/presentacion";
import type { EstadoOrdenPastoreo } from "../hooks/useOrdenPastoreo";
import type { Lote } from "../types";
import CompletarDatosLote, { type AccionesCompletarLote } from "./CompletarDatosLote";
import AvisoInfo from "./ui/AvisoInfo";

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
const MAXIMO_FALTANTES = 3;

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

const NOMBRE_BOTON = "cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-gray-900 underline underline-offset-2";

/**
 * La respuesta a "¿a cuál mando la hacienda hoy?", arriba de la lista de
 * lotes. Debajo, los lotes a los que les falta un dato que el usuario puede
 * cargar ahí mismo. El detalle de cada uno y el orden completo quedan en
 * Condición.
 */
export default function OrdenPastoreoPanel({ orden, lotes, onSelectLote, onVerOrden, onLoteActualizado, onPastoreoRegistrado, onActualizarClima, actualizandoClima }: OrdenPastoreoPanelProps) {
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
  const faltantes = conFaltantes.slice(0, MAXIMO_FALTANTES);
  const resto = ordenados.filter((lote) => !mostrados.includes(lote) && !faltantes.includes(lote));
  const cuentas = (Object.keys(GRUPO_ORDEN) as GrupoOrden[])
    .map((grupo) => [grupo, resto.filter((lote) => lote.grupo === grupo).length] as const)
    .filter(([, cantidad]) => cantidad > 0);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3" aria-labelledby="orden-pastoreo-titulo">
      <div className="flex items-center justify-between gap-2">
        <h3 id="orden-pastoreo-titulo" className="m-0 text-[0.68rem] font-bold tracking-[0.08em] text-gray-400 uppercase">Hoy, para pastorear</h3>
        <button type="button" onClick={onVerOrden} className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[0.72rem] font-semibold text-[var(--color-campo-700)] hover:underline">
          Ver el orden →
        </button>
      </div>

      {visibles.length === 0 && <p className="m-0 mt-1.5 text-[0.82rem] font-semibold text-gray-800">Ningún lote está listo hoy.</p>}
      <ol className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
        {mostrados.map((lote) => (
          <li key={lote.loteId} className="flex items-start gap-2 text-[0.8rem]">
            <PuntoGrupo grupo={lote.grupo} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <button type="button" className={NOMBRE_BOTON} onClick={() => onSelectLote(lote.loteId)}>
                  {lote === proximo ? `El próximo: ${nombreLote(lote, porId)}` : `${lote.posicion}. ${nombreLote(lote, porId)}`}
                </button>
                {lote.falta === "ultimo-pastoreo" && <AvisoInfo titulo="Sin pastoreos registrados">{AVISO_SIN_PASTOREO}</AvisoInfo>}
              </span>
              <span className="block leading-snug text-gray-700">{lote.motivos[0]}</span>
              {lote.falta && <CompletarDatosLote loteId={lote.loteId} falta={lote.falta} {...acciones} />}
            </span>
          </li>
        ))}
      </ol>

      {faltantes.length > 0 && (
        <div className="mt-2.5 border-t border-gray-100 pt-2.5">
          <h4 className="m-0 text-[0.66rem] font-bold tracking-[0.08em] text-gray-400 uppercase">Les faltan datos</h4>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-2 p-0">
            {faltantes.map((lote) => (
              <li key={lote.loteId} className="flex items-start gap-2 text-[0.8rem]">
                <PuntoGrupo grupo={lote.grupo} />
                <span className="min-w-0 flex-1">
                  <button type="button" className={NOMBRE_BOTON} onClick={() => onSelectLote(lote.loteId)}>{nombreLote(lote, porId)}</button>
                  <span className="flex items-center gap-1.5 leading-snug text-gray-600">
                    {textoFalta(lote)}
                    {lote.falta === "ultimo-pastoreo" && <AvisoInfo titulo="Sin pastoreos registrados">{AVISO_SIN_PASTOREO}</AvisoInfo>}
                  </span>
                  {lote.falta && <CompletarDatosLote loteId={lote.loteId} falta={lote.falta} {...acciones} />}
                </span>
              </li>
            ))}
          </ul>
          {conFaltantes.length > faltantes.length && (
            <button type="button" onClick={onVerOrden} className="mt-1.5 cursor-pointer border-0 bg-transparent p-0 text-[0.72rem] font-semibold text-[var(--color-campo-700)] hover:underline">
              Y {conFaltantes.length - faltantes.length} más: verlos en Condición →
            </button>
          )}
        </div>
      )}

      {cuentas.length > 0 && (
        <p className="m-0 mt-2 text-[0.72rem] leading-snug text-gray-500">
          Además: {cuentas.map(([grupo, cantidad]) => `${GRUPO_ORDEN[grupo].texto.toLowerCase()}, ${cantidad}`).join(" · ")}
        </p>
      )}
      <p className="m-0 mt-2 text-[0.7rem] font-semibold text-gray-500">{leyenda}</p>
    </section>
  );
}
