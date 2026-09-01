import { describe, expect, test } from 'vitest';
import { estaContenido, seSuperpone, type PolygonFeature } from '../../src/geometria.js';
import { depurarSugerencias } from '../../src/services/sugerencias-lotes.js';
import { establecimiento, lote } from '../helpers/fixtures.js';

function cruda(min: number, max: number, confianza?: number): PolygonFeature {
  return { ...lote(min, max), properties: confianza === undefined ? {} : { confianza } };
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
