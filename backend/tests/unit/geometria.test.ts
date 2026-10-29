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

  test('valida rangos, cierre, degeneraciÃ³n y autocruces', () => {
    const polygon = (coordinates: unknown) => ({ ...lote(1, 2), geometry: { type: 'Polygon', coordinates } });
    expect(esPolygonFeature(polygon([[[181, 0], [1, 0], [1, 1], [181, 0]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[[0, 91], [1, 0], [1, 1], [0, 91]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[[0, 0], [1, 0, 2], [1, 1], [0, 0]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[[0, 0], [1, 0], [1, 1], [0, 1]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[[0, 0], [1, 0], [2, 0], [0, 0]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]]))).toBe(false);
    expect(esPolygonFeature(polygon([[]]))).toBe(false);
  });

  test('admite huecos vÃ¡lidos y rechaza huecos externos, cruzados o superpuestos', () => {
    const polygon = (coordinates: unknown) => ({ ...lote(1, 2), geometry: { type: 'Polygon', coordinates } });
    const exterior = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hueco = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const afuera = [[12, 2], [14, 2], [14, 4], [12, 4], [12, 2]];
    const cruzado = [[8, 2], [12, 2], [12, 4], [8, 4], [8, 2]];
    const superpuesto = [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]];
    expect(esPolygonFeature(polygon([exterior, hueco]))).toBe(true);
    expect(esPolygonFeature(polygon([exterior, afuera]))).toBe(false);
    expect(esPolygonFeature(polygon([exterior, cruzado]))).toBe(false);
    expect(esPolygonFeature(polygon([exterior, hueco, superpuesto]))).toBe(false);
  });

  test('admite coordenadas 3D coherentes', () => {
    const polygon = { ...lote(1, 2), geometry: { type: 'Polygon', coordinates: [[[0, 0, 12], [1, 0, 12], [1, 1, 12], [0, 1, 12], [0, 0, 12]]] } };
    expect(esPolygonFeature(polygon)).toBe(true);
  });

  test('limita las posiciones totales y acepta el máximo configurado', () => {
    const hacerAnillo = (vertices: number) => {
      const ring = Array.from({ length: vertices }, (_, index) => {
        const angle = (2 * Math.PI * index) / vertices;
        return [Math.cos(angle), Math.sin(angle)];
      });
      ring.push(ring[0]);
      return ring;
    };
    const polygon = (vertices: number) => ({ ...lote(1, 2), geometry: { type: 'Polygon', coordinates: [hacerAnillo(vertices)] } });
    expect(esPolygonFeature(polygon(999))).toBe(true);
    expect(esPolygonFeature(polygon(1_000))).toBe(false);
  });
});
