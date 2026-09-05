import { describe, expect, test } from 'vitest';
import {
  HORIZONTE_MAXIMO_DIAS,
  calcularProyeccion,
  calcularProyeccionRecuperacion,
  pisoObservado,
  umbralRecuperadoDelLote,
} from '../../src/copernicus/proyeccion.js';
import type { CondicionLote } from '../../src/copernicus/types.js';

type Punto = CondicionLote['tendencia'][number];

/**
 * Un punto de tendencia con los cuatro índices. El puntaje que sale de
 * `calcularPuntaje` sube con el NDVI, así que mover sólo ese alcanza para
 * fabricar una serie que crece o decrece.
 */
function punto(fecha: string, ndvi: number): Punto {
  return { fecha, ndvi, ndmi: 0.2, ndwi: -0.2, evi: 0.3 };
}

/** Una fecha cada 7 días desde el 1 de junio, con el NDVI que se le pase. */
function serie(ndvis: number[]): Punto[] {
  return ndvis.map((ndvi, i) => punto(`2026-06-${String(1 + i * 7).padStart(2, '0')}`, ndvi));
}

describe('calcularProyeccion', () => {
  test('devuelve null con menos de tres fechas: dos lecturas ajustan cualquier recta', () => {
    expect(calcularProyeccion([])).toBeNull();
    expect(calcularProyeccion(serie([0.3]))).toBeNull();
    expect(calcularProyeccion(serie([0.3, 0.5]))).toBeNull();
  });

  test('una serie plana es estable y no anuncia ningún cambio de categoría', () => {
    const resultado = calcularProyeccion(serie([0.45, 0.45, 0.45, 0.45]));
    expect(resultado).not.toBeNull();
    expect(resultado?.direccion).toBe('estable');
    expect(resultado?.proximoCambio).toBeNull();
  });

  test('una serie que sube da pendiente semanal positiva', () => {
    const resultado = calcularProyeccion(serie([0.25, 0.4, 0.55, 0.7]));
    expect(resultado?.direccion).toBe('subiendo');
    expect(resultado?.pendienteSemanal).toBeGreaterThan(0);
  });

  test('una serie que baja da pendiente semanal negativa', () => {
    const resultado = calcularProyeccion(serie([0.7, 0.55, 0.4, 0.25]));
    expect(resultado?.direccion).toBe('bajando');
    expect(resultado?.pendienteSemanal).toBeLessThan(0);
  });

  test('el próximo cambio, cuando lo hay, cae dentro del horizonte de 60 días', () => {
    const resultado = calcularProyeccion(serie([0.25, 0.4, 0.55, 0.7]));
    if (resultado?.proximoCambio) {
      expect(resultado.proximoCambio.dias).toBeGreaterThan(0);
      expect(resultado.proximoCambio.dias).toBeLessThanOrEqual(60);
    }
  });

  test('no extrapola desde fechas repetidas: sin varianza en x no hay recta', () => {
    const misma = [punto('2026-06-01', 0.3), punto('2026-06-01', 0.5), punto('2026-06-01', 0.7)];
    expect(calcularProyeccion(misma)).toBeNull();
  });
});

describe('piso y umbral propios del lote', () => {
  test('el piso es la fecha de menor NDVI de la serie real, no un número elegido a mano', () => {
    const piso = pisoObservado(serie([0.5, 0.22, 0.6, 0.45]));

    expect(piso?.fecha).toBe('2026-06-08');
    expect(piso?.ndvi).toBe(0.22);
    expect(piso?.puntaje).toBe(pisoObservado(serie([0.22]))?.puntaje);
  });

  test('sin serie no hay piso ni umbral: no se inventan', () => {
    expect(pisoObservado([])).toBeNull();
    expect(umbralRecuperadoDelLote([])).toBeNull();
  });

  test('el umbral de recuperado es la mediana de los puntajes reales y queda sobre el piso', () => {
    const tendencia = serie([0.25, 0.4, 0.55, 0.7]);
    const umbral = umbralRecuperadoDelLote(tendencia);
    const piso = pisoObservado(tendencia);

    expect(umbral).not.toBeNull();
    expect(umbral!).toBeGreaterThan(piso!.puntaje);
    // Mediana de cuatro puntos: promedio de los dos del medio.
    const puntajes = tendencia.map((p) => pisoObservado([p])!.puntaje).sort((a, b) => a - b);
    expect(umbral).toBeCloseTo((puntajes[1] + puntajes[2]) / 2, 10);
  });

  test('una sola pasada excepcional no mueve el umbral', () => {
    const normal = umbralRecuperadoDelLote(serie([0.4, 0.45, 0.5, 0.45, 0.42]));
    const conPico = umbralRecuperadoDelLote(serie([0.4, 0.45, 0.5, 0.45, 0.95]));

    expect(conPico).toBe(normal);
  });
});

describe('calcularProyeccionRecuperacion', () => {
  test('devuelve null con muy pocos puntos, igual que la proyección de siempre', () => {
    expect(calcularProyeccionRecuperacion([], 60, 30)).toBeNull();
    expect(calcularProyeccionRecuperacion(serie([0.3]), 60, 30)).toBeNull();
    expect(calcularProyeccionRecuperacion(serie([0.3, 0.6]), 60, 30)).toBeNull();
  });

  test('devuelve null con una pendiente demasiado chica para distinguirla del ruido', () => {
    // Sube, pero muy poco: menos de 2 puntos de puntaje por semana.
    const casiPlana = serie([0.45, 0.451, 0.452, 0.453]);
    const proyeccion = calcularProyeccion(casiPlana);

    expect(proyeccion?.direccion).toBe('estable');
    expect(calcularProyeccionRecuperacion(casiPlana, 60, 30)).toBeNull();
  });

  test('devuelve null si la serie viene bajando: no hay recuperación que proyectar', () => {
    expect(calcularProyeccionRecuperacion(serie([0.7, 0.55, 0.4, 0.25]), 60, 30)).toBeNull();
  });

  test('devuelve null sin varianza en las fechas, igual que la proyección de siempre', () => {
    const misma = [punto('2026-06-01', 0.3), punto('2026-06-01', 0.5), punto('2026-06-01', 0.7)];
    expect(calcularProyeccionRecuperacion(misma, 60, 30)).toBeNull();
  });

  test('con una serie que sube estima los días hasta el umbral del lote', () => {
    const tendencia = serie([0.25, 0.4, 0.55, 0.7]);
    const piso = pisoObservado(tendencia)!;
    const umbral = umbralRecuperadoDelLote(tendencia)!;

    const recuperacion = calcularProyeccionRecuperacion(tendencia, umbral, piso.puntaje);

    expect(recuperacion).not.toBeNull();
    expect(recuperacion!.dias).toBeGreaterThan(0);
    expect(recuperacion!.dias).toBeLessThanOrEqual(HORIZONTE_MAXIMO_DIAS);
    expect(recuperacion!.pendienteSemanal).toBeGreaterThanOrEqual(2);
    expect(recuperacion!.puntajeInicial).toBe(piso.puntaje);
    expect(recuperacion!.umbralRecuperado).toBe(umbral);
  });

  test('no extrapola más allá del horizonte de la proyección', () => {
    // Umbral inalcanzable a ese ritmo dentro de los 60 días.
    expect(calcularProyeccionRecuperacion(serie([0.25, 0.4, 0.55, 0.7]), 999, 0)).toBeNull();
  });

  test('devuelve null si el umbral ya está alcanzado: no hay días que contar', () => {
    expect(calcularProyeccionRecuperacion(serie([0.25, 0.4, 0.55, 0.7]), 10, 50)).toBeNull();
  });
});
