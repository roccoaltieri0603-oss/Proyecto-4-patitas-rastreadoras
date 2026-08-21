import * as turf from "@turf/turf";
import type { PolygonFeature } from "./types";

const MIN_OVERLAP_AREA_M2 = 1;

export function areaHectareas(polygon: PolygonFeature): number {
  return turf.area(polygon) / 10000;
}

/** true si `inner` queda completamente contenido dentro de `outer` (puede tocar el borde). */
export function isFullyContained(inner: PolygonFeature, outer: PolygonFeature): boolean {
  const leftover = turf.difference(turf.featureCollection([inner, outer]));
  return leftover === null;
}

/** true si dos polígonos comparten área (no solo un borde/vértice en común). */
export function polygonsOverlap(a: PolygonFeature, b: PolygonFeature): boolean {
  const intersection = turf.intersect(turf.featureCollection([a, b]));
  if (!intersection) return false;
  return turf.area(intersection) > MIN_OVERLAP_AREA_M2;
}

export function centroidOf(polygon: PolygonFeature): [number, number] {
  const [lng, lat] = turf.centroid(polygon).geometry.coordinates;
  return [lat, lng];
}
