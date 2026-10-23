import type { CondicionPastoreo, EstimacionForraje } from "../api/estimacion";
import { NOMBRES_PASTURA, type Lote } from "../types";

/** Rótulos y colores de la condición estimada para pastorear, compartidos por la sidebar y la ficha. */
export const CONDICION_PASTOREO: Record<CondicionPastoreo, { texto: string; corto: string; clase: string; punto: string; color: string }> = {
  perfecto: { texto: "Perfecto para pastoreo", corto: "Perfecto", clase: "bg-green-50 text-green-800 border-green-200", punto: "bg-green-600", color: "#16a34a" },
  regular: { texto: "Regular", corto: "Regular", clase: "bg-yellow-50 text-yellow-800 border-yellow-200", punto: "bg-yellow-500", color: "#ca8a04" },
  cuidado: { texto: "Cuidado", corto: "Cuidado", clase: "bg-orange-50 text-orange-800 border-orange-200", punto: "bg-orange-500", color: "#ea580c" },
  "no-apto": { texto: "No apto", corto: "No apto", clase: "bg-red-50 text-red-800 border-red-200", punto: "bg-red-600", color: "#dc2626" },
};

/** Para quien quiera saber de dónde sale la etiqueta: va en "Cómo se calcula", no en la card. */
export const EXPLICACION_CONDICION: Record<CondicionPastoreo, string> = {
  "no-apto": "Al macollo le falta más de una hoja para el estado foliar óptimo.",
  cuidado: "Le falta menos de una hoja para el estado foliar óptimo.",
  perfecto: "Está dentro de la ventana estimada de reingreso.",
  regular: "Pasó la fecha tardía: las hojas más viejas empiezan a morir.",
};

/** Sin pastoreos se cuenta desde el alta: salvo "Regular", la condición es un piso. */
export function esPiso(esMinimo: boolean, condicion: CondicionPastoreo): boolean {
  return esMinimo && condicion !== "regular";
}

export const NOMBRE_ORIGEN_CLIMA: Record<"observado" | "historico" | "pronostico", string> = {
  observado: "Observado",
  historico: "Observado (histórico)",
  pronostico: "Pronóstico",
};

/** De mejor a peor, para ordenar rankings. */
export const ORDEN_CONDICION: CondicionPastoreo[] = ["perfecto", "regular", "cuidado", "no-apto"];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "28 oct": se lee más rápido que 28/10/2026. */
export function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]}`;
}

function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function cuandoRelativo(hoy: string, fecha: string): string {
  const dias = diasEntre(hoy, fecha);
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  return `en ${dias} días (${fechaCorta(fecha)})`;
}

export function kgRedondo(valor: number): string {
  // Redondeado a la decena: más precisión que esa sería falsa con parámetros sin calibrar.
  return (Math.round(valor / 10) * 10).toLocaleString("es-AR");
}

/** Lo que creció desde el último pastoreo o desde que hay datos, en una frase. */
export function fraseCrecimiento(estimacion: EstimacionForraje, hoy: string): string | null {
  const ultimo = estimacion.dias.filter((dia) => dia.fecha <= hoy && dia.acumuladoKgMsHa !== null).at(-1);
  if (!ultimo || ultimo.acumuladoKgMsHa === null || !ultimo.fechaAncla || ultimo.diasDesdeAncla === null) return null;
  const cuanto = `Creció unos ${kgRedondo(ultimo.acumuladoKgMsHa)} kg MS/ha`;
  if (ultimo.tipoAncla === "pastoreo") return `${cuanto} desde el pastoreo del ${fechaCorta(ultimo.fechaAncla)}.`;
  // Sin pastoreo en el medio, el ancla es sólo el primer día con datos: se dice como período.
  const dias = ultimo.diasDesdeAncla + 1;
  return `${cuanto} en los últimos ${dias} ${dias === 1 ? "día" : "días"}.`;
}

export interface ResumenCondicion {
  /** null: no hay etiqueta para hoy. */
  condicion: CondicionPastoreo | null;
  /** "Como mínimo" cuando se cuenta desde el alta y la etiqueta es un piso. */
  prefijo: string | null;
  titulo: string;
  /** Una sola frase: cuándo cambia, o qué falta para tener etiqueta. */
  frase: string;
  /** Aclaración en gris, si hace falta. */
  nota: string | null;
}

/**
 * Lo que una persona necesita leer de un lote: si se puede pastorear y hasta
 * cuándo, o qué falta. Los números quedan para "Cómo se calcula".
 */
export function resumirCondicion(lote: Lote, estimacion: EstimacionForraje | null, hoy: string): ResumenCondicion {
  const sinEtiqueta = (titulo: string, frase: string, nota: string | null = null): ResumenCondicion => ({ condicion: null, prefijo: null, titulo, frase, nota });
  if (!lote.tipoPastura) return sinEtiqueta("Falta la pastura", "Cargá el tipo de pastura en la ficha del lote para ver su condición.");
  if (!estimacion) return sinEtiqueta("Calculando…", "");
  const reingreso = estimacion.reingreso;
  const crecimiento = fraseCrecimiento(estimacion, hoy);

  if (!reingreso) return sinEtiqueta("Sin estimación", estimacion.mensaje ?? "No hay datos suficientes todavía.");
  if (!reingreso.criterio) {
    return sinEtiqueta("Sin etiqueta", `Para ${NOMBRES_PASTURA[lote.tipoPastura].toLowerCase()} todavía no hay un criterio de pastoreo cargado.`, crecimiento);
  }
  if (reingreso.fechaUltimoPastoreo && reingreso.fechaUltimoPastoreo >= hoy) return sinEtiqueta("Con animales", "Hay un pastoreo registrado hoy.");
  const hoyCondicion = reingreso.condicionHoy;
  if (!hoyCondicion) return sinEtiqueta("Sin estimación", "Falta el clima de algunos días: actualizá el clima del lote.");

  const condicion = hoyCondicion.condicion;
  const minimo = reingreso.esMinimo;
  // "Como mínimo No apto" siempre es cierto: es la condición más baja, así que no informa nada.
  // Pasa con un lote recién dado de alta sin pastoreos registrados.
  if (minimo && condicion === "no-apto") {
    return sinEtiqueta(
      "Falta el último pastoreo",
      "Registrá cuándo salieron los animales por última vez para saber si está listo.",
      `${reingreso.fechaInicioConteo ? `No hay pastoreos registrados desde el alta del lote (${fechaCorta(reingreso.fechaInicioConteo)}). ` : ""}`
        + "Si no sabés cuándo fue, no hace falta inventarlo: con los días sin pastoreo la estimación se va completando sola.",
    );
  }
  const ultimoDia = reingreso.condiciones.at(-1)?.fecha ?? hoy;
  let frase: string;
  if (condicion === "no-apto" || condicion === "cuidado") {
    const listo = reingreso.fechaTemprana;
    frase = listo
      ? `Listo para pastorear ${minimo ? "a más tardar " : ""}${cuandoRelativo(hoy, listo)}.`
      : `No llega a estar listo antes del ${fechaCorta(ultimoDia)}.`;
  } else if (condicion === "perfecto") {
    const tardia = reingreso.fechaTardia;
    if (!tardia) frase = `Ideal para pastorear, al menos hasta el ${fechaCorta(ultimoDia)}.`;
    else if (tardia === hoy) frase = "Hoy es su último día ideal.";
    else frase = `Ideal para pastorear hasta el ${fechaCorta(tardia)}${minimo ? " como mucho" : ""}.`;
  } else {
    frase = reingreso.fechaTardia ? `Pasó su mejor momento el ${fechaCorta(reingreso.fechaTardia)}: las hojas viejas empiezan a secarse.` : "Pasó su mejor momento.";
  }

  return {
    condicion,
    prefijo: esPiso(minimo, condicion) ? "Como mínimo" : null,
    titulo: CONDICION_PASTOREO[condicion].texto,
    frase,
    nota: minimo ? "No hay pastoreos registrados en RODEO: registrá el último para afinar la estimación." : null,
  };
}
