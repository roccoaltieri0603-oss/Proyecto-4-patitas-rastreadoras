import { describe, expect, test } from 'vitest';
import * as turf from '@turf/turf';
import { validarNumero, puntoInicial } from '../../src/services/gps-simulados.js';
import { decidirTransicionBateria } from '../../src/services/alertas-gps.js';

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

  test('batería abre un episodio y escala una sola vez hasta volver a normal', () => {
    const baja = decidirTransicionBateria(20, null);
    expect(baja).toMatchObject({ episodioActivo: true, nivelActual: 'baja', notificar: 'baja' });
    const critica = decidirTransicionBateria(10, baja.nivelInformado);
    expect(critica).toMatchObject({ episodioActivo: true, nivelActual: 'critica', nivelInformado: 'critica', notificar: 'critica' });
    expect(decidirTransicionBateria(8, critica.nivelInformado).notificar).toBeNull();
    expect(decidirTransicionBateria(15, critica.nivelInformado).notificar).toBeNull();
    expect(decidirTransicionBateria(20, critica.nivelInformado).notificar).toBeNull();
    expect(decidirTransicionBateria(21, critica.nivelInformado)).toMatchObject({ episodioActivo: false, nivelActual: 'normal', notificar: null });
    expect(decidirTransicionBateria(9, null).notificar).toBe('critica');
  });

  test('batería agotada escala una vez sin repetir la alerta crítica', () => {
    const agotadaDirecta = decidirTransicionBateria(0, null);
    expect(agotadaDirecta).toMatchObject({ nivelActual: 'agotada', notificar: 'agotada' });
    const baja = decidirTransicionBateria(20, null);
    const critica = decidirTransicionBateria(10, baja.nivelInformado);
    const agotada = decidirTransicionBateria(0, critica.nivelInformado);
    expect(agotada).toMatchObject({ nivelActual: 'agotada', notificar: 'agotada' });
    expect(decidirTransicionBateria(0, agotada.nivelInformado).notificar).toBeNull();
  });
});
