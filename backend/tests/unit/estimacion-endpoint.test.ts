import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), conPastura: true, conHistorico: true }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query } }));
vi.mock('../../src/base-datos/columnas-pastura.js', () => ({ columnasPasturaDisponibles: async () => mock.conPastura }));
vi.mock('../../src/base-datos/clima-historico-disponible.js', () => ({ climaHistoricoDisponible: async () => mock.conHistorico }));
import { DIAS_POR_DEFECTO, obtenerEstimacion, obtenerEstimaciones } from '../../src/controllers/estimacion.js';
import { obtenerEstimacionForraje, obtenerEstimacionesForraje } from '../../src/services/estimacion-forraje.js';
import { hoyCalendario, sumarDias } from '../../src/fechas.js';

const eid = '00000000-0000-4000-8000-000000000001';
const lid = '00000000-0000-4000-8000-000000000004';
const actor: Membresia = { establecimientoId: eid, userId: 'u', rol: 'VISOR', principal: false, permisos: [], capacidades: [] };

interface Datos {
  loteExiste: boolean;
  tipoPastura: string | null;
  fechaAlta?: string | null;
  observaciones: Array<{ observed_at: string; ndvi_mediana: number | null; cobertura_valida: number | null }>;
  usos: Array<{ fecha: string }>;
  clima: Array<{ consulted_at: Date; fecha: string; es_pronostico: boolean; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }>;
  historico?: Array<{ consulted_at: Date; fecha: string; temp_min: number | null; temp_max: number | null; radiacion_mj_m2: number | null }>;
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
  mock.conHistorico = true;
  datos = { loteExiste: true, tipoPastura: 'festuca_alta', observaciones: [], usos: [], clima: [] };
  mock.query.mockImplementation(consultaIndividual);
});

async function consultaIndividual(sql: string) {
  if (sql.includes('FROM lotes l JOIN establecimientos e')) return { rows: datos.loteExiste ? [{ id: lid }] : [] };
  if (sql.startsWith('SELECT tipo_pastura,')) return { rows: [{ tipo_pastura: datos.tipoPastura, fecha_alta: datos.fechaAlta ?? null }] };
  if (sql.includes('FROM mediciones_satelitales')) return { rows: datos.observaciones };
  if (sql.includes('FROM usos_lote')) return { rows: datos.usos };
  if (sql.includes('FROM dias_clima')) return { rows: datos.clima };
  if (sql.includes('FROM clima_historico_lote')) return { rows: datos.historico ?? [] };
  throw new Error(`Consulta no prevista: ${sql}`);
}

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
    expect(estimacion.versionModelo).toBe('forraje-eur-3');
  });

  test('sin pastoreos, el clima se trae desde el alta del lote si es anterior a la ventana', async () => {
    datos.fechaAlta = '2026-08-01';
    await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM dias_clima'))!;
    expect(consulta[1]).toEqual([lid, '2026-08-01']);
    const historico = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM clima_historico_lote'))!;
    expect(historico[1]).toEqual([lid, '2026-08-01']);
  });

  test('cuenta el descanso desde el alta con el clima histórico, y lo marca como mínimo', async () => {
    datos.fechaAlta = '2026-08-01';
    // Del alta al 30/09 sólo hay histórico; desde el 01/10, consultas regulares.
    datos.historico = Array.from({ length: 61 }, (_, i) => ({ consulted_at: new Date('2026-10-22T12:00:00Z'), fecha: sumarDias('2026-08-01', i), temp_min: 6, temp_max: 18, radiacion_mj_m2: 15 }));
    datos.clima = diasClima('2026-10-01', 38, hoy);
    const { reingreso, avisos } = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(reingreso).toMatchObject({ inicioConteo: 'alta', fechaInicioConteo: '2026-08-01', esMinimo: true, fechaUltimoPastoreo: null });
    // 12 °C de media desde el 01/08: con base 4 °C, 550 °Cd se alcanzan el día 69 (08/10).
    expect(reingreso?.fechaTardia).toBe('2026-10-08');
    expect(reingreso?.condicionHoy?.condicion).toBe('regular');
    expect(reingreso?.gradosDiaAcumulados).toEqual({ conBaseMaxima: 69 * 8, conBaseMinima: 69 * 10 });
    expect(avisos.some((aviso) => aviso.includes('desde el alta del lote'))).toBe(true);
    expect(avisos.some((aviso) => aviso.includes('clima histórico'))).toBe(true);
  });

  test('con una jornada cerrada, el descanso cuenta desde la salida y no desde la entrada', async () => {
    datos.clima = diasClima('2026-09-01', 70, hoy);
    datos.usos = [{ fecha: '2026-09-20', ingreso_at: new Date('2026-09-20T11:00:00Z'), salida_at: new Date('2026-09-25T20:00:00Z') } as never];
    const { reingreso, avisos } = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(reingreso).toMatchObject({ fechaUltimoPastoreo: '2026-09-25', fechaInicioConteo: '2026-09-26', esMinimo: false });
    expect(avisos.some((aviso) => aviso.includes('La salida de los animales no se registra'))).toBe(false);
  });

  test('con la jornada abierta hoy no hay condición: los animales siguen adentro', async () => {
    datos.clima = diasClima('2026-09-01', 70, hoy);
    datos.usos = [{ fecha: '2026-10-20', ingreso_at: new Date('2026-10-20T11:00:00Z'), salida_at: null } as never];
    const { reingreso } = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(reingreso?.fechaUltimoPastoreo).toBe(hoy);
    expect(reingreso?.condicionHoy).toBeNull();
    expect(reingreso?.condiciones[0]?.fecha).toBe('2026-10-23');
  });

  test('sin la migración 016 sigue con las consultas regulares', async () => {
    mock.conHistorico = false;
    datos.fechaAlta = '2026-08-01';
    datos.clima = diasClima('2026-10-01', 38, hoy);
    const { reingreso } = await obtenerEstimacionForraje(lid, '2026-10-10', hoy);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('clima_historico_lote'))).toBe(false);
    expect(reingreso?.mensaje).toMatch(/Falta la temperatura del 01\/08\/2026.*alta del lote/);
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

describe('obtenerEstimacionesForraje: todos los lotes del establecimiento', () => {
  const hoy = '2026-10-22';
  const lidB = '00000000-0000-4000-8000-000000000005';
  const lidSinTipo = '00000000-0000-4000-8000-000000000006';
  type ConLote<T> = T & { lote_id: string };
  let porLote: {
    lotes: Array<{ id: string; numero: number; tipo_pastura: string | null; fecha_alta: string | null }>;
    observaciones: ConLote<Datos['observaciones'][number]>[];
    usos: ConLote<Datos['usos'][number]>[];
    clima: ConLote<Datos['clima'][number]>[];
    historico: ConLote<NonNullable<Datos['historico']>[number]>[];
  };

  beforeEach(() => {
    porLote = {
      lotes: [
        { id: lid, numero: 1, tipo_pastura: 'festuca_alta', fecha_alta: null },
        { id: lidB, numero: 2, tipo_pastura: 'raigras_anual', fecha_alta: null },
        { id: lidSinTipo, numero: 3, tipo_pastura: null, fecha_alta: null },
      ],
      observaciones: [], usos: [], clima: [], historico: [],
    };
    mock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM lotes') && sql.includes('establecimiento_id = $1')) return { rows: porLote.lotes };
      if (sql.includes('FROM mediciones_satelitales')) return { rows: porLote.observaciones };
      if (sql.includes('FROM usos_lote')) return { rows: porLote.usos };
      if (sql.includes('FROM dias_clima')) return { rows: porLote.clima };
      if (sql.includes('FROM clima_historico_lote')) return { rows: porLote.historico };
      throw new Error(`Consulta no prevista: ${sql}`);
    });
  });

  test('lee sólo lotes activos y no eliminados del establecimiento de la URL, en orden de número', async () => {
    const response = res();
    await obtenerEstimaciones(req(), response);
    const [sql, valores] = mock.query.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('activo = TRUE');
    expect(sql).toContain('ORDER BY numero');
    expect(valores).toEqual([eid]);
    const { estimaciones } = vi.mocked(response.json).mock.calls[0][0];
    expect(estimaciones.map((item: { numero: number }) => item.numero)).toEqual([1, 2, 3]);
  });

  test('una consulta por tabla aunque haya varios lotes, y sólo lecturas', async () => {
    await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);
    expect(mock.query).toHaveBeenCalledTimes(5);
    for (const [sql] of mock.query.mock.calls) expect(String(sql).trim()).toMatch(/^SELECT/);
    const satelite = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM mediciones_satelitales'))!;
    expect(String(satelite[0])).toContain("fuente = 'sentinel-2'");
    expect(satelite[1]).toEqual([[lid, lidB], '2026-09-10', hoy]);
  });

  test('el lote sin tipo de pastura no se consulta y explica por qué', async () => {
    const estimaciones = await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);
    expect(estimaciones[2]).toMatchObject({ loteId: lidSinTipo, estimacion: { dias: [], reingreso: null } });
    expect(estimaciones[2].estimacion.mensaje).toMatch(/no tiene tipo de pastura/);
  });

  test('cada lote trae el clima desde su propio último pastoreo si es más viejo', async () => {
    porLote.usos = [{ lote_id: lid, fecha: '2026-07-01' }];
    await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);
    const consulta = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM dias_clima'))!;
    expect(consulta[1]).toEqual([[lid, lidB], ['2026-07-01', '2026-09-10']]);
  });

  test('sin pastoreos, cada lote trae clima e histórico desde su alta si es anterior', async () => {
    porLote.lotes[1].fecha_alta = '2026-08-15';
    porLote.usos = [{ lote_id: lid, fecha: '2026-07-01' }];
    await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);
    const clima = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM dias_clima'))!;
    const historico = mock.query.mock.calls.find(([sql]) => String(sql).includes('FROM clima_historico_lote'))!;
    expect(clima[1]).toEqual([[lid, lidB], ['2026-07-01', '2026-08-15']]);
    expect(historico[1]).toEqual(clima[1]);
  });

  test('no mezcla datos entre lotes y coincide con la estimación individual', async () => {
    porLote.observaciones = [{ lote_id: lid, observed_at: '2026-10-12', ndvi_mediana: 0.8, cobertura_valida: 0.9 }];
    porLote.usos = [{ lote_id: lid, fecha: '2026-09-20' }];
    porLote.clima = [...diasClima('2026-10-10', 29, hoy).map((fila) => ({ ...fila, lote_id: lid }))];
    const [a, b] = await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);

    // B no recibe el clima ni el pastoreo de A.
    expect(b.estimacion.mensaje).toMatch(/No hay clima guardado/);
    expect(b.estimacion.dias).toEqual([]);

    datos = {
      loteExiste: true, tipoPastura: 'festuca_alta',
      observaciones: porLote.observaciones.map(({ lote_id: _, ...fila }) => fila),
      usos: porLote.usos.map(({ lote_id: _, ...fila }) => fila),
      clima: porLote.clima.map(({ lote_id: _, ...fila }) => fila),
    };
    mock.query.mockImplementation(consultaIndividual);
    expect(a.estimacion).toEqual(await obtenerEstimacionForraje(lid, '2026-10-10', hoy));
  });

  test('sin la migración 015 responde cada lote con el motivo', async () => {
    mock.conPastura = false;
    const estimaciones = await obtenerEstimacionesForraje(eid, '2026-10-10', hoy);
    expect(estimaciones).toHaveLength(3);
    expect(estimaciones.every((item) => /migración 015/.test(item.estimacion.mensaje ?? ''))).toBe(true);
    expect(String(mock.query.mock.calls[0][0])).toContain('NULL::text AS tipo_pastura');
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  test('valida desde igual que el endpoint individual', async () => {
    await expect(obtenerEstimaciones(req({ desde: 'ayer' }), res())).rejects.toMatchObject({ status: 400, code: 'INVALID_DATE' });
  });
});
