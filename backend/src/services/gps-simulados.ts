import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { ApiError } from '../http/errors.js';
import { puntoEnPoligono } from '../geometria.js';

export function puntoInicial(poly: Feature<Polygon>, evitar?: [number, number]): [number, number] {
  const centro = turf.pointOnFeature(poly).geometry.coordinates as [number, number];
  if (!evitar || centro[0] !== evitar[0] || centro[1] !== evitar[1]) return centro;
  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  for (let n = 1; n <= 80; n++) for (let i = 0; i < n; i++) {
    const x = minX + (maxX - minX) * ((i + 0.5) / n);
    const y = minY + (maxY - minY) * ((n - ((i * 0.61803398875) % n) - 0.5) / n);
    if ((x !== evitar[0] || y !== evitar[1]) && puntoEnPoligono(y, x, poly)) return [x, y];
  }
  throw new ApiError(422, 'GPS_INITIAL_POSITION_UNAVAILABLE', 'No se pudieron ubicar dos puntos distintos dentro del establecimiento.');
}

export function validarNumero(v: unknown, nombre: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) throw new ApiError(400, 'INVALID_GPS_BATTERY', `${nombre} debe ser un entero entre 0 y 100.`);
  return v;
}
