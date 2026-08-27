import { describe, expect, test } from 'vitest';
import { calcularProyeccion } from '../../src/copernicus/proyeccion.js';
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
