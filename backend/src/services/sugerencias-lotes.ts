import * as turf from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { estaContenido, esPolygonFeature, seSuperpone, type PolygonFeature } from '../geometria.js';

/**
 * Depuración geométrica de lo que devuelve el modelo.
 *
 * El modelo mira una imagen rectangular y no sabe nada del establecimiento ni
 * de los lotes que ya existen: propone polígonos que se salen del límite, que
 * pisan lotes cargados y que se pisan entre sí. Acá se recortan contra la
 * realidad guardada en PostgreSQL, de modo que toda sugerencia que llega al
 * usuario sea una que `POST /api/lotes` aceptaría tal cual.
 *
 * Nada de esto se persiste: es una propuesta que vive en la respuesta HTTP.
 */

/** Piso de superficie: por debajo son astillas del recorte, no lotes. */
export const HECTAREAS_MINIMAS = 0.25;
export const MAXIMO_SUGERENCIAS = 60;

const M2_POR_HECTAREA = 10_000;

export interface SugerenciaLote {
  id: string;
  polygon: PolygonFeature;
  hectareas: number;
  confianza: number | null;
}

export interface OpcionesDepuracion {
  establecimiento: PolygonFeature;
  lotesExistentes: PolygonFeature[];
  hectareasMinimas?: number;
  maximo?: number;
}

export interface ResultadoDepuracion {
  sugerencias: SugerenciaLote[];
  descartadas: number;
}

type Recorte = Feature<Polygon | MultiPolygon>;

function confianzaDe(polygon: PolygonFeature): number | null {
  const valor = (polygon.properties as { confianza?: unknown } | null)?.confianza;
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function intersectar(a: Recorte, b: PolygonFeature): Recorte | null {
  try { return turf.intersect(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

function restar(a: Recorte, b: PolygonFeature): Recorte | null {
  try { return turf.difference(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

/** Un MultiPolygon del recorte son varios lotes separados, no uno con partes. */
function separarEnPoligonos(recorte: Recorte): PolygonFeature[] {
  if (recorte.geometry.type === 'Polygon') {
    return [turf.feature(recorte.geometry) as PolygonFeature];
  }
  return recorte.geometry.coordinates.map(
    (coordenadas) => turf.polygon(coordenadas) as PolygonFeature,
  );
}

export function depurarSugerencias(crudas: PolygonFeature[], opciones: OpcionesDepuracion): ResultadoDepuracion {
  const { establecimiento, lotesExistentes } = opciones;
  const minimoM2 = (opciones.hectareasMinimas ?? HECTAREAS_MINIMAS) * M2_POR_HECTAREA;
  const maximo = opciones.maximo ?? MAXIMO_SUGERENCIAS;

  // De mayor a menor: ante un solape entre dos detecciones, el lote grande se
  // queda entero y el chico cede la parte pisada.
  const ordenadas = [...crudas]
    .map((polygon) => ({ polygon, area: turf.area(polygon) }))
    .filter((item) => Number.isFinite(item.area) && item.area > 0)
    .sort((a, b) => b.area - a.area);

  const aceptadas: SugerenciaLote[] = [];
  let descartadas = 0;

  for (const { polygon } of ordenadas) {
    if (aceptadas.length >= maximo) { descartadas += 1; continue; }

    let recorte: Recorte | null = intersectar(polygon, establecimiento);
    for (const lote of lotesExistentes) {
      if (!recorte) break;
      recorte = restar(recorte, lote);
    }
    for (const previa of aceptadas) {
      if (!recorte) break;
      recorte = restar(recorte, previa.polygon);
    }
    if (!recorte) { descartadas += 1; continue; }

    const confianza = confianzaDe(polygon);
    let sumadas = 0;
    for (const parte of separarEnPoligonos(recorte)) {
      if (aceptadas.length >= maximo) break;
      const area = turf.area(parte);
      if (!Number.isFinite(area) || area < minimoM2) continue;
      // Red de seguridad: lo que no pasaría las validaciones de POST /api/lotes
      // no se ofrece. Preferimos una sugerencia menos que una que no se puede guardar.
      if (!esPolygonFeature(parte) || !estaContenido(parte, establecimiento)) continue;
      if (lotesExistentes.some((lote) => seSuperpone(parte, lote))) continue;
      if (aceptadas.some((previa) => seSuperpone(parte, previa.polygon))) continue;

      parte.properties = { origen: 'ia', confianza };
      aceptadas.push({
        id: `sug-${aceptadas.length + 1}`,
        polygon: parte,
        hectareas: Number((area / M2_POR_HECTAREA).toFixed(2)),
        confianza,
      });
      sumadas += 1;
    }
    if (sumadas === 0) descartadas += 1;
  }

  return { sugerencias: aceptadas, descartadas };
}
