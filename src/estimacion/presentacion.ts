import type { CondicionPastoreo, Confianza, CrecimientoEstimado, EstimacionForraje, EtapaPasto, GrupoOrden, LoteOrdenado, MedicionConvertida, ReingresoEstimado } from "../api/estimacion";
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

/**
 * Slots 7, 3 y 4 de la paleta categórica de TendenciaChart, validados todos
 * contra todos (pasado y con animales quedan pegados en la franja; el naranja
 * no se distinguía del amarillo), y un gris neutro para lo que todavía crece.
 * El texto va siempre aparte del color.
 */
export const ETAPA_PASTO: Record<EtapaPasto, { texto: string; corto: string; color: string }> = {
  "en-pastoreo": { texto: "Con animales", corto: "con animales", color: "#6250d6" },
  rebrotando: { texto: "Rebrotando", corto: "rebrotando", color: "#9ca3af" },
  listo: { texto: "Listo para entrar", corto: "listo", color: "#1baf7a" },
  pasado: { texto: "Pasado", corto: "pasado", color: "#eda100" },
};

export const NOMBRE_CONFIANZA: Record<Confianza, string> = { alta: "alta", media: "media", baja: "baja" };

/**
 * Los grupos del orden de pastoreo con los colores de la etapa. "Esperar al
 * piso" y "sin datos" van con el punto hueco: no son una etapa del pasto.
 */
export const GRUPO_ORDEN: Record<GrupoOrden, { texto: string; color: string; hueco: boolean }> = {
  listo: { texto: "Listos para entrar", color: ETAPA_PASTO.listo.color, hueco: false },
  pasado: { texto: "Pasados de su mejor momento", color: ETAPA_PASTO.pasado.color, hueco: false },
  "esperar-al-piso": { texto: "Listos, pero con el piso pesado", color: ETAPA_PASTO.listo.color, hueco: true },
  rebrotando: { texto: "Rebrotando", color: ETAPA_PASTO.rebrotando.color, hueco: false },
  "en-pastoreo": { texto: "Con animales", color: ETAPA_PASTO["en-pastoreo"].color, hueco: false },
  "sin-datos": { texto: "Sin datos para ordenar", color: "#9ca3af", hueco: true },
};

/** "72 %": cuánto avanzó hacia el estado foliar óptimo. */
export function porcentajeRebrote(progreso: number): string {
  return `${Math.round(progreso * 100)} %`;
}

/**
 * Cuánto avanzó el rebrote, para la barra de "Regeneración": el avance de hoy
 * si la estimación lo trae y, si no, el del orden de pastoreo.
 *
 * Devuelve `null` cuando no hay ninguno de los dos, y la barra no se dibuja: un
 * 0 % diría "recién pastoreado", que no es lo mismo que no saber.
 */
export function progresoRegeneracion(
  reingreso: ReingresoEstimado | null | undefined,
  ordenado: { progresoRebrote: number | null } | undefined,
): number | null {
  // `avanceEstadoFoliar` viene en porcentaje y `progresoRebrote` como fracción:
  // las dos salen de acá como fracción, que es lo que dibuja la barra.
  const avance = reingreso?.condicionHoy?.avanceEstadoFoliar;
  if (avance != null) return avance / 100;
  return ordenado?.progresoRebrote ?? null;
}

/** De mejor a peor, para ordenar rankings. */
export const ORDEN_CONDICION: CondicionPastoreo[] = ["perfecto", "regular", "cuidado", "no-apto"];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "28 oct": se lee más rápido que 28/10/2026. */
export function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]}`;
}

export function diasEntre(desde: string, hasta: string): number {
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

/**
 * Sin pastura, sin parámetros, sin clima o sin la migración, la respuesta trae
 * sólo el motivo: no hay ni curva ni reingreso que mostrar al lado.
 */
export function esMensajeTerminal(estimacion: EstimacionForraje): boolean {
  return estimacion.mensaje !== null && estimacion.reingreso === null;
}

function enMinuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** "Listo para volver a entrar entre el X y el Y", o por qué no hay fecha. */
export function fraseVentanaReingreso(reingreso: ReingresoEstimado | null, hoy: string): string | null {
  if (!reingreso) return null;
  if (!reingreso.criterio) return reingreso.mensaje ?? "Sin criterio de reingreso con fuente para esta pastura.";
  if (reingreso.inicioConteo === "pastoreo" && reingreso.fechaUltimoPastoreo && reingreso.fechaUltimoPastoreo >= hoy) {
    return "Hay un pastoreo registrado hoy: la fecha para volver a entrar se cuenta desde la salida.";
  }
  const { fechaTemprana: temprana, fechaTardia: tardia } = reingreso;
  // Contado desde el alta, el lote está como mínimo así de avanzado: las fechas reales son iguales o anteriores.
  const aMasTardar = reingreso.esMinimo ? ", a más tardar" : "";
  if (temprana && tardia) {
    if (tardia < hoy) return `La ventana para volver a entrar fue del ${fechaCorta(temprana)} al ${fechaCorta(tardia)}${aMasTardar}.`;
    return `Listo para volver a entrar entre el ${fechaCorta(temprana)} y el ${fechaCorta(tardia)}${aMasTardar}.`;
  }
  if (temprana) return `Listo para volver a entrar desde el ${fechaCorta(temprana)}${aMasTardar}. ${reingreso.mensaje ?? ""}`.trim();
  return `Sin fecha para volver a entrar: ${enMinuscula(reingreso.mensaje ?? "Faltan datos para contar el descanso.")}`;
}

const NOMBRE_ESTACION = { verano: "verano", otono: "otoño", invierno: "invierno", primavera: "primavera" } as const;

function validacionDe(medicion: MedicionConvertida): string | null {
  const validacion = medicion.validacion;
  return validacion
    ? `En la validación de la fuente, la conversión ${validacion.sesgoPorcentaje > 0 ? "sobrestimó" : "subestimó"} ${Math.abs(validacion.sesgoPorcentaje).toLocaleString("es-AR")} % en ${NOMBRE_ESTACION[medicion.estacion]}.`
    : null;
}

/**
 * Cuánto pasto hay hoy, si hoy se midió, con el margen de la fuente. Si no, la
 * última medición con su fecha, que es un dato real pero no dice cuánto hay hoy.
 */
export function frasePastoEnPie(estimacion: EstimacionForraje, hoy: string): { principal: string; nota: string | null } {
  const deHoy = estimacion.dias.find((dia) => dia.fecha === hoy) ?? null;
  const mediciones = estimacion.mediciones ?? [];
  if (deHoy?.biomasaEnPieKgMsHa != null) {
    const medicion = mediciones.find((item) => item.fecha === deHoy.fechaMedicion && item.kgMsHa !== null) ?? null;
    const margen = deHoy.biomasaRango ? ` (entre ${kgRedondo(deHoy.biomasaRango[0])} y ${kgRedondo(deHoy.biomasaRango[1])} por el ajuste de la fuente)` : "";
    return { principal: `Pasto en pie: unos ${kgRedondo(deHoy.biomasaEnPieKgMsHa)} kg MS/ha${margen}, medido hoy.`, nota: medicion ? validacionDe(medicion) : null };
  }
  const ultima = mediciones.filter((item) => item.fecha <= hoy).at(-1);
  if (!ultima) return { principal: "Sin mediciones de altura: todavía no se puede saber cuánto pasto hay en pie.", nota: "Cargá una con \"Cargar medición\", al sacar los animales o en una recorrida." };
  if (ultima.kgMsHa === null) return { principal: `La medición del ${fechaCorta(ultima.fecha)} se guardó, pero no se pasa a kilos.`, nota: ultima.motivo };
  const hace = diasEntre(ultima.fecha, hoy);
  return {
    principal: `Última medición: unos ${kgRedondo(ultima.kgMsHa)} kg MS/ha el ${fechaCorta(ultima.fecha)}, hace ${hace} ${hace === 1 ? "día" : "días"}.`,
    nota: "El pasto cambia día a día: para saber cuánto hay hoy, medí de nuevo.",
  };
}

/** Cómo se nombra cada ventana: la de 30 días va primero; la de 60 es la de calibración de la fuente. */
export function rotuloVentanaCrecimiento(crecimiento: CrecimientoEstimado): string {
  return crecimiento.diasVentana === 30 ? "Crecimiento promedio del último mes" : "Según el período de calibración (60 días)";
}

/**
 * Cuánto creció por día, en promedio, en la ventana (30 o 60 días) que termina
 * en la última imagen despejada. Nunca se dice "hoy": la fuente no da valores
 * diarios ni semanales. Si no se puede calcular, el motivo.
 */
export function fraseCrecimiento(crecimiento: CrecimientoEstimado | null | undefined): { texto: string; calculado: boolean } | null {
  if (!crecimiento) return null;
  const rotulo = rotuloVentanaCrecimiento(crecimiento);
  if (crecimiento.kgMsHaDia === null || !crecimiento.ventana) {
    return crecimiento.motivo ? { texto: `${rotulo}: ${crecimiento.motivo}`, calculado: false } : null;
  }
  const kg = Math.round(crecimiento.kgMsHaDia).toLocaleString("es-AR");
  return {
    texto: `${rotulo}: unos ${kg} kg MS/ha por día, del ${fechaCorta(crecimiento.ventana.desde)} al ${fechaCorta(crecimiento.ventana.hasta)}.`,
    calculado: true,
  };
}

/** Cuánto se puede comer dejando el remanente objetivo; sólo se dice si hay pasto en pie. */
export function fraseConsumible(estimacion: EstimacionForraje, hoy: string): { texto: string; calculado: boolean } | null {
  const deHoy = estimacion.dias.find((dia) => dia.fecha === hoy);
  if (deHoy?.biomasaEnPieKgMsHa == null) return null;
  if (deHoy.consumibleKgMsHa !== null) return { texto: `Para comer: unos ${kgRedondo(deHoy.consumibleKgMsHa)} kg MS/ha, dejando el remanente objetivo.`, calculado: true };
  return deHoy.motivoConsumible ? { texto: deHoy.motivoConsumible, calculado: false } : null;
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

  if (!reingreso) return sinEtiqueta("Sin estimación", estimacion.mensaje ?? "No hay datos suficientes todavía.");
  if (!reingreso.criterio) {
    return sinEtiqueta("Sin etiqueta", `Para ${NOMBRES_PASTURA[lote.tipoPastura].toLowerCase()} todavía no hay un criterio de pastoreo cargado.`);
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

/** Qué tan apto está cada lote para entrar hoy: es lo que pinta el mapa. */
export type IngresoMapa = CondicionPastoreo | "piso-pesado" | "con-animales" | "sin-datos";

/** Leyenda del mapa, en el orden de la decisión. El texto va siempre al lado del color. */
export const INGRESO_MAPA: Record<IngresoMapa, { texto: string; detalle: string; color: string }> = {
  perfecto: { texto: "Perfecto", detalle: "listo para entrar", color: CONDICION_PASTOREO.perfecto.color },
  regular: { texto: "Regular", detalle: "se está pasando", color: CONDICION_PASTOREO.regular.color },
  cuidado: { texto: "Cuidado", detalle: "le falta poco", color: CONDICION_PASTOREO.cuidado.color },
  "no-apto": { texto: "No apto", detalle: "todavía rebrotando", color: CONDICION_PASTOREO["no-apto"].color },
  "piso-pesado": { texto: "Piso pesado", detalle: "esperar a que se oree", color: "#2563eb" },
  "con-animales": { texto: "Con animales", detalle: "pastoreo en curso", color: ETAPA_PASTO["en-pastoreo"].color },
  "sin-datos": { texto: "Sin datos", detalle: "no se puede estimar", color: "#94a3b8" },
};

export const ORDEN_INGRESO_MAPA: IngresoMapa[] = ["perfecto", "regular", "cuidado", "no-apto", "piso-pesado", "con-animales", "sin-datos"];

/**
 * El mismo criterio que la etiqueta de la ficha y el orden de pastoreo: estado
 * foliar en grados-día, más el piso pesado. El satélite no interviene.
 */
export function ingresoDelLote(item: LoteOrdenado | undefined): { tipo: IngresoMapa; texto: string } {
  if (!item) return { tipo: "sin-datos", texto: "Sin datos para estimar el ingreso" };
  if (item.grupo === "en-pastoreo") return { tipo: "con-animales", texto: "Con animales" };
  if (item.grupo === "esperar-al-piso") return { tipo: "piso-pesado", texto: "Piso pesado: esperar antes de entrar" };
  const condicion = item.condicionHoy;
  if (item.grupo === "sin-datos" || !condicion) return { tipo: "sin-datos", texto: item.motivos[0] ?? "Sin datos para estimar el ingreso" };
  // Como en la ficha: "como mínimo No apto" no informa nada sin el último pastoreo.
  if (item.etapaEsMinimo && condicion === "no-apto") return { tipo: "sin-datos", texto: "Falta registrar el último pastoreo" };
  const texto = CONDICION_PASTOREO[condicion].texto;
  return { tipo: condicion, texto: esPiso(item.etapaEsMinimo, condicion) ? `Como mínimo: ${texto}` : texto };
}
