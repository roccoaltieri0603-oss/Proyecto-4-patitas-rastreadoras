import type { CondicionLote, ProyeccionRecuperacion, ProyeccionTendencia } from './types.js';

/**
 * Proyección lineal (mínimos cuadrados) de la mediana de NDVI de un lote.
 *
 * No es un modelo entrenado ni predictivo: ajusta una recta sobre los puntos de
 * `tendencia` que ya se muestran en el gráfico. Desde el 04/11/2026 la recta va
 * sobre el NDVI y no sobre el puntaje 0-100, que se sacó; con él se fue
 * `proximoCambio`, que dependía de los cortes de categoría.
 *
 * Vive en el backend y viaja en la respuesta sin persistirse: es un cálculo
 * derivado, no una observación de Copernicus, y sólo se guardan datos reales
 * recibidos de la fuente.
 */

/** Con menos puntos, dos lecturas ruidosas "ajustan" cualquier recta. */
export const MINIMO_PUNTOS = 3;
/**
 * NDVI por semana por debajo del cual la recta se lee como estable. Decisión de
 * diseño sin fuente, a revisar: por debajo de esto no se distingue de la
 * variación normal entre pasadas.
 */
export const PENDIENTE_MINIMA_SEMANAL = 0.01;
/** Extrapolar más allá de esto ya es aventurarse demasiado con una recta. */
export const HORIZONTE_MAXIMO_DIAS = 60;

function diasDesdeEpoca(fechaIso: string): number {
  return new Date(`${fechaIso}T12:00:00Z`).getTime() / (24 * 60 * 60 * 1000);
}

/** Pendiente e intercepto de la recta de mínimos cuadrados y = a + b·x. */
function regresionLineal(xs: number[], ys: number[]): { pendiente: number; intercepto: number } | null {
  const n = xs.length;
  const sumaX = xs.reduce((a, b) => a + b, 0);
  const sumaY = ys.reduce((a, b) => a + b, 0);
  const sumaXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumaX2 = xs.reduce((acc, x) => acc + x * x, 0);

  const denominador = n * sumaX2 - sumaX * sumaX;
  if (denominador === 0) return null;

  const pendiente = (n * sumaXY - sumaX * sumaY) / denominador;
  const intercepto = (sumaY - pendiente * sumaX) / n;
  return { pendiente, intercepto };
}

function rectaNdvi(tendencia: CondicionLote['tendencia']) {
  return regresionLineal(tendencia.map((p) => diasDesdeEpoca(p.fecha)), tendencia.map((p) => p.ndvi));
}

export function calcularProyeccion(tendencia: CondicionLote['tendencia']): ProyeccionTendencia | null {
  if (tendencia.length < MINIMO_PUNTOS) return null;
  const recta = rectaNdvi(tendencia);
  if (!recta) return null;

  const pendienteSemanal = recta.pendiente * 7;
  if (Math.abs(pendienteSemanal) < PENDIENTE_MINIMA_SEMANAL) return { direccion: 'estable', pendienteSemanal };
  return { direccion: pendienteSemanal > 0 ? 'subiendo' : 'bajando', pendienteSemanal };
}

/* ── Recuperación contra un NDVI propio del lote ────────────────────────────
 *
 * La misma recta de `calcularProyeccion`, leída contra un umbral del propio
 * lote. Lo usa la herramienta de demo "simular pastoreo" de la ficha, que
 * responde "si el lote se pastoreara hoy, ¿en cuántos días volvería a estar
 * como suele estar?". Todo sale de observaciones reales del lote: el piso, el
 * umbral y el ritmo. Nada de esto se persiste ni es un modelo entrenado.
 */

/** El piso real del lote: la fecha de menor NDVI de su propia serie. */
export function pisoObservado(tendencia: CondicionLote['tendencia']): { fecha: string; ndvi: number } | null {
  if (tendencia.length === 0) return null;
  const punto = tendencia.reduce((menor, actual) => (actual.ndvi < menor.ndvi ? actual : menor));
  return { fecha: punto.fecha, ndvi: punto.ndvi };
}

/**
 * Nivel al que se considera recuperado ese lote: la mediana de las medianas de
 * NDVI de su propia serie real, o sea "como suele estar".
 *
 * Se eligió la mediana y no la última lectura ni el máximo porque no se va con
 * una sola pasada mala o excepcionalmente buena, y porque queda siempre por
 * encima del piso salvo que la serie sea constante. Es un estadístico de datos
 * reales del lote, no un objetivo agronómico.
 */
export function umbralRecuperadoDelLote(tendencia: CondicionLote['tendencia']): number | null {
  if (tendencia.length === 0) return null;
  const valores = tendencia.map((p) => p.ndvi).sort((a, b) => a - b);
  const medio = Math.floor(valores.length / 2);
  return valores.length % 2 === 0 ? (valores[medio - 1] + valores[medio]) / 2 : valores[medio];
}

/**
 * Días hasta cruzar `umbralRecuperado` partiendo de `ndviInicial`, al ritmo que
 * muestra la serie real del lote.
 *
 * Devuelve null cuando la serie no da para estimar: pocas fechas, recta
 * degenerada, ritmo por debajo del ruido entre pasadas, o un cruce fuera del
 * horizonte. Preferimos no decir nada antes que decir un número inventado.
 */
export function calcularProyeccionRecuperacion(
  tendencia: CondicionLote['tendencia'],
  umbralRecuperado: number,
  ndviInicial: number,
): ProyeccionRecuperacion | null {
  if (tendencia.length < MINIMO_PUNTOS) return null;
  const recta = rectaNdvi(tendencia);
  if (!recta) return null;

  // Sin `Math.abs`, a diferencia de `calcularProyeccion`: una serie plana o en
  // caída no tiene ritmo de recuperación que proyectar. En ese caso no hay
  // estimación, y se dice.
  const pendienteSemanal = recta.pendiente * 7;
  if (pendienteSemanal < PENDIENTE_MINIMA_SEMANAL) return null;

  const dias = (umbralRecuperado - ndviInicial) / recta.pendiente;
  if (!Number.isFinite(dias) || dias <= 0 || dias > HORIZONTE_MAXIMO_DIAS) return null;

  return { ndviInicial, umbralRecuperado, pendienteSemanal, dias: Math.round(dias) };
}
