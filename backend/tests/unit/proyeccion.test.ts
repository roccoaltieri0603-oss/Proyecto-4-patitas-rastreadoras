import { describe, expect, test } from 'vitest';
import {
  HORIZONTE_MAXIMO_DIAS,
  PENDIENTE_MINIMA_SEMANAL,
  calcularProyeccion,
  calcularProyeccionRecuperacion,
  pisoObservado,
  umbralRecuperadoDelLote,
} from '../../src/copernicus/proyeccion.js';
import type { CondicionLote } from '../../src/copernicus/types.js';

type Punto = CondicionLote['tendencia'][number];

/** Un punto de tendencia con los cuatro índices; la recta sólo mira la mediana de NDVI. */
function punto(fecha: string, ndvi: number, otros: Partial<Punto> = {}): Punto {
  return { fecha, ndvi, ndmi: 0.2, ndwi: -0.2, evi: 0.3, ...otros };
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

  test('una serie plana es estable y ya no anuncia cambios de categoría', () => {
    const resultado = calcularProyeccion(serie([0.45, 0.45, 0.45, 0.45]));
    expect(resultado).toEqual({ direccion: 'estable', pendienteSemanal: 0 });
    expect(resultado).not.toHaveProperty('proximoCambio');
  });

  test('la pendiente semanal está en NDVI por semana', () => {
    // De 0,25 a 0,70 en tres semanas: 0,15 por semana.
    const resultado = calcularProyeccion(serie([0.25, 0.4, 0.55, 0.7]));
    expect(resultado?.direccion).toBe('subiendo');
    expect(resultado?.pendienteSemanal).toBeCloseTo(0.15, 10);
  });

  test('una serie que baja da pendiente semanal negativa', () => {
    const resultado = calcularProyeccion(serie([0.7, 0.55, 0.4, 0.25]));
    expect(resultado?.direccion).toBe('bajando');
    expect(resultado?.pendienteSemanal).toBeCloseTo(-0.15, 10);
  });

  test('sólo mira el NDVI: mover los otros índices no cambia la recta', () => {
    const base = serie([0.25, 0.4, 0.55, 0.7]);
    const otros = base.map((p, i) => ({ ...p, ndmi: -0.3 + i, ndwi: 0.5 - i, evi: i }));
    expect(calcularProyeccion(otros)).toEqual(calcularProyeccion(base));
  });

  test('no extrapola desde fechas repetidas: sin varianza en x no hay recta', () => {
    const misma = [punto('2026-06-01', 0.3), punto('2026-06-01', 0.5), punto('2026-06-01', 0.7)];
    expect(calcularProyeccion(misma)).toBeNull();
  });
});

describe('piso y umbral propios del lote', () => {
  test('el piso es la fecha de menor NDVI de la serie real, no un número elegido a mano', () => {
    expect(pisoObservado(serie([0.5, 0.22, 0.6, 0.45]))).toEqual({ fecha: '2026-06-08', ndvi: 0.22 });
  });

  test('sin serie no hay piso ni umbral: no se inventan', () => {
    expect(pisoObservado([])).toBeNull();
    expect(umbralRecuperadoDelLote([])).toBeNull();
  });

  test('el umbral de recuperado es la mediana del NDVI real y queda sobre el piso', () => {
    const tendencia = serie([0.25, 0.4, 0.55, 0.7]);
    expect(umbralRecuperadoDelLote(tendencia)).toBeCloseTo((0.4 + 0.55) / 2, 10);
    expect(umbralRecuperadoDelLote(tendencia)!).toBeGreaterThan(pisoObservado(tendencia)!.ndvi);
  });

  test('una sola pasada excepcional no mueve el umbral', () => {
    const normal = umbralRecuperadoDelLote(serie([0.4, 0.45, 0.5, 0.45, 0.42]));
    const conPico = umbralRecuperadoDelLote(serie([0.4, 0.45, 0.5, 0.45, 0.95]));
    expect(conPico).toBe(normal);
  });
});

describe('calcularProyeccionRecuperacion', () => {
  test('devuelve null con muy pocos puntos, igual que la proyección de siempre', () => {
    expect(calcularProyeccionRecuperacion([], 0.6, 0.3)).toBeNull();
    expect(calcularProyeccionRecuperacion(serie([0.3]), 0.6, 0.3)).toBeNull();
    expect(calcularProyeccionRecuperacion(serie([0.3, 0.6]), 0.6, 0.3)).toBeNull();
  });

  test('devuelve null con una pendiente demasiado chica para distinguirla del ruido', () => {
    const casiPlana = serie([0.45, 0.451, 0.452, 0.453]);
    expect(Math.abs(calcularProyeccion(casiPlana)!.pendienteSemanal)).toBeLessThan(PENDIENTE_MINIMA_SEMANAL);
    expect(calcularProyeccion(casiPlana)?.direccion).toBe('estable');
    expect(calcularProyeccionRecuperacion(casiPlana, 0.6, 0.3)).toBeNull();
  });

  test('devuelve null si la serie viene bajando: no hay recuperación que proyectar', () => {
    expect(calcularProyeccionRecuperacion(serie([0.7, 0.55, 0.4, 0.25]), 0.6, 0.3)).toBeNull();
  });

  test('devuelve null sin varianza en las fechas', () => {
    const misma = [punto('2026-06-01', 0.3), punto('2026-06-01', 0.5), punto('2026-06-01', 0.7)];
    expect(calcularProyeccionRecuperacion(misma, 0.6, 0.3)).toBeNull();
  });

  test('con una serie que sube estima los días hasta el NDVI habitual del lote', () => {
    const tendencia = serie([0.25, 0.4, 0.55, 0.7]);
    const piso = pisoObservado(tendencia)!;
    const umbral = umbralRecuperadoDelLote(tendencia)!;

    const recuperacion = calcularProyeccionRecuperacion(tendencia, umbral, piso.ndvi);

    // (0,475 − 0,25) / (0,15 / 7) = 10,5 días.
    expect(recuperacion).not.toBeNull();
    expect(recuperacion!.dias).toBeGreaterThanOrEqual(10);
    expect(recuperacion!.dias).toBeLessThanOrEqual(11);
    expect(recuperacion!.pendienteSemanal).toBeCloseTo(0.15, 10);
    expect(recuperacion!.ndviInicial).toBe(piso.ndvi);
    expect(recuperacion!.umbralRecuperado).toBe(umbral);
  });

  test('no extrapola más allá del horizonte de la proyección', () => {
    expect(HORIZONTE_MAXIMO_DIAS).toBe(60);
    expect(calcularProyeccionRecuperacion(serie([0.25, 0.4, 0.55, 0.7]), 5, 0)).toBeNull();
  });

  test('devuelve null si el umbral ya está alcanzado: no hay días que contar', () => {
    expect(calcularProyeccionRecuperacion(serie([0.25, 0.4, 0.55, 0.7]), 0.1, 0.5)).toBeNull();
  });
});
