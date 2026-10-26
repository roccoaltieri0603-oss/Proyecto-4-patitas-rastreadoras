import { beforeEach, describe, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({ query: vi.fn(), estimaciones: [] as unknown[] }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query } }));
vi.mock('../../src/services/estimacion-forraje.js', () => ({ obtenerEstimacionesForraje: async () => mock.estimaciones }));
import type { DiaEstimacion, EstimacionForraje } from '../../src/estimacion/motor.js';
import { sumarDias } from '../../src/fechas.js';
import { LEYENDA_ORDEN, evaluarLote, obtenerOrdenPastoreo, ordenarLotes, type PisoDelLote } from '../../src/services/orden-pastoreo.js';

const hoy = '2026-10-23';
const SECO: PisoDelLote = { pesado: false, motivo: null };
const PESADO: PisoDelLote = { pesado: true, motivo: 'el clima de los últimos días lo marca como piso pesado' };

function dia(fecha: string, cambios: Partial<DiaEstimacion> = {}): DiaEstimacion {
  return {
    fecha, climaUsado: 'observado',
    etapa: 'rebrotando', motivoEtapa: null, etapaEsMinimo: false, progresoRebrote: 0.5,
    biomasaEnPieKgMsHa: null, biomasaRango: null, biomasaOrigen: null, fechaMedicion: null, biomasaConfianza: null, motivoBiomasa: null,
    consumibleKgMsHa: null, motivoConsumible: null,
    ...cambios,
  };
}

/** Diez días desde hoy: la etapa de cada uno sale de `etapas`, y el resto de `cambiosHoy` va sólo a hoy. */
function estimacion(etapas: Array<DiaEstimacion['etapa']>, cambiosHoy: Partial<DiaEstimacion> = {}, extra: Partial<EstimacionForraje> = {}): EstimacionForraje {
  return {
    versionModelo: 'forraje-8', tipoPastura: 'festuca_alta', desde: '2026-08-24', hasta: sumarDias(hoy, etapas.length - 1),
    dias: etapas.map((etapa, i) => dia(sumarDias(hoy, i), { etapa, ...(i === 0 ? cambiosHoy : {}) })),
    reingreso: {
      criterio: null, fechaUltimoPastoreo: '2026-09-01', fechaTemprana: '2026-10-30', fechaTardia: null, gradosDiaAcumulados: null,
      contadoHasta: null, usaPronostico: false, condiciones: [], inicioConteo: 'pastoreo', fechaInicioConteo: '2026-09-02', esMinimo: false, mensaje: null,
      condicionHoy: { fecha: hoy, condicion: 'perfecto', avanceEstadoFoliar: 100, gradosDia: { conBaseMaxima: 0, conBaseMinima: 0 }, climaUsado: 'observado' },
    },
    mediciones: [], avisos: [], mensaje: null, parametrosUsados: null,
    ...extra,
  };
}

const L = (...dias: number[]): Array<DiaEstimacion['etapa']> => Array.from({ length: 10 }, (_, i) => (dias.includes(i) ? 'pasado' : 'listo'));

function orden(...lotes: Array<[number, EstimacionForraje, PisoDelLote?]>) {
  return ordenarLotes(lotes.map(([numero, est, piso]) => evaluarLote(`lote-${numero}`, numero, est, piso ?? SECO, hoy))).map((lote) => [lote.numero, lote.grupo]);
}

describe('orden de los lotes', () => {
  test('primero los listos, del que antes se pasa al que más aguanta', () => {
    expect(orden(
      [1, estimacion(L(6, 7, 8, 9))],
      [2, estimacion(L(2, 3, 4, 5, 6, 7, 8, 9))],
      [3, estimacion(Array(10).fill('rebrotando'))],
    )).toEqual([[2, 'listo'], [1, 'listo'], [3, 'rebrotando']]);
  });

  test('un listo que no se pasa dentro del pronóstico va después de los que sí', () => {
    const resultado = ordenarLotes([
      evaluarLote('a', 1, estimacion(Array(10).fill('listo')), SECO, hoy),
      evaluarLote('b', 2, estimacion(L(5, 6, 7, 8, 9)), SECO, hoy),
    ]);
    expect(resultado.map((lote) => [lote.numero, lote.diasHastaPasado])).toEqual([[2, 5], [1, null]]);
    expect(resultado[1].motivos[0]).toMatch(/Listo, al menos hasta el 01\/11/);
    expect(resultado[0].motivos[0]).toBe('Listo: pasa de su mejor momento en 5 días (28/10).');
  });

  test('con el piso pesado, un listo pasa a "esperar al piso", después de los listos y los pasados', () => {
    expect(orden(
      [1, estimacion(L(1, 2, 3, 4, 5, 6, 7, 8, 9)), PESADO],
      [2, estimacion(L(8, 9))],
      [3, estimacion(Array(10).fill('pasado'))],
      [4, estimacion(Array(10).fill('rebrotando'))],
    )).toEqual([[2, 'listo'], [3, 'pasado'], [1, 'esperar-al-piso'], [4, 'rebrotando']]);
    const esperar = evaluarLote('x', 1, estimacion(L(5)), PESADO, hoy);
    expect(esperar.motivos[0]).toBe('Esperar al piso: el clima de los últimos días lo marca como piso pesado.');
  });

  test('a igualdad de días, más pasto para comer primero; sin dato de pasto, al final', () => {
    expect(orden(
      [1, estimacion(L(4, 5, 6, 7, 8, 9), { consumibleKgMsHa: 600, biomasaEnPieKgMsHa: 1800 })],
      [2, estimacion(L(4, 5, 6, 7, 8, 9))],
      [3, estimacion(L(4, 5, 6, 7, 8, 9), { consumibleKgMsHa: 1200, biomasaEnPieKgMsHa: 2400 })],
    )).toEqual([[3, 'listo'], [1, 'listo'], [2, 'listo']]);
    expect(evaluarLote('x', 3, estimacion(L(4), { consumibleKgMsHa: 1200, biomasaEnPieKgMsHa: 2400 }), SECO, hoy).motivos).toContain('Unos 1.200 kg MS/ha para comer.');
  });

  test('sin pasto para comer, a igualdad de días desempata el pasto en pie medido; el pasto para comer, si lo hay, va antes', () => {
    expect(orden(
      [1, estimacion(L(4, 5, 6, 7, 8, 9), { biomasaEnPieKgMsHa: 1500 })],
      [2, estimacion(L(4, 5, 6, 7, 8, 9))],
      [3, estimacion(L(4, 5, 6, 7, 8, 9), { biomasaEnPieKgMsHa: 2100 })],
      [4, estimacion(L(1, 2, 3, 4, 5, 6, 7, 8, 9), { biomasaEnPieKgMsHa: 900 })],
    )).toEqual([[4, 'listo'], [3, 'listo'], [1, 'listo'], [2, 'listo']]);
    expect(orden(
      [1, estimacion(Array(10).fill('pasado'), { biomasaEnPieKgMsHa: 2500 })],
      [2, estimacion(Array(10).fill('pasado'), { biomasaEnPieKgMsHa: 1800, consumibleKgMsHa: 600 })],
      [3, estimacion(Array(10).fill('pasado'), { biomasaEnPieKgMsHa: 3000 })],
    )).toEqual([[2, 'pasado'], [3, 'pasado'], [1, 'pasado']]);
  });

  test('sin remanente con fuente, muestra el pasto en pie y por qué no hay cuánto se puede comer', () => {
    const lote = evaluarLote('x', 1, estimacion(L(4), { biomasaEnPieKgMsHa: 2016, motivoConsumible: 'Sin altura de remanente objetivo con fuente para Alfalfa con plato: no se calcula cuánto se puede comer.' }), SECO, hoy);
    expect(lote.motivos[1]).toBe('Unos 2.020 kg MS/ha en pie; Sin altura de remanente objetivo con fuente para Alfalfa con plato: no se calcula cuánto se puede comer.');
  });

  test('los que rebrotan, del más avanzado al menos; con animales, después', () => {
    expect(orden(
      [1, estimacion(Array(10).fill('rebrotando'), { progresoRebrote: 0.3 })],
      [2, estimacion(['en-pastoreo', ...Array(9).fill('rebrotando')])],
      [3, estimacion(Array(10).fill('rebrotando'), { progresoRebrote: 0.8 })],
    )).toEqual([[3, 'rebrotando'], [1, 'rebrotando'], [2, 'en-pastoreo']]);
    expect(evaluarLote('x', 3, estimacion(Array(10).fill('rebrotando'), { progresoRebrote: 0.8 }), SECO, hoy).motivos[0]).toBe('Rebrotando: 80 % del estado foliar óptimo; listo el 30/10.');
  });

  test('al final, los lotes sin datos, cada uno con su motivo', () => {
    const sinPastura = estimacion([], {}, { reingreso: null, dias: [], mensaje: 'El lote no tiene tipo de pastura cargado: sin ella no se puede estimar el forraje.' });
    const sinClimaHoy = estimacion([], {}, { dias: [dia('2026-10-20', { etapa: 'listo' })] });
    const alfalfa = estimacion([null], { motivoEtapa: 'Sin criterio de reingreso con fuente para Alfalfa: no se puede decir si está listo.' });
    const resultado = ordenarLotes([
      evaluarLote('a', 1, sinPastura, SECO, hoy),
      evaluarLote('b', 2, sinClimaHoy, SECO, hoy),
      evaluarLote('c', 3, alfalfa, SECO, hoy),
      evaluarLote('d', 4, estimacion(L()), SECO, hoy),
    ]);
    expect(resultado.map((lote) => [lote.numero, lote.grupo, lote.posicion])).toEqual([[4, 'listo', 1], [1, 'sin-datos', 2], [2, 'sin-datos', 3], [3, 'sin-datos', 4]]);
    expect(resultado[1].motivos).toEqual(['El lote no tiene tipo de pastura cargado: sin ella no se puede estimar el forraje.']);
    expect(resultado[2].motivos[0]).toMatch(/No hay clima de hoy guardado/);
    expect(resultado[3].motivos[0]).toMatch(/Sin criterio de reingreso con fuente para Alfalfa/);
  });

  test('dice qué puede cargar el usuario para que el lote entre al orden o tenga su etapa real', () => {
    const falta = (est: EstimacionForraje) => evaluarLote('x', 1, est, SECO, hoy).falta;
    expect(falta(estimacion([], {}, { tipoPastura: null, reingreso: null, dias: [], mensaje: 'El lote no tiene tipo de pastura cargado: sin ella no se puede estimar el forraje.' }))).toBe('pastura');
    expect(falta(estimacion([], {}, { tipoPastura: null, reingreso: null, dias: [], mensaje: 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.' }))).toBeNull();
    expect(falta(estimacion([], {}, { dias: [dia('2026-10-20', { etapa: 'listo' })] }))).toBe('clima');
    const sinTemperatura = estimacion([null], { motivoEtapa: 'Falta la temperatura del 20/10: no se puede seguir contando el descanso.' });
    const criterio = { hojasVivasPorMacollo: 2.5, filocronoGradosDia: [180, 220] as [number, number], vidaMediaFoliarGradosDia: [450, 550] as [number, number], temperaturaBaseC: [2, 4] as [number, number] };
    expect(falta({ ...sinTemperatura, reingreso: { ...sinTemperatura.reingreso!, criterio } })).toBe('clima');
    const sinCriterio = estimacion([null], { motivoEtapa: 'Sin criterio de reingreso con fuente para Alfalfa: no se puede decir si está listo.' });
    expect(falta({ ...sinCriterio, reingreso: { ...sinCriterio.reingreso!, criterio: null } })).toBeNull();
    expect(falta(estimacion(L(), { etapaEsMinimo: true }))).toBe('ultimo-pastoreo');
    expect(falta(estimacion(Array(10).fill('rebrotando'), { etapaEsMinimo: true }))).toBe('ultimo-pastoreo');
    expect(falta(estimacion(L()))).toBeNull();
    expect(falta(estimacion(['en-pastoreo', ...Array(9).fill('rebrotando')]))).toBeNull();
  });

  test('la confianza baja si se cuenta desde el alta o con temperatura pronosticada; si no, es media', () => {
    const base = estimacion(L());
    expect(evaluarLote('a', 1, base, SECO, hoy).confianza).toBe('media');
    expect(evaluarLote('b', 2, { ...base, reingreso: { ...base.reingreso!, esMinimo: true } }, SECO, hoy).confianza).toBe('baja');
    const pronostico = { ...base, reingreso: { ...base.reingreso!, condicionHoy: { ...base.reingreso!.condicionHoy!, climaUsado: 'pronostico' as const } } };
    expect(evaluarLote('c', 3, pronostico, SECO, hoy).confianza).toBe('baja');
    expect(evaluarLote('d', 4, estimacion(L(), { etapaEsMinimo: true }), SECO, hoy).motivos).toContain('Sin pastoreos registrados: está como mínimo así de avanzado.');
  });
});

describe('GET …/lotes/orden-pastoreo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.estimaciones = [
      { loteId: 'a', numero: 1, estimacion: estimacion(L(6)) },
      { loteId: 'b', numero: 2, estimacion: estimacion(L(3)) },
      { loteId: 'c', numero: 3, estimacion: estimacion(L(2)) },
    ];
  });

  function piso(clima: Array<{ lote_id: string; categoria: string; consulted_at: Date }>, optica: Array<{ lote_id: string; observed_at: string; alertas: unknown }>) {
    mock.query.mockImplementation(async (sql: string) => (sql.includes('FROM consultas_clima') ? { rows: clima } : sql.includes('FROM mediciones_satelitales') ? { rows: optica } : { rows: [] }));
  }

  test('marca piso pesado por clima reciente o por agua en la óptica reciente, y nada más', async () => {
    piso(
      [
        { lote_id: 'a', categoria: 'piso-pesado', consulted_at: new Date('2026-10-22T12:00:00Z') },
        { lote_id: 'b', categoria: 'piso-pesado', consulted_at: new Date('2026-10-10T12:00:00Z') },
      ],
      [
        { lote_id: 'b', observed_at: '2026-10-01', alertas: ['Hay sectores con agua libre o suelo anegado.'] },
        { lote_id: 'c', observed_at: '2026-10-20', alertas: ['Hay sectores con agua libre o suelo anegado.'] },
      ],
    );
    const respuesta = await obtenerOrdenPastoreo('est', '2026-08-24', hoy);
    expect(respuesta.leyenda).toBe(LEYENDA_ORDEN);
    expect(respuesta.lotes.map((lote) => [lote.numero, lote.grupo, lote.pisoPesado])).toEqual([[2, 'listo', false], [3, 'esperar-al-piso', true], [1, 'esperar-al-piso', true]]);
    expect(respuesta.lotes[1].motivos[0]).toMatch(/la imagen del 20\/10 muestra agua libre/);
  });

  test('sólo lee, y sólo lotes activos del establecimiento de la URL', async () => {
    piso([], []);
    await obtenerOrdenPastoreo('est', '2026-08-24', hoy);
    for (const [sql, valores] of mock.query.mock.calls) {
      expect(String(sql).trim()).toMatch(/^SELECT/);
      expect(String(sql)).toContain('l.activo = TRUE');
      expect(valores).toEqual(['est']);
    }
  });
});
