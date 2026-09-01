import type { ButtonHTMLAttributes } from "react";
import type { MetaSugerencias, SugerenciaLote } from "../ia/types";
import BotonAccion from "./ui/BotonAccion";
import Button from "./ui/Button";

/**
 * El cartel donde el usuario decide qué hacer con la propuesta de la IA.
 *
 * Todo lo que se ve acá es un borrador en memoria: se puede tildar, destildar,
 * editar en el mapa y descartar entero. Recién al confirmar se crean los lotes
 * con `POST /api/lotes`, uno por uno y con las validaciones de siempre.
 */

/**
 * Link de acción de la lista. Sobre el vidrio del onboarding no sirve el
 * `variant="link"` de Button: su azul `--color-brand` no se lee sobre el fondo
 * oscuro, así que ahí va texto blanco.
 */
function EnlaceAccion({
  esVidrio,
  peligro = false,
  ...rest
}: { esVidrio: boolean; peligro?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (!esVidrio) return <Button variant={peligro ? "link-danger" : "link"} {...rest} />;
  return (
    <button
      type="button"
      className={`texto-foto foco-campo cursor-pointer border-0 bg-transparent p-0 text-[0.78rem] underline disabled:cursor-not-allowed disabled:opacity-50 ${peligro ? "text-red-200" : "text-white"}`}
      {...rest}
    />
  );
}

interface SugerenciasPanelProps {
  variante: "vidrio" | "claro";
  sugerencias: SugerenciaLote[];
  excluidas: string[];
  meta: MetaSugerencias | null;
  editandoId: string | null;
  confirmando: boolean;
  onToggle: (id: string) => void;
  onEditar: (id: string) => void;
  onGuardarEdicion: () => void;
  onCancelarEdicion: () => void;
  onConfirmar: () => void;
  onDescartar: () => void;
}

export default function SugerenciasPanel({
  variante,
  sugerencias,
  excluidas,
  meta,
  editandoId,
  confirmando,
  onToggle,
  onEditar,
  onGuardarEdicion,
  onCancelarEdicion,
  onConfirmar,
  onDescartar,
}: SugerenciasPanelProps) {
  const esVidrio = variante === "vidrio";
  const excluidasSet = new Set(excluidas);
  const seleccionadas = sugerencias.filter((sugerencia) => !excluidasSet.has(sugerencia.id));
  const hectareas = seleccionadas.reduce((total, sugerencia) => total + sugerencia.hectareas, 0);

  const claseTexto = esVidrio ? "texto-foto text-white" : "text-gray-800";
  const claseTextoTenue = esVidrio ? "texto-foto text-white/75" : "text-gray-500";
  const claseItem = esVidrio
    ? "rounded-xl border border-white/25 bg-black/25 p-2"
    : "rounded-md border border-gray-200 bg-white p-2";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <p className={`m-0 text-[0.95rem] font-semibold ${claseTexto}`}>
          Subdivisión propuesta ({sugerencias.length})
        </p>
        <p className={`m-0 text-[0.72rem] leading-snug ${claseTextoTenue}`}>
          Propuesta de un modelo de IA sobre la imagen satelital. Puede equivocarse:
          revisá cada lote antes de confirmar. Nada se guarda hasta que confirmes.
        </p>
        {meta && (
          <p className={`m-0 text-[0.68rem] ${claseTextoTenue}`}>
            {meta.detectadas} detectados · {meta.descartadas} descartados al recortar ·{" "}
            {meta.segundos.toFixed(1)} s · {meta.metrosPorPixel.toFixed(1)} m/píxel
          </p>
        )}
      </div>

      <ul className="m-0 flex max-h-[38vh] list-none flex-col gap-1.5 overflow-y-auto p-0">
        {sugerencias.map((sugerencia, indice) => {
          const excluida = excluidasSet.has(sugerencia.id);
          const editando = editandoId === sugerencia.id;
          return (
            <li key={sugerencia.id} className={`${claseItem} ${excluida ? "opacity-55" : ""}`}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!excluida}
                  disabled={Boolean(editandoId) || confirmando}
                  onChange={() => onToggle(sugerencia.id)}
                  aria-label={`Incluir la sugerencia ${indice + 1}`}
                />
                <span className={`flex-1 text-[0.82rem] ${claseTexto}`}>
                  Propuesta {indice + 1} · {sugerencia.hectareas.toFixed(2)} ha
                </span>
                {editando ? (
                  <span className="flex gap-2">
                    <EnlaceAccion esVidrio={esVidrio} onClick={onGuardarEdicion}>
                      Listo
                    </EnlaceAccion>
                    <EnlaceAccion esVidrio={esVidrio} peligro onClick={onCancelarEdicion}>
                      Cancelar
                    </EnlaceAccion>
                  </span>
                ) : (
                  <EnlaceAccion
                    esVidrio={esVidrio}
                    disabled={Boolean(editandoId) || confirmando || excluida}
                    onClick={() => onEditar(sugerencia.id)}
                  >
                    Ajustar
                  </EnlaceAccion>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className={`m-0 text-[0.75rem] ${claseTextoTenue}`}>
        {seleccionadas.length === 0
          ? "No seleccionaste ninguna propuesta."
          : `Se van a crear ${seleccionadas.length} lote${seleccionadas.length > 1 ? "s" : ""} (${hectareas.toFixed(2)} ha).`}
      </p>

      {esVidrio ? (
        <div className="flex flex-col gap-2">
          <BotonAccion
            onClick={onConfirmar}
            disabled={confirmando || seleccionadas.length === 0 || Boolean(editandoId)}
          >
            {confirmando ? "Creando lotes..." : `Confirmar ${seleccionadas.length} lote${seleccionadas.length === 1 ? "" : "s"}`}
          </BotonAccion>
          <button
            type="button"
            className="texto-foto foco-campo cursor-pointer rounded border-0 bg-transparent text-[0.8rem] text-white underline disabled:opacity-50"
            onClick={onDescartar}
            disabled={confirmando}
          >
            Descartar propuesta
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={onConfirmar}
            disabled={confirmando || seleccionadas.length === 0 || Boolean(editandoId)}
          >
            {confirmando ? "Creando lotes..." : `Confirmar ${seleccionadas.length} lote${seleccionadas.length === 1 ? "" : "s"}`}
          </Button>
          <Button variant="secondary" onClick={onDescartar} disabled={confirmando}>
            Descartar propuesta
          </Button>
        </div>
      )}
    </div>
  );
}
