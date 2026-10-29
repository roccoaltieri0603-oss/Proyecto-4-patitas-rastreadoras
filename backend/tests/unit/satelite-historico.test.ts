import { describe, expect, test, vi } from 'vitest';
vi.mock('../../src/base-datos/pool.js', () => ({ pool: {
  query: () => { throw new Error('Una prueba unitaria no debe consultar PostgreSQL.'); },
} }));
import { aObservacion } from '../../src/copernicus/analizar.js';
import { calcularPuntaje, categorizar } from '../../src/copernicus/scoring.js';
import type { IntervaloEstadisticas, StatsCrudas } from '../../src/copernicus/types.js';
import type { MedicionSatelitalPersistible } from '../../src/services/mediciones-satelitales.js';
import {
  completarSateliteHistorico, medicionDesdeObservacion, observacionesDeRespuesta, puEstimadas, ventanasDeConsulta,
  type DependenciasSateliteHistorico,
} from '../../src/services/satelite-historico.js';
import { lote } from '../helpers/fixtures.js';

/** Un lote de 0,002° de lado: 10 × 10 píxeles, debajo del área mínima de facturación. */
const CHICO = { id: '11111111-1111-4111-8111-111111111111', polygon: lote(0, 0.002) };
const OTRO = { id: '22222222-2222-4222-8222-222222222222', polygon: lote(0, 0.002) };

function stats(media: number): StatsCrudas {
  return { min: -0.2, max: 0.8, mean: media, stDev: 0.1, sampleCount: 100, noDataCount: 10, percentiles: { '50.0': media } };
}

function intervalo(fecha: string, ndvi = 0.6): IntervaloEstadisticas {
  const salida = (valor: StatsCrudas) => ({ bands: { B0: { stats: valor } } });
  return {
    interval: { from: `${fecha}T00:00:00Z`, to: `${fecha}T23:59:59Z` },
    outputs: { ndvi: salida(stats(ndvi)), ndmi: salida(stats(0.12)), ndwi: salida(stats(-0.1)), evi: salida(stats(0.3)) },
  };
}

function respuesta(...fechas: string[]) {
  return { status: 200, texto: JSON.stringify({ data: fechas.map((fecha) => intervalo(fecha)) }) };
}

describe('piezas del histórico satelital', () => {
  test('parte el período en ventanas consecutivas e inclusivas', () => {
    expect(ventanasDeConsulta('2026-01-01', '2026-01-10', 4)).toEqual([
      { desde: '2026-01-01', hasta: '2026-01-04' },
      { desde: '2026-01-05', hasta: '2026-01-08' },
      { desde: '2026-01-09', hasta: '2026-01-10' },
    ]);
    expect(ventanasDeConsulta('2025-10-24', '2026-10-23')).toHaveLength(5);
  });

  test('estima las PU con la fórmula de CDSE: área mínima 0,01, 6 bandas / 3, FLOAT32 × 2, una pasada cada 2 días', () => {
    expect(puEstimadas(CHICO, 365)).toBeCloseTo(0.01 * 2 * 2 * 183, 10);
    // 0,2° × 0,2°: 1000 × 1000 píxeles, casi 3,8 veces la referencia de 512 × 512.
    expect(puEstimadas({ id: 'x', polygon: lote(0, 0.2) }, 2)).toBeCloseTo((1_000_000 / 262_144) * 2 * 2 * 1, 6);
  });

  test('cada pasada se puntúa con el mismo scoring y se rotula como histórica', () => {
    const observacion = aObservacion(intervalo('2026-03-01'))!;
    const medicion = medicionDesdeObservacion(observacion, new Date('2026-10-23T12:00:00Z'), { desde: '2026-02-01', hasta: '2026-04-30' });
    const puntaje = calcularPuntaje(observacion.ndvi, observacion.ndmi, observacion.ndwi, observacion.evi);
    expect(medicion).toMatchObject({ fuente: 'sentinel-2', observedAt: '2026-03-01', puntaje, categoria: categorizar(puntaje), coberturaValida: 0.9 });
    expect(medicion.alertas?.some((alerta) => alerta.includes('hace'))).toBe(false);
    expect(medicion.rawMetadata).toEqual({ origen: 'satelite-historico', ventana: { desde: '2026-02-01', hasta: '2026-04-30' } });
  });

  test('descarta pasadas nubladas y las que caen fuera de la ventana', () => {
    const nublada = { ...intervalo('2026-03-02'), outputs: { ...intervalo('2026-03-02').outputs, ndvi: { bands: { B0: { stats: { ...stats(0.6), noDataCount: 90 } } } } } };
    const texto = JSON.stringify({ data: [intervalo('2026-03-05'), nublada, intervalo('2026-03-01'), intervalo('2026-05-01')] });
    expect(observacionesDeRespuesta(texto, { desde: '2026-03-01', hasta: '2026-03-31' })?.map((item) => item.fecha)).toEqual(['2026-03-01', '2026-03-05']);
    expect(observacionesDeRespuesta('no es json', { desde: '2026-03-01', hasta: '2026-03-31' })).toBeNull();
  });
});

describe('completarSateliteHistorico', () => {
  function dependencias(overrides: Partial<DependenciasSateliteHistorico> = {}): DependenciasSateliteHistorico {
    return {
      lotes: async () => [CHICO],
      fechasGuardadas: async (ids) => new Map(ids.map((id) => [id, new Set<string>()])),
      consultar: async () => respuesta(),
      guardar: async () => {},
      dormir: async () => {},
      ...overrides,
    };
  }

  test('por defecto sólo arma el plan: no consulta Copernicus ni guarda', async () => {
    const consultar = vi.fn();
    const guardar = vi.fn();
    const resumen = await completarSateliteHistorico({ hoy: '2026-10-23' }, dependencias({ consultar, guardar }));
    expect(consultar).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
    expect(resumen).toMatchObject({ desde: '2025-10-24', hasta: '2026-10-23', escrito: false });
    expect(resumen.lotes).toEqual([{ loteId: CHICO.id, ventanas: 5, fechasYaGuardadas: 0, puEstimadas: 7.32 }]);
  });

  test('frena antes de consultar si las PU estimadas pasan el máximo', async () => {
    const consultar = vi.fn();
    const resumen = await completarSateliteHistorico({ hoy: '2026-10-23', escribir: true, maxPu: 5 }, dependencias({ consultar }));
    expect(consultar).not.toHaveBeenCalled();
    expect(resumen.detenido).toMatch(/pasan el máximo de 5/);
  });

  test('saltea fechas ya guardadas y guarda el resto de una sola vez', async () => {
    const guardar = vi.fn(async (_id: string, _mediciones: MedicionSatelitalPersistible[]) => {});
    const consultar = vi.fn(async (cuerpo: string) => {
      const desde = JSON.parse(cuerpo).aggregation.timeRange.from.slice(0, 10);
      return desde === '2026-09-14' ? respuesta('2026-09-20', '2026-10-01', '2026-10-06') : respuesta();
    });
    const resumen = await completarSateliteHistorico({ hoy: '2026-10-23', dias: 40, escribir: true }, dependencias({
      fechasGuardadas: async () => new Map([[CHICO.id, new Set(['2026-10-01'])]]),
      consultar, guardar,
    }));
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][1].map((medicion) => medicion.observedAt)).toEqual(['2026-09-20', '2026-10-06']);
    expect(resumen).toMatchObject({ escrito: true, imagenesNuevas: 2, imagenesYaGuardadas: 1, errores: [] });
  });

  test('un lote con una ventana fallida no se guarda a medias', async () => {
    const guardar = vi.fn();
    let pedidos = 0;
    const resumen = await completarSateliteHistorico({ hoy: '2026-10-23', dias: 200, escribir: true }, dependencias({
      consultar: async () => (++pedidos === 2 ? { status: 500, texto: '' } : respuesta('2026-06-01')),
      guardar,
    }));
    expect(guardar).not.toHaveBeenCalled();
    expect(resumen.errores).toEqual([{ loteId: CHICO.id, mensaje: 'Copernicus respondió HTTP 500.' }]);
  });

  test('un 429 corta la corrida entera sin seguir gastando cuota', async () => {
    const consultar = vi.fn(async () => ({ status: 429, texto: '' }));
    const resumen = await completarSateliteHistorico({ hoy: '2026-10-23', escribir: true }, dependencias({
      lotes: async () => [CHICO, OTRO, { ...CHICO, id: '33333333-3333-4333-8333-333333333333' }],
      consultar,
    }));
    expect(resumen.cortado).toBe(true);
    // Los dos trabajadores en paralelo pueden alcanzar a pedir una vez cada uno, nunca más.
    expect(consultar.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('consulta un lote a la vez para evitar ráfagas al proveedor', async () => {
    let enCurso = 0;
    let maximo = 0;
    await completarSateliteHistorico({ hoy: '2026-10-23', dias: 10, escribir: true }, dependencias({
      lotes: async () => [CHICO, OTRO, { ...CHICO, id: '33333333-3333-4333-8333-333333333333' }, { ...OTRO, id: '44444444-4444-4444-8444-444444444444' }],
      consultar: async () => {
        enCurso += 1; maximo = Math.max(maximo, enCurso);
        await new Promise((listo) => { setTimeout(listo, 5); });
        enCurso -= 1;
        return respuesta();
      },
    }));
    expect(maximo).toBe(1);
  });
});
