import { describe, expect, test, vi } from 'vitest';
// Comparar dos consultas es lógica pura; no debe hacer falta una DB para probarla.
vi.mock('../../src/base-datos/pool.js', () => ({ pool: {
  query: async () => ({ rows: [] }),
  connect: () => { throw new Error('Una prueba unitaria no debe conectar a PostgreSQL.'); },
} }));
import { climaEsIgual, type ResumenComparableClima } from '../../src/services/consultas-clima.js';
import type { DiaClima } from '../../src/services/open-meteo.js';

function dia(fecha: string, extra: Partial<DiaClima> = {}): DiaClima {
  return {
    fecha,
    lluviaMm: 0,
    tempMin: 8,
    tempMax: 20,
    radiacionMjM2: 15,
    evapotranspiracionMm: 3,
    esPronostico: false,
    ...extra,
  };
}

function consulta(dias: DiaClima[], extra: Partial<ResumenComparableClima> = {}): ResumenComparableClima {
  return { lluviaUltimos7Dias: 12, lluviaProximosDias: 4, categoria: 'normal', dias, ...extra };
}

describe('climaEsIgual', () => {
  test('clima idéntico: no hay nada nuevo que guardar', () => {
    const dias = [dia('2026-10-26'), dia('2026-10-27')];
    expect(climaEsIgual(consulta(dias), consulta([dia('2026-10-26'), dia('2026-10-27')]))).toBe(true);
  });

  test('una temperatura distinta cuenta como cambio', () => {
    // El modelo de forraje acumula grados-día con estas temperaturas: si esto
    // diera "igual", se perdería el dato y el rebrote se contaría mal.
    const anterior = consulta([dia('2026-10-26'), dia('2026-10-27')]);
    const nuevo = consulta([dia('2026-10-26'), dia('2026-10-27', { tempMax: 23 })]);
    expect(climaEsIgual(anterior, nuevo)).toBe(false);
  });

  test('un día nuevo en la ventana cuenta como cambio', () => {
    const anterior = consulta([dia('2026-10-26'), dia('2026-10-27')]);
    const nuevo = consulta([dia('2026-10-26'), dia('2026-10-27'), dia('2026-10-28', { esPronostico: true })]);
    expect(climaEsIgual(anterior, nuevo)).toBe(false);
  });

  test('cambia el resumen aunque los días coincidan', () => {
    const dias = [dia('2026-10-26')];
    expect(climaEsIgual(consulta(dias), consulta([dia('2026-10-26')], { lluviaUltimos7Dias: 30 }))).toBe(false);
    expect(climaEsIgual(consulta(dias), consulta([dia('2026-10-26')], { categoria: 'piso-pesado' }))).toBe(false);
  });

  test('distingue un valor ausente de un cero', () => {
    // "sin dato" y "llovió 0 mm" no son lo mismo: tratarlos igual escondería
    // que el proveedor dejó de informar ese día.
    const anterior = consulta([dia('2026-10-26', { lluviaMm: null })]);
    const nuevo = consulta([dia('2026-10-26', { lluviaMm: 0 })]);
    expect(climaEsIgual(anterior, nuevo)).toBe(false);
  });
});
