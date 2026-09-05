import * as turf from '@turf/turf';
import { describe, expect, test } from 'vitest';
import { estaContenido, seSuperpone, type PolygonFeature } from '../../src/geometria.js';
import { depurarSugerencias, type SugerenciaLote } from '../../src/services/sugerencias-lotes.js';
import { establecimiento, lote } from '../helpers/fixtures.js';

function cruda(min: number, max: number, confianza?: number): PolygonFeature {
  return { ...lote(min, max), properties: confianza === undefined ? {} : { confianza } };
}

/*
 * Los umbrales del cierre de huecos son metros reales, así que estos casos se
 * arman en metros sobre un campo de 1000 x 1000 m ubicado en la pampa, y no en
 * grados sueltos como el resto de los fixtures.
 */
const ORIGEN: [number, number] = [-61.5, -34.6];
const METROS_POR_GRADO_LNG = 111_320 * Math.cos((ORIGEN[1] * Math.PI) / 180);
const METROS_POR_GRADO_LAT = 110_574;

function punto(x: number, y: number): [number, number] {
  return [ORIGEN[0] + x / METROS_POR_GRADO_LNG, ORIGEN[1] + y / METROS_POR_GRADO_LAT];
}

/** Polígono a partir de vértices en metros, cerrado automáticamente. */
function enMetros(...vertices: [number, number][]): PolygonFeature {
  const anillo = vertices.map(([x, y]) => punto(x, y));
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...anillo, anillo[0]]] } };
}

function rectangulo(x0: number, y0: number, x1: number, y1: number): PolygonFeature {
  return enMetros([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
}

const campo = rectangulo(0, 0, 1000, 1000);

/** Hectáreas cubiertas por la propuesta: la métrica que el cierre tiene que subir. */
function cubiertas(sugerencias: SugerenciaLote[]): number {
  return sugerencias.reduce((total, sugerencia) => total + turf.area(sugerencia.polygon) / 10_000, 0);
}

describe('depuración de las sugerencias del modelo', () => {
  test('recorta contra el límite del establecimiento', () => {
    // El modelo mira una imagen rectangular: propone cosas que se salen.
    const { sugerencias } = depurarSugerencias([cruda(8, 14)], { establecimiento, lotesExistentes: [] });

    expect(sugerencias).toHaveLength(1);
    expect(estaContenido(sugerencias[0].polygon, establecimiento)).toBe(true);
  });

  test('descarta lo que cae entero fuera del establecimiento y lo cuenta', () => {
    const resultado = depurarSugerencias([cruda(20, 25)], { establecimiento, lotesExistentes: [] });

    expect(resultado.sugerencias).toHaveLength(0);
    expect(resultado.descartadas).toBe(1);
  });

  test('le resta los lotes que ya existen', () => {
    const existente = lote(1, 3);
    const { sugerencias } = depurarSugerencias([cruda(0, 6)], { establecimiento, lotesExistentes: [existente] });

    expect(sugerencias).toHaveLength(1);
    expect(seSuperpone(sugerencias[0].polygon, existente)).toBe(false);
  });

  test('resuelve el solape entre propuestas dejando entera a la más grande', () => {
    const { sugerencias } = depurarSugerencias([cruda(0, 4), cruda(3, 9)], { establecimiento, lotesExistentes: [] });

    expect(sugerencias).toHaveLength(2);
    expect(seSuperpone(sugerencias[0].polygon, sugerencias[1].polygon)).toBe(false);
    // La grande (3..9) se procesa primero y conserva su superficie completa.
    expect(sugerencias[0].hectareas).toBeGreaterThan(sugerencias[1].hectareas);
  });

  test('respeta el tope de sugerencias', () => {
    const crudas = [cruda(0, 1), cruda(2, 3), cruda(4, 5)];
    const resultado = depurarSugerencias(crudas, { establecimiento, lotesExistentes: [], maximo: 2 });

    expect(resultado.sugerencias).toHaveLength(2);
    expect(resultado.descartadas).toBe(1);
  });

  test('conserva la confianza del modelo y reporta superficie en hectáreas', () => {
    const { sugerencias } = depurarSugerencias([cruda(0, 5, 0.83)], { establecimiento, lotesExistentes: [] });

    expect(sugerencias[0].confianza).toBe(0.83);
    expect(sugerencias[0].hectareas).toBeGreaterThan(0);
    expect(sugerencias[0].polygon.properties).toMatchObject({ origen: 'ia', confianza: 0.83 });
  });

  test('sin confianza informada no la inventa', () => {
    const { sugerencias } = depurarSugerencias([cruda(0, 5)], { establecimiento, lotesExistentes: [] });

    expect(sugerencias[0].confianza).toBeNull();
  });
});

describe('cierre de las franjas que deja el recorte', () => {
  test('reparte la tira fina que queda entre dos lotes contiguos', () => {
    // Cada máscara sale independiente del modelo: entre dos lotes vecinos queda
    // una tira de 10 m que nadie reclama y que el usuario tendría que coser.
    const izquierda = rectangulo(0, 0, 495, 1000);
    const derecha = rectangulo(505, 0, 1000, 1000);

    const abierto = depurarSugerencias([izquierda, derecha], { establecimiento: campo, lotesExistentes: [], franjas: false });
    const cerrado = depurarSugerencias([izquierda, derecha], { establecimiento: campo, lotesExistentes: [] });

    expect(abierto.franjasAsignadas).toBe(0);
    expect(cubiertas(abierto.sugerencias)).toBeLessThan(99.5);
    expect(cerrado.franjasAsignadas).toBe(1);
    expect(cerrado.sugerencias).toHaveLength(2);
    // El hueco de 1 ha quedó adentro de un lote: la propuesta tesela el campo.
    expect(cubiertas(cerrado.sugerencias)).toBeGreaterThan(99.9);
  });

  test('lo repartido sigue siendo guardable por POST /api/lotes', () => {
    const izquierda = rectangulo(0, 0, 495, 1000);
    const derecha = rectangulo(505, 0, 1000, 1000);

    const { sugerencias } = depurarSugerencias([izquierda, derecha], { establecimiento: campo, lotesExistentes: [] });

    for (const sugerencia of sugerencias) {
      expect(estaContenido(sugerencia.polygon, campo)).toBe(true);
      expect(sugerencia.polygon.geometry.type).toBe('Polygon');
      expect(sugerencia.hectareas).toBeCloseTo(turf.area(sugerencia.polygon) / 10_000, 1);
    }
    expect(seSuperpone(sugerencias[0].polygon, sugerencias[1].polygon)).toBe(false);
  });

  test('no se come una laguna grande y compacta', () => {
    // Lote derecho con una muesca de 195 x 200 m: el agua, que no es lote.
    const izquierda = rectangulo(0, 0, 495, 1000);
    const conLaguna = enMetros(
      [505, 0], [1000, 0], [1000, 1000], [505, 1000], [505, 600], [700, 600], [700, 400], [505, 400],
    );

    const { sugerencias, franjasAsignadas } = depurarSugerencias([izquierda, conLaguna], {
      establecimiento: campo, lotesExistentes: [],
    });

    expect(franjasAsignadas).toBeGreaterThan(0);
    const centroLaguna = turf.point(punto(600, 500));
    for (const sugerencia of sugerencias) {
      expect(turf.booleanPointInPolygon(centroLaguna, sugerencia.polygon)).toBe(false);
    }
    // Se cierra la tira de 10 m, no las 3.9 ha de laguna.
    expect(cubiertas(sugerencias)).toBeLessThan(96.5);
  });

  test('no rellena un camino más ancho que el umbral, y el umbral es configurable', () => {
    const izquierda = rectangulo(0, 0, 490, 1000);
    const derecha = rectangulo(510, 0, 1000, 1000);
    const opciones = { establecimiento: campo, lotesExistentes: [] };

    // 20 m de camino: el default de 12 m no lo toca.
    const conDefault = depurarSugerencias([izquierda, derecha], opciones);
    expect(conDefault.franjasAsignadas).toBe(0);
    expect(cubiertas(conDefault.sugerencias)).toBeLessThan(98.5);

    // Separar una franja de un camino angosto es una cuestión de escala, no de
    // forma: por eso el ancho se puede mover, con lo que eso implica.
    const conUmbralAlto = depurarSugerencias([izquierda, derecha], { ...opciones, franjas: { anchoMaximoMetros: 25 } });
    expect(conUmbralAlto.franjasAsignadas).toBe(1);
    expect(cubiertas(conUmbralAlto.sugerencias)).toBeGreaterThan(99.9);
  });

  test('no reparte lo que está pegado a un solo lote', () => {
    // Un potrero entero que el modelo no detectó no es una franja de recorte:
    // no se lo puede comer el vecino, aunque el vecino sea lo único que lo toca.
    const arriba = rectangulo(0, 700, 1000, 1000);
    const abajo = rectangulo(0, 0, 1000, 300);

    const { sugerencias, franjasAsignadas } = depurarSugerencias([arriba, abajo], {
      establecimiento: campo, lotesExistentes: [],
    });

    expect(franjasAsignadas).toBe(0);
    expect(cubiertas(sugerencias)).toBeLessThan(60.5);
  });

  test('no pisa ni agranda un lote ya guardado', () => {
    const izquierda = rectangulo(0, 0, 495, 1000);
    const derecha = rectangulo(505, 0, 1000, 1000);
    const guardado = rectangulo(495, 400, 505, 600);

    const { sugerencias, franjasAsignadas } = depurarSugerencias([izquierda, derecha], {
      establecimiento: campo, lotesExistentes: [guardado],
    });

    expect(franjasAsignadas).toBeGreaterThan(0);
    for (const sugerencia of sugerencias) {
      expect(seSuperpone(sugerencia.polygon, guardado)).toBe(false);
      expect(estaContenido(sugerencia.polygon, campo)).toBe(true);
    }
  });
});
