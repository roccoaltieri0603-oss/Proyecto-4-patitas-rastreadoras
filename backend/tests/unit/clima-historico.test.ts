import { describe, expect, test, vi } from 'vitest';
// El cliente y la orquestación se prueban con dependencias inyectadas; nada toca la base.
vi.mock('../../src/base-datos/pool.js', () => ({ pool: {
  query: () => { throw new Error('Una prueba unitaria no debe consultar PostgreSQL.'); },
} }));
import {
  OpenMeteoHistoricoClient,
  aDiasHistoricos,
  completarClimaHistorico,
  planificarClimaHistorico,
  type DependenciasClimaHistorico,
  type LoteConFaltantes,
  type ResultadoHistoricoLote,
} from '../../src/services/clima-historico.js';
import { lote } from '../helpers/fixtures.js';

function registro(desde: string, dias: Array<[number | null, number | null, number | null]>) {
  const [anio, mes, dia] = desde.split('-').map(Number);
  return {
    daily: {
      time: dias.map((_, i) => new Date(Date.UTC(anio, mes - 1, dia + i)).toISOString().slice(0, 10)),
      temperature_2m_min: dias.map(([min]) => min),
      temperature_2m_max: dias.map(([, max]) => max),
      shortwave_radiation_sum: dias.map(([, , rad]) => rad),
    },
  };
}

describe('aDiasHistoricos', () => {
  test('toma los tres valores por día dentro del rango pedido', () => {
    expect(aDiasHistoricos(registro('2026-08-01', [[5, 15, 12], [6, 16, 13], [7, 17, 14]]), '2026-08-02', '2026-08-03')).toEqual([
      { fecha: '2026-08-02', tempMin: 6, tempMax: 16, radiacionMjM2: 13 },
      { fecha: '2026-08-03', tempMin: 7, tempMax: 17, radiacionMjM2: 14 },
    ]);
  });

  test('descarta días sin ningún dato y radiación negativa, sin inventar valores', () => {
    expect(aDiasHistoricos(registro('2026-08-01', [[null, null, null], [5, null, -3]]), '2026-08-01', '2026-08-02')).toEqual([
      { fecha: '2026-08-02', tempMin: 5, tempMax: null, radiacionMjM2: null },
    ]);
  });

  test('rechaza una respuesta sin fechas válidas', () => {
    expect(aDiasHistoricos({ daily: { time: ['ayer'] } }, '2026-08-01', '2026-08-02')).toBeNull();
    expect(aDiasHistoricos({}, '2026-08-01', '2026-08-02')).toBeNull();
  });
});

describe('OpenMeteoHistoricoClient', () => {
  const lotes = [{ id: 'a', polygon: lote(0, 1) }, { id: 'b', polygon: lote(1, 2) }];

  test('pide al pronóstico histórico, en una sola consulta multi-coordenada, sólo las tres variables', async () => {
    let pedida = '';
    const cliente = new OpenMeteoHistoricoClient(async (url) => {
      pedida = url;
      return { ok: true, status: 200, json: async () => [registro('2026-08-01', [[5, 15, 12]]), registro('2026-08-01', [[6, 16, 13]])] };
    });
    const resultados = await cliente.consultar(lotes, '2026-08-01', '2026-08-01');
    const url = new URL(pedida);
    expect(url.origin + url.pathname).toBe('https://historical-forecast-api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('daily')).toBe('temperature_2m_max,temperature_2m_min,shortwave_radiation_sum');
    expect(url.searchParams.get('start_date')).toBe('2026-08-01');
    expect(url.searchParams.get('end_date')).toBe('2026-08-01');
    expect(url.searchParams.get('latitude')?.split(',')).toHaveLength(2);
    expect(url.searchParams.get('models')).toBeNull();
    expect(resultados.a).toMatchObject({ estado: 'ok', dias: [{ fecha: '2026-08-01', tempMin: 5 }] });
    expect(resultados.b).toMatchObject({ estado: 'ok', dias: [{ fecha: '2026-08-01', tempMin: 6 }] });
  });

  test('un 429 se marca como límite de consultas', async () => {
    const cliente = new OpenMeteoHistoricoClient(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    expect((await cliente.consultar(lotes, '2026-08-01', '2026-08-02')).a).toMatchObject({ estado: 'error', limite: true });
  });

  test('un error de red no lanza: devuelve error por lote', async () => {
    const cliente = new OpenMeteoHistoricoClient(async () => { throw new Error('sin red'); });
    expect((await cliente.consultar(lotes, '2026-08-01', '2026-08-02')).b).toMatchObject({ estado: 'error' });
  });
});

describe('completarClimaHistorico', () => {
  function pendiente(id: string, faltantes: string[]): LoteConFaltantes {
    return { id, polygon: lote(0, 1), faltantes };
  }
  function ok(id: string, fechas: string[]): ResultadoHistoricoLote {
    return { estado: 'ok', loteId: id, latitud: -37, longitud: -58, dias: fechas.map((fecha) => ({ fecha, tempMin: 5, tempMax: 15, radiacionMjM2: 12 })) };
  }
  function dependencias(overrides: Partial<DependenciasClimaHistorico> = {}): DependenciasClimaHistorico {
    return {
      disponible: async () => true,
      lotesConFaltantes: async () => [],
      consultar: async (lotes, desde, hasta) => Object.fromEntries(lotes.map((item) => [item.id, ok(item.id, [desde, hasta])])),
      guardar: async (resultado, faltantes) => resultado.dias.filter((dia) => faltantes.has(dia.fecha)).length,
      dormir: async () => {},
      ahoraMs: () => 0,
      registrar: () => {},
      ...overrides,
    };
  }

  test('sin la migración 016 no hace nada', async () => {
    const lotesConFaltantes = vi.fn(async () => []);
    const resumen = await completarClimaHistorico({}, dependencias({ disponible: async () => false, lotesConFaltantes }));
    expect(resumen.disponible).toBe(false);
    expect(lotesConFaltantes).not.toHaveBeenCalled();
  });

  test('cada tanda pide del primer al último faltante y guarda sólo los faltantes de cada lote', async () => {
    const consultar = vi.fn(async (lotes: LoteConFaltantes[], desde: string, hasta: string) =>
      Object.fromEntries(lotes.map((item) => [item.id, ok(item.id, ['2026-08-01', '2026-08-02', '2026-08-03'].filter((fecha) => fecha >= desde && fecha <= hasta))])));
    const guardar = vi.fn(async (resultado: Extract<ResultadoHistoricoLote, { estado: 'ok' }>, faltantes: Set<string>) => resultado.dias.filter((dia) => faltantes.has(dia.fecha)).length);
    const resumen = await completarClimaHistorico({ tamanoTanda: 5, hoy: '2026-10-22' }, dependencias({
      lotesConFaltantes: async () => [pendiente('a', ['2026-08-01', '2026-08-03']), pendiente('b', ['2026-08-02'])],
      consultar, guardar,
    }));
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar.mock.calls[0].slice(1)).toEqual(['2026-08-01', '2026-08-03']);
    expect([...guardar.mock.calls[0][1]]).toEqual(['2026-08-01', '2026-08-03']);
    expect(resumen).toMatchObject({ disponible: true, pendientes: 2, consultados: 2, lotesCompletados: 2, diasGuardados: 3, errores: 0, cortado: false });
  });

  test('corta ante el límite de consultas sin seguir gastando cuota', async () => {
    const consultar = vi.fn(async (lotes: LoteConFaltantes[]) => Object.fromEntries(lotes.map((item) => [item.id, { estado: 'error', loteId: item.id, mensaje: 'límite', limite: true } as const])));
    const resumen = await completarClimaHistorico({ tamanoTanda: 1 }, dependencias({
      lotesConFaltantes: async () => [pendiente('a', ['2026-08-01']), pendiente('b', ['2026-08-01'])],
      consultar,
    }));
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(resumen).toMatchObject({ cortado: true, errores: 1, diasGuardados: 0 });
  });

  test('respeta el presupuesto de tiempo', async () => {
    let reloj = 0;
    const consultar = vi.fn(async (lotes: LoteConFaltantes[], desde: string) => { reloj += 10_000; return Object.fromEntries(lotes.map((item) => [item.id, ok(item.id, [desde])])); });
    const resumen = await completarClimaHistorico({ tamanoTanda: 1, presupuestoMs: 15_000 }, dependencias({
      lotesConFaltantes: async () => [pendiente('a', ['2026-08-01']), pendiente('b', ['2026-08-01']), pendiente('c', ['2026-08-01'])],
      consultar,
      ahoraMs: () => reloj,
    }));
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(resumen.cortado).toBe(true);
  });

  test('pasa --desde a la búsqueda de faltantes', async () => {
    const lotesConFaltantes = vi.fn(async () => [] as LoteConFaltantes[]);
    await completarClimaHistorico({ desde: '2026-01-01', ids: ['a'], hoy: '2026-10-22' }, dependencias({ lotesConFaltantes }));
    expect(lotesConFaltantes).toHaveBeenCalledWith('2026-10-22', 40, ['a'], '2026-01-01');
  });

  test('el plan dice qué haría sin consultar a Open-Meteo ni guardar nada', async () => {
    const consultar = vi.fn();
    const guardar = vi.fn();
    const deps = dependencias({
      lotesConFaltantes: async () => [pendiente('a', ['2026-08-01', '2026-08-29']), pendiente('b', ['2026-08-05']), pendiente('c', ['2026-09-01'])],
      consultar, guardar,
    });
    const plan = await planificarClimaHistorico({ tamanoTanda: 2, hoy: '2026-10-22' }, deps);
    expect(consultar).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ disponible: true, diasFaltantes: 4 });
    // 29 días para 2 lotes cuentan como 2 × 29/14 llamadas; un día suelto, como una.
    expect(plan.tandas).toEqual([
      { loteIds: ['a', 'b'], desde: '2026-08-01', hasta: '2026-08-29', llamadasEstimadas: 4.1 },
      { loteIds: ['c'], desde: '2026-09-01', hasta: '2026-09-01', llamadasEstimadas: 1 },
    ]);
    expect(plan.llamadasEstimadas).toBe(5.1);
  });

  test('sin la migración 016 el plan lo dice', async () => {
    expect(await planificarClimaHistorico({}, dependencias({ disponible: async () => false }))).toMatchObject({ disponible: false, lotes: [] });
  });

  test('un error al guardar un lote no frena a los demás', async () => {
    const resumen = await completarClimaHistorico({}, dependencias({
      lotesConFaltantes: async () => [pendiente('a', ['2026-08-01']), pendiente('b', ['2026-08-01'])],
      guardar: async (resultado) => { if (resultado.loteId === 'a') throw new Error('falla'); return 1; },
    }));
    expect(resumen).toMatchObject({ errores: 1, lotesCompletados: 1, diasGuardados: 1, cortado: false });
  });
});
