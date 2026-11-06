import type { CondicionPastoreo } from "../api/estimacion";
import { CONDICION_PASTOREO } from "../estimacion/presentacion";

/**
 * "Regeneración / Bloques" del Figma: diez fichas de 44 px, una por cada 10 %
 * de avance del estado foliar.
 *
 * - Las llenas toman el color de la condición de hoy: verde (perfecto), amarillo
 *   (cuidado o regular, pasado de su punto) o rojo (no apto). Las verdes llevan
 *   el recorte crema del centro, como la ficha de la marca.
 * - La que se está llenando va en amarillo, como el bloque 8 del frame.
 * - Las que faltan, apagadas.
 *
 * Sin progreso no se dibuja nada (lo decide quien la usa): diez fichas apagadas
 * dirían "0 %, recién pastoreado", que no es lo mismo que no saber.
 */
type Tono = "verde" | "amarillo" | "rojo" | "vacio";

const TONO_CONDICION: Record<CondicionPastoreo, Exclude<Tono, "vacio">> = {
  perfecto: "verde",
  cuidado: "amarillo",
  regular: "amarillo",
  "no-apto": "rojo",
};

const CLASE_TONO: Record<Tono, string> = {
  verde: "border-[#97ea7c] bg-[rgba(121,218,88,0.6)]",
  amarillo: "border-[#ffde67] bg-[rgba(255,222,103,0.55)]",
  rojo: "border-[#ff7b6b] bg-[rgba(255,98,82,0.5)]",
  vacio: "border-white/22 bg-white/6",
};

const CANTIDAD = 10;

function Bloque({ tono }: { tono: Tono }) {
  return (
    <span className={`relative grid size-11 shrink-0 place-items-center rounded-md border-[3px] ${CLASE_TONO[tono]}`}>
      {tono === "verde" && <span className="size-4 rounded-[3px] border-[3px] border-[#97ea7c] bg-[rgba(255,222,103,0.6)]" />}
    </span>
  );
}

export default function BloquesRegeneracion({ progreso, condicion }: { progreso: number; condicion: CondicionPastoreo | null }) {
  const porcentaje = Math.max(0, Math.round(progreso * 100));
  const llenos = Math.min(CANTIDAD, Math.floor(porcentaje / 10));
  const enCurso = porcentaje < 100 && porcentaje % 10 !== 0 ? 1 : 0;
  // Sin condición (por ejemplo, con animales hoy) el avance se muestra en verde, sin juicio.
  const tonoLleno = condicion ? TONO_CONDICION[condicion] : "verde";
  const tonos: Tono[] = Array.from({ length: CANTIDAD }, (_, indice) =>
    indice < llenos ? tonoLleno : indice < llenos + enCurso ? "amarillo" : "vacio");

  return (
    <div
      role="img"
      aria-label={`Regeneración: ${porcentaje} %${condicion ? `, ${CONDICION_PASTOREO[condicion].texto.toLowerCase()}` : ""}`}
      className="flex flex-wrap gap-2"
    >
      {tonos.map((tono, indice) => <Bloque key={indice} tono={tono} />)}
    </div>
  );
}
