import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';

export type PolygonFeature = Feature<Polygon>;

export function esPolygonFeature(value: unknown): value is PolygonFeature {
  if (!value || typeof value !== 'object') return false;
  const feature = value as Record<string, unknown>;
  const geometry = feature.geometry as Record<string, unknown> | null;
  if (feature.type !== 'Feature' || !geometry || geometry.type !== 'Polygon') return false;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
  return geometry.coordinates.every(
    (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(
      (point) => Array.isArray(point) && point.length >= 2 && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)),
    ),
  );
}

export function estaContenido(inner: PolygonFeature, outer: PolygonFeature): boolean {
  try {
    return turf.difference(turf.featureCollection([inner, outer])) === null;
  } catch {
    return false;
  }
}

export function seSuperpone(a: PolygonFeature, b: PolygonFeature): boolean {
  try {
    const intersection = turf.intersect(turf.featureCollection([a, b]));
    return intersection !== null && turf.area(intersection) > 1;
  } catch {
    return true;
  }
}

/** Incluye el borde: Turf usa ignoreBoundary=false por defecto. */
export function puntoEnPoligono(latitud: number, longitud: number, poligono: PolygonFeature): boolean {
  try {
    return turf.booleanPointInPolygon(turf.point([longitud, latitud]), poligono, { ignoreBoundary: false });
  } catch {
    return false;
  }
}

/** Compara el área representada, sin tratar cambios de orden de vértices como ediciones. */
export function mismaGeometria(a: PolygonFeature, b: PolygonFeature): boolean {
  if (JSON.stringify(a.geometry) === JSON.stringify(b.geometry)) return true;
  try {
    const aMenosB = turf.difference(turf.featureCollection([a, b]));
    const bMenosA = turf.difference(turf.featureCollection([b, a]));
    return aMenosB === null && bMenosA === null;
  } catch {
    return false;
  }
}
