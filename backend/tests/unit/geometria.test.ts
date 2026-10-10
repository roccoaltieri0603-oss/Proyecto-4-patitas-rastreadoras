import { describe, expect, test } from 'vitest';
import { estaContenido, esPolygonFeature, mismaGeometria, seSuperpone } from '../../src/geometria.js';
import { establecimiento, lote } from '../helpers/fixtures.js';

describe('validación geométrica de RODEO', () => {
  test('reconoce el mismo polígono aunque rote el primer vértice o invierta el anillo', () => {
    const rotado = { ...establecimiento, geometry: { type: 'Polygon' as const, coordinates: [[[10, 10], [10, 0], [0, 0], [0, 10], [10, 10]]] } };
    expect(mismaGeometria(establecimiento, rotado)).toBe(true);
    expect(mismaGeometria(establecimiento, lote(1, 2))).toBe(false);
  });

  test('reconoce un Polygon GeoJSON válido', () => {
    expect(esPolygonFeature(lote(1, 2))).toBe(true);
    expect(esPolygonFeature({ type: 'Point', coordinates: [1, 2] })).toBe(false);
    expect(esPolygonFeature({ ...lote(1, 2), geometry: { type: 'Polygon', coordinates: [] } })).toBe(false);
  });

  test('comprueba contención, separación y solapamiento con las funciones del backend', () => {
    expect(estaContenido(lote(1, 2), establecimiento)).toBe(true);
    expect(estaContenido(lote(20, 21), establecimiento)).toBe(false);
    expect(seSuperpone(lote(1, 2), lote(3, 4))).toBe(false);
    expect(seSuperpone(lote(1, 3), lote(2, 4))).toBe(true);
  });

  test('un lote que comparte borde sin área no se considera solapado', () => {
    expect(seSuperpone(lote(1, 2), lote(2, 3))).toBe(false);
  });
});
