import type { Feature, Polygon } from 'geojson';

export type PolygonFixture = Feature<Polygon>;

export const establecimiento: PolygonFixture = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};

export function lote(min: number, max: number): PolygonFixture {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]] },
  };
}

export const medicionOptica = {
  fuente: 'sentinel-2' as const,
  observedAt: '2026-08-16',
  consultedAt: '2026-08-20T12:00:00.000Z',
  coberturaValida: 82,
  ndvi: { media: 0.5, mediana: 0.52, min: 0.2, max: 0.8, desvio: 0.1 },
  ndmi: { media: 0.3, mediana: 0.32, min: 0.1, max: 0.5, desvio: 0.05 },
  ndwi: { media: 0.2, mediana: 0.22, min: 0, max: 0.4, desvio: 0.04 },
  evi: { media: 0.4, mediana: 0.42, min: 0.1, max: 0.7, desvio: 0.08 },
  puntaje: 78,
  categoria: 'buena',
};

export const medicionRadar = {
  fuente: 'sentinel-1' as const,
  observedAt: '2026-08-16',
  consultedAt: '2026-08-20T12:00:00.000Z',
  rvi: { media: 0.6, mediana: 0.62, min: 0.3, max: 0.9, desvio: 0.1 },
};

export const clima = (origen: 'automatico' | 'manual' = 'manual') => ({
  origen,
  consultedAt: '2026-08-20T12:00:00.000Z',
  lluviaUltimos7Dias: 12.5,
  lluviaProximosDias: 8.25,
  categoria: 'normal',
  dias: [
    { fecha: '2026-08-19', lluviaMm: 2.5, tempMin: 8, tempMax: 20, esPronostico: false },
    { fecha: '2026-08-21', lluviaMm: 4, tempMin: 10, tempMax: 23, esPronostico: true },
  ],
});
