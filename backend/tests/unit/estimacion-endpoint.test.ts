import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), conPastura: true }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query } }));
vi.mock('../../src/base-datos/columnas-pastura.js', () => ({ columnasPasturaDisponibles: async () => mock.conPastura }));
import { DIAS_POR_DEFECTO, obtenerEstimacion } from '../../src/controllers/estimacion.js';
import { obtenerEstimacionForraje } from '../../src/services/estimacion-forraje.js';
import { hoyCalendario, sumarDias } from '../../src/fechas.js';

const eid = '00000000-0000-4000-8000-000000000001';
const lid = '00000000-0000-4000-8000-000000000004';
const actor: Membresia = { establecimientoId: eid, userId: 'u', rol: 'VISOR', principal: false, permisos: [], capacidades: [] };

interface Datos {
  loteExiste: boolean;
  tipoPastura: string | null;
  observaciones: Array<{ observed_at: string; ndvi_mediana: number | null; cobertura_valida: number | null }>;
  usos: Array<{ fecha: string }>;
  clima: Array<{ consulted_at: Date; fecha: string; es_pronostico: boolean; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }>;
}
let datos: Datos;

function diasClima(desde: string, cantidad: number, pronosticoDesde: string) {
  return Array.from({ length: cantidad }, (_, i) => {
    const fecha = sumarDias(desde, i);
    return { consulted_at: new Date('2026-10-22T12:00:00Z'), fecha, es_pronostico: fecha >= pronosticoDesde, temp_min: 8, temp_max: 16, radiacion_mj_m2: 20 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.conPastura = true;
  datos = { loteExiste: true, tipoPastura: 'festuca_alta', observaciones: [], usos: [], clima: [] };
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM lotes l JOIN establecimientos e')) return { rows: datos.loteExiste ? [{ id: lid }] : [] };
    if (sql.startsWith('SELECT tipo_pastura FROM lotes')) return { rows: [{ tipo_pastura: datos.tipoPastura }] };
    if (sql.includes('FROM mediciones_satelitales')) return { rows: datos.observaciones };
    if (sql.includes('FROM usos_lote')) return { rows: datos.usos };
    if (sql.includes('FROM dias_clima')) return { rows: datos.clima };
    throw new Error(`Consulta no prevista: ${sql}`);
  });
});

function req(query: Record<string, unknown> = {}): Request {
  return { params: { id: lid }, query, usuario: { id: 'u' }, membresia: actor } as unknown as Request;
}
function res(): Response {
  return { json: vi.fn() } as unknown as Response;
}

describe('GET .../lotes/:id/estimacion', () => {
  test('por defecto estima desde 60 días atrás', async () => {
    const response = res();
    await obtenerEstimacion(req(), response);
    const { estimacion } = vi.mocked(response.json).mock.calls[0][0];
    expect(estimacion.desde).toBe(sumarDias(hoyCalendario(), -DIAS_POR_DEFECTO));
  });

  test.each([
    ['2026/10/01'],
    ['2026-02-30'],
    [sumarDias(hoyCalendario(), 1)],
    [sumarDias(hoyCalendario(), -366)],
    [['2026-10-01', '2026-10-02']],
  ])('rechaza desde=%j', async (desde) => {
    await expect(obtenerEstimacion(req({ desde }), res())).rejects.toMatchObject({ status: 400, code: 'INVALID_DATE' });
  });

  test('un lote de otro establecimiento o eliminado responde 404', async () => {
    datos.loteExiste = false;
    await expect(obtenerEstimacion(req(), res())).rejects.toMatchObject({ status: 404, code: 'LOT_NOT_FOUND' });
    const [sql, valores] = mock.query.mock.calls[0];
    expect(sql).toContain('l.deleted_at IS NULL');
    expect(valores).toEqual([lid, eid]);
  });

  test('sólo lee: ninguna consulta escribe en la base', async () => {
    datos.observaciones = [{ observed_at: sumarDias(hoyCalendario(), -3), ndvi_mediana: 0.8, cobertura_valida: 0.9 }];
    datos.clima = diasClima(sumarDias(hoyCalendario(), -5), 10, hoyCalendario());
    await obtenerEstimacion(req({ desde: sumarDias(hoyCalendario(), -5) }), res());
    for (const [sql] of mock.query.mock.calls) expect(String(sql).trim()).toMatch(/^SELECT/);
  });
});

describe('obtenerEstimacionForraje', () => {
  const hoy = '2026-10-22';

  test('pide sólo Sentinel-2: el radar no entra en la estimación', async () => {
    await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM mediciones_satelitales'))!;
    expect(String(consulta[0])).toContain("fuente = 'sentinel-2'");
  });

  test('trae imágenes desde 30 días antes de "desde" para decidir los primeros días', async () => {
    await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM mediciones_satelitales'))!;
    expect(consulta[1]).toEqual([lid, '2026-09-10', hoy]);
  });

  test('si el último pastoreo es más viejo, el clima se trae desde él para contar grados-día', async () => {
    datos.usos = [{ fecha: '2026-07-01' }];
    await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM dias_clima'))!;
    expect(consulta[1]).toEqual([lid, '2026-07-01']);
  });

  test('arma la estimación con lo persistido', async () => {
    datos.observaciones = [{ observed_at: '2026-10-12', ndvi_mediana: 0.8, cobertura_valida: 0.9 }];
    datos.clima = diasClima('2026-10-10', 29, hoy);
    datos.usos = [{ fecha: '2026-09-20' }];
    const estimacion = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(estimacion.hasta).toBe('2026-11-07');
    expect(estimacion.dias[0]).toMatchObject({ fecha: '2026-10-10', origen: 'sin-dato' });
    expect(estimacion.dias[2]).toMatchObject({ fecha: '2026-10-12', origen: 'observado', ndviUsado: 0.8, climaUsado: 'observado' });
    expect(estimacion.dias.at(-1)).toMatchObject({ origen: 'proyectado', climaUsado: 'pronostico' });
    expect(estimacion.reingreso?.fechaUltimoPastoreo).toBe('2026-09-20');
    expect(estimacion.versionModelo).toBe('forraje-eur-1');
  });

  test('sin tipo de pastura no consulta imágenes ni clima', async () => {
    datos.tipoPastura = null;
    const estimacion = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(estimacion.mensaje).toMatch(/no tiene tipo de pastura/);
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  test('sin la migración 015 lo explica en vez de fallar', async () => {
    mock.conPastura = false;
    const estimacion = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(estimacion.dias).toEqual([]);
    expect(estimacion.mensaje).toMatch(/migración 015/);
    expect(mock.query).not.toHaveBeenCalled();
  });
});
