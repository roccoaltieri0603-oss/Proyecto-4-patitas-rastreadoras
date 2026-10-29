import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';

export type PolygonFeature = Feature<Polygon>;

type Posicion = number[];
type Anillo = Posicion[];

// Límite amplio para perímetros rurales dibujados; acota las comparaciones O(n²).
const MAX_POSICIONES_POLIGONO = 1_000;

function esPosicion(value: unknown): value is Posicion {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return false;
  if (!value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) return false;
  return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function mismaPosicion(a: Posicion, b: Posicion): boolean {
  return a.length === b.length && a.every((coordinate, index) => coordinate === b[index]);
}

function orientacion(a: Posicion, b: Posicion, c: Posicion): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function enSegmento(a: Posicion, b: Posicion, p: Posicion): boolean {
  return orientacion(a, b, p) === 0
    && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function segmentosSeCruzan(a: Posicion, b: Posicion, c: Posicion, d: Posicion): boolean {
  const abc = orientacion(a, b, c);
  const abd = orientacion(a, b, d);
  const cda = orientacion(c, d, a);
  const cdb = orientacion(c, d, b);
  if (((abc > 0 && abd < 0) || (abc < 0 && abd > 0))
      && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))) return true;
  return (abc === 0 && enSegmento(a, b, c)) || (abd === 0 && enSegmento(a, b, d))
    || (cda === 0 && enSegmento(c, d, a)) || (cdb === 0 && enSegmento(c, d, b));
}

function anilloSimple(ring: Anillo): boolean {
  if (ring.length < 4 || !mismaPosicion(ring[0], ring[ring.length - 1])) return false;
  const vertices = ring.slice(0, -1);
  if (new Set(vertices.map(([lng, lat]) => `${lng},${lat}`)).size < 3) return false;
  let twiceArea = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  if (!Number.isFinite(twiceArea) || twiceArea === 0) return false;

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i || j === (i + 1) % vertices.length || (j + 1) % vertices.length === i) continue;
      if (segmentosSeCruzan(a, b, vertices[j], vertices[(j + 1) % vertices.length])) return false;
    }
  }
  return true;
}

function anillosSeCruzan(a: Anillo, b: Anillo): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentosSeCruzan(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

function puntoEnAnillo(point: Posicion, ring: Anillo): boolean {
  return turf.booleanPointInPolygon(turf.point([point[0], point[1]]), turf.polygon([ring.map(([lng, lat]) => [lng, lat])]), { ignoreBoundary: true });
}

export function esPolygonFeature(value: unknown): value is PolygonFeature {
  if (!value || typeof value !== 'object') return false;
  const feature = value as Record<string, unknown>;
  const geometry = feature.geometry as Record<string, unknown> | null;
  if (feature.type !== 'Feature' || !geometry || geometry.type !== 'Polygon') return false;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
  const rings = geometry.coordinates as unknown[];
  if (!rings.every((ring): ring is Anillo => Array.isArray(ring) && ring.every(esPosicion))) return false;
  if (rings.reduce((total, ring) => total + ring.length, 0) > MAX_POSICIONES_POLIGONO) return false;
  if (rings.some((ring) => ring.length < 4)) return false;
  if (rings.some((ring) => ring.some((point) => point.length !== rings[0][0].length))) return false;
  if (rings.some((ring) => !anilloSimple(ring))) return false;

  try {
    const exterior = rings[0];
    for (let i = 1; i < rings.length; i++) {
      const hole = rings[i];
      if (anillosSeCruzan(exterior, hole) || !puntoEnAnillo(hole[0], exterior)) return false;
      for (let j = 1; j < i; j++) {
        if (anillosSeCruzan(rings[j], hole) || puntoEnAnillo(hole[0], rings[j]) || puntoEnAnillo(rings[j][0], hole)) return false;
      }
    }
    // Turf also rejects spikes and punctures; the explicit checks above cover
    // ring self-crossings and hole containment that booleanValid misses.
    return turf.booleanValid(value as PolygonFeature);
  } catch {
    return false;
  }
}

/** Superficie en hectáreas del polígono guardado. La misma cuenta que hace el mapa en `src/geo.ts`. */
export function areaHectareas(polygon: PolygonFeature): number {
  return turf.area(polygon) / 10000;
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
