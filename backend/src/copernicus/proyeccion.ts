import { calcularPuntaje } from './scoring.js';
import type { CategoriaCondicion, CondicionLote, ProyeccionTendencia } from './types.js';

/**
 * Proyección lineal (mínimos cuadrados) del puntaje histórico de un lote.
 *
 * No es un modelo entrenado ni predictivo: reutiliza `calcularPuntaje` tal cual
 * sobre los puntos de `tendencia` que ya se muestran en el gráfico, y ajusta una
 * recta. Mismo descargo que `RANGOS` en scoring.ts: punto de partida, no
 * calibración agronómica. Nada de ML real hasta tener cortes de forraje u
 * observación a campo contra qué entrenar.
 *
 * Vive en el backend, junto al scoring que reutiliza, y viaja en la respuesta
 * sin persistirse: es un cálculo derivado, no una observación de Copernicus, y
 * sólo se guardan datos reales recibidos de la fuente.
 */

/** Con menos puntos, dos lecturas ruidosas "ajustan" cualquier recta. */
const MINIMO_PUNTOS = 3;
/** Por debajo de esto no se distingue de la variación normal entre pasadas. */
const PENDIENTE_MINIMA_SEMANAL = 2;
/** Extrapolar más allá de esto ya es aventurarse demasiado con una recta. */
const HORIZONTE_MAXIMO_DIAS = 60;

/** Mismos cortes que `categorizar()` en scoring.ts. */
const UMBRALES = [30, 50, 70] as const;
/** A qué categoría se entra al cruzar el umbral subiendo. */
const CATEGORIA_SOBRE_UMBRAL: Record<number, CategoriaCondicion> = {
  30: 'regular',
  50: 'buena',
  70: 'excelente',
};
/** A qué categoría se entra al cruzar el umbral bajando. */
const CATEGORIA_BAJO_UMBRAL: Record<number, CategoriaCondicion> = {
  30: 'baja',
  50: 'regular',
  70: 'buena',
};

function diasDesdeEpoca(fechaIso: string): number {
  return new Date(`${fechaIso}T12:00:00Z`).getTime() / (24 * 60 * 60 * 1000);
}

/** Puntaje aprox. de un punto histórico, con la misma fórmula que el puntaje actual. */
function puntajeDelPunto(punto: CondicionLote['tendencia'][number]): number {
  const comoEstadistica = (valor: number) => ({
    media: valor,
    mediana: valor,
    min: valor,
    max: valor,
    desvio: 0,
  });
  return calcularPuntaje(
    comoEstadistica(punto.ndvi),
    comoEstadistica(punto.ndmi),
    comoEstadistica(punto.ndwi),
    comoEstadistica(punto.evi),
  );
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

/** Umbral inmediato hacia abajo (bajando) o hacia arriba (subiendo) desde `puntaje`. */
function proximoUmbral(
  puntaje: number,
  direccion: 'subiendo' | 'bajando',
): { puntaje: number; categoria: CategoriaCondicion } | null {
  if (direccion === 'subiendo') {
    const umbral = UMBRALES.find((u) => u > puntaje);
    return umbral === undefined ? null : { puntaje: umbral, categoria: CATEGORIA_SOBRE_UMBRAL[umbral] };
  }
  const umbral = [...UMBRALES].reverse().find((u) => u <= puntaje);
  return umbral === undefined ? null : { puntaje: umbral, categoria: CATEGORIA_BAJO_UMBRAL[umbral] };
}

export function calcularProyeccion(tendencia: CondicionLote['tendencia']): ProyeccionTendencia | null {
  if (tendencia.length < MINIMO_PUNTOS) return null;

  const xs = tendencia.map((p) => diasDesdeEpoca(p.fecha));
  const ys = tendencia.map(puntajeDelPunto);

  const recta = regresionLineal(xs, ys);
  if (!recta) return null;

  const pendienteSemanal = recta.pendiente * 7;
  if (Math.abs(pendienteSemanal) < PENDIENTE_MINIMA_SEMANAL) {
    return { direccion: 'estable', pendienteSemanal, proximoCambio: null };
  }

  const direccion = pendienteSemanal > 0 ? 'subiendo' : 'bajando';
  const ultimoX = xs[xs.length - 1];
  const puntajeProyectadoHoy = recta.intercepto + recta.pendiente * ultimoX;

  const umbral = proximoUmbral(puntajeProyectadoHoy, direccion);
  if (!umbral) return { direccion, pendienteSemanal, proximoCambio: null };

  const dias = (umbral.puntaje - puntajeProyectadoHoy) / recta.pendiente;
  if (!Number.isFinite(dias) || dias <= 0 || dias > HORIZONTE_MAXIMO_DIAS) {
    return { direccion, pendienteSemanal, proximoCambio: null };
  }

  return {
    direccion,
    pendienteSemanal,
    proximoCambio: { categoria: umbral.categoria, dias: Math.round(dias) },
  };
}
