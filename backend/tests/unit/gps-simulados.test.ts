import { describe, expect, test } from 'vitest';
import * as turf from '@turf/turf';
import { validarNumero, puntoInicial } from '../../src/services/gps-simulados.js';

const poligono = turf.polygon([[[-71, -40], [-70.9, -40], [-70.9, -39.9], [-71, -39.9], [-71, -40]]]);

describe('GPS virtuales personales', () => {
  test('acepta sólo batería entera de 0 a 100', () => {
    expect(validarNumero(0, 'Batería')).toBe(0);
    expect(validarNumero(100, 'Batería')).toBe(100);
    for (const invalido of [-1, 101, 1.5, '50', Number.NaN]) expect(() => validarNumero(invalido, 'Batería')).toThrow();
  });

  test('elige dos coordenadas distintas dentro del establecimiento', () => {
    const a = puntoInicial(poligono);
    const b = puntoInicial(poligono, a);
    expect(b).not.toEqual(a);
    expect(turf.booleanPointInPolygon(turf.point(a), poligono)).toBe(true);
    expect(turf.booleanPointInPolygon(turf.point(b), poligono)).toBe(true);
  });
});
