import { describe, expect, test } from 'vitest';
import { EVALSCRIPT_INDICES, NDWI1_UMBRAL_INUNDADO } from '../../src/copernicus/evalscript.js';
import { ALERTA_AGUA_LIBRE, FRACCION_MINIMA_INUNDADA, generarAlertas } from '../../src/copernicus/scoring.js';

type Muestra = { B02: number; B03: number; B04: number; B08: number; B11: number; SCL: number; dataMask: number };
type Salida = Record<string, number[]>;

/** El evalscript tal cual se manda a Copernicus, ejecutado píxel por píxel. */
const evaluatePixel = new Function(`${EVALSCRIPT_INDICES}\nreturn evaluatePixel;`)() as (muestra: Muestra) => Salida;

/** Píxel de vegetación (SCL 4) con el rojo y el SWIR indicados. */
function pixel(B04: number, B11: number, otros: Partial<Muestra> = {}): Muestra {
  return { B02: 0.05, B03: 0.08, B04, B08: 0.3, B11, SCL: 4, dataMask: 1, ...otros };
}

const ndvi = { media: 0.6, mediana: 0.6, min: 0.4, max: 0.8, desvio: 0.05 };
const ndmi = { media: 0.2, mediana: 0.2, min: 0.1, max: 0.3, desvio: 0.05 };
const ALERTA_AGUA = /agua libre|anegado/i;

describe('NDWI1 de Durante y Di Bella (2020) en el evalscript', () => {
  test('NDWI1 = (B04 − B11) / (B04 + B11)', () => {
    expect(evaluatePixel(pixel(0.1, 0.3)).ndwi1[0]).toBeCloseTo((0.1 - 0.3) / (0.1 + 0.3), 10);
    expect(evaluatePixel(pixel(0.2, 0.05)).ndwi1[0]).toBeCloseTo((0.2 - 0.05) / (0.2 + 0.05), 10);
  });

  test('no reemplaza al NDWI de verde e infrarrojo cercano', () => {
    const salida = evaluatePixel(pixel(0.1, 0.3));
    expect(salida.ndwi[0]).toBeCloseTo((0.08 - 0.3) / (0.08 + 0.3), 10);
  });

  test('clasifica el píxel como inundado sólo por encima de −0,2', () => {
    expect(NDWI1_UMBRAL_INUNDADO).toBe(-0.2);
    // (0,1 − 0,3) / 0,4 = −0,5: no inundado.
    expect(evaluatePixel(pixel(0.1, 0.3)).inundado[0]).toBe(0);
    // (0,2 − 0,25) / 0,45 = −0,11: inundado.
    expect(evaluatePixel(pixel(0.2, 0.25)).inundado[0]).toBe(1);
    // Justo en −0,2 no supera el umbral: (1 − 1,5) / 2,5, exacto en punto flotante.
    expect(evaluatePixel(pixel(1, 1.5)).ndwi1[0]).toBe(-0.2);
    expect(evaluatePixel(pixel(1, 1.5)).inundado[0]).toBe(0);
  });

  test('los píxeles excluidos por SCL quedan afuera, como el resto de los índices', () => {
    for (const scl of [0, 1, 3, 8, 9, 10, 11]) {
      const salida = evaluatePixel(pixel(0.2, 0.05, { SCL: scl }));
      expect(salida.dataMask[0]).toBe(0);
      expect(salida.inundado[0]).toBe(0);
    }
    expect(evaluatePixel(pixel(0.2, 0.05, { SCL: 6 })).dataMask[0]).toBe(1);
  });
});

describe('alerta de agua por fracción inundada', () => {
  test('el texto sigue siendo compatible con ALERTA_AGUA de orden-pastoreo', () => {
    expect(ALERTA_AGUA.test(ALERTA_AGUA_LIBRE)).toBe(true);
  });

  test('el porcentaje mínimo por defecto es 10 %', () => {
    expect(FRACCION_MINIMA_INUNDADA).toBe(0.1);
  });

  test('con la fracción NULL no hay alerta de agua', () => {
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: null })).toEqual([]);
  });

  test('por encima del porcentaje mínimo, alerta', () => {
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: 0.15 })).toEqual([ALERTA_AGUA_LIBRE]);
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: FRACCION_MINIMA_INUNDADA })).toEqual([ALERTA_AGUA_LIBRE]);
  });

  test('por debajo del porcentaje mínimo, no alerta', () => {
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: 0.09 })).toEqual([]);
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: 0 })).toEqual([]);
  });

  test('el porcentaje mínimo es configurable', () => {
    expect(generarAlertas({ diasDesde: 0, coberturaValida: 1, ndvi, ndmi, fraccionInundada: 0.15, fraccionMinimaInundada: 0.2 })).toEqual([]);
  });
});
