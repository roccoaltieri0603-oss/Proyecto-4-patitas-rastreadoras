import { describe, expect, test } from 'vitest';
import {
  AnalizadorSatelital,
  COBERTURA_MINIMA,
  CONCURRENCIA,
  DIAS_VENTANA,
  DIAS_VENTANA_RADAR,
  FECHAS_TENDENCIA,
  RESOLUCION_GRADOS,
  aObservacion,
  cuerpoPeticion,
  cuerpoPeticionRadar,
  medianocheUTC,
  type GatewayEstadisticas,
} from '../../src/copernicus/analizar.js';
import { calcularPuntaje, categorizar, generarAlertas } from '../../src/copernicus/scoring.js';
import type { IntervaloEstadisticas, StatsCrudas } from '../../src/copernicus/types.js';
import { lote } from '../helpers/fixtures.js';

const LOTE = { id: '11111111-1111-4111-8111-111111111111', polygon: lote(1, 2) };
const AHORA = new Date('2026-08-20T10:00:00.000Z');

function stats(media: number | string, opciones: Partial<StatsCrudas> = {}): StatsCrudas {
  return { min: -0.2, max: 0.8, mean: media, stDev: 0.1, sampleCount: 100, noDataCount: 10, percentiles: { '50.0': typeof media === 'number' ? media + 0.01 : media }, ...opciones };
}

function intervaloOptico(fecha: string, valores: { ndvi?: StatsCrudas; ndmi?: StatsCrudas; ndwi?: StatsCrudas; evi?: StatsCrudas } = {}): IntervaloEstadisticas {
  const salida = (valor: StatsCrudas) => ({ bands: { B0: { stats: valor } } });
  return {
    interval: { from: `${fecha}T00:00:00Z`, to: `${fecha}T23:59:59Z` },
    outputs: {
      ndvi: salida(valores.ndvi ?? stats(0.49)),
      ndmi: salida(valores.ndmi ?? stats(0.125)),
      ndwi: salida(valores.ndwi ?? stats(-0.1)),
      evi: salida(valores.evi ?? stats(0.325)),
    },
  };
}

function intervaloRadar(fecha: string): IntervaloEstadisticas {
  return { interval: { from: `${fecha}T00:00:00Z`, to: `${fecha}T23:59:59Z` }, outputs: { rvi: { bands: { B0: { stats: stats(0.6) } } } } };
}

function respuesta(data: IntervaloEstadisticas[], status = 200) {
  return { status, texto: JSON.stringify({ data }) };
}

function gateway(optico: ReturnType<typeof respuesta>, radar = respuesta([])): GatewayEstadisticas {
  return {
    obtenerEstadisticas: async (cuerpo) => JSON.parse(cuerpo).input.data[0].type === 'sentinel-2-l2a' ? optico : radar,
  };
}

describe('algoritmo satelital centralizado', () => {
  test('conserva medianoche UTC, ventanas, datasets, resolución, P1D, leastCC y p50', () => {
    expect(medianocheUTC(new Date('2026-08-20T23:59:59-03:00')).toISOString()).toBe('2026-08-21T00:00:00.000Z');
    const optico = JSON.parse(cuerpoPeticion(LOTE, new Date('2026-07-06T00:00:00Z'), new Date('2026-08-21T00:00:00Z')));
    const radar = JSON.parse(cuerpoPeticionRadar(LOTE, new Date('2026-07-31T00:00:00Z'), new Date('2026-08-21T00:00:00Z')));
    expect({ DIAS_VENTANA, DIAS_VENTANA_RADAR, RESOLUCION_GRADOS, COBERTURA_MINIMA, FECHAS_TENDENCIA, CONCURRENCIA }).toEqual({ DIAS_VENTANA: 45, DIAS_VENTANA_RADAR: 20, RESOLUCION_GRADOS: 0.0002, COBERTURA_MINIMA: 0.35, FECHAS_TENDENCIA: 6, CONCURRENCIA: 2 });
    expect(optico.input.data).toEqual([{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }]);
    expect(radar.input.data).toEqual([{ type: 'sentinel-1-grd' }]);
    expect(optico.aggregation).toMatchObject({ aggregationInterval: { of: 'P1D' }, resx: 0.0002, resy: 0.0002 });
    expect(optico.calculations.default.statistics.default.percentiles.k).toEqual([50]);
    expect(optico.input.bounds.geometry).toEqual(LOTE.polygon.geometry);
  });

  test('extrae estadísticas ópticas y usa el percentil 50 como mediana', () => {
    const observacion = aObservacion(intervaloOptico('2026-08-19'));
    expect(observacion).toMatchObject({ fecha: '2026-08-19', coberturaValida: 0.9 });
    expect(observacion?.ndvi).toEqual({ media: 0.49, mediana: 0.5, min: -0.2, max: 0.8, desvio: 0.1 });
  });

  test('descarta cobertura menor a 35% y cualquier índice NaN', () => {
    expect(aObservacion(intervaloOptico('2026-08-19', { ndvi: stats(0.5, { noDataCount: 66 }) }))).toBeNull();
    expect(aObservacion(intervaloOptico('2026-08-19', { evi: stats('NaN') }))).toBeNull();
  });

  test('elige la fecha válida más reciente y limita la tendencia a seis fechas', async () => {
    const fechas = Array.from({ length: 8 }, (_, index) => `2026-08-${String(10 + index).padStart(2, '0')}`);
    const analizador = new AnalizadorSatelital(gateway(respuesta(fechas.map((fecha, index) => intervaloOptico(fecha, { ndvi: stats(0.3 + index / 100) })))))
    const resultado = await analizador.consultarLote(LOTE, AHORA);
    expect(resultado.estado).toBe('ok');
    if (resultado.estado !== 'ok') return;
    expect(resultado.condicion.fecha).toBe('2026-08-17');
    expect(resultado.condicion.tendencia).toHaveLength(6);
    expect(resultado.condicion.tendencia.map((item) => item.fecha)).toEqual(fechas.slice(-6));
  });

  test('mantiene el score, categoría y alertas provisionales actuales', () => {
    const ndvi = { media: 0.49, mediana: 0.5, min: 0.1, max: 0.9, desvio: 0.16 };
    const ndmi = { media: -0.01, mediana: 0, min: -0.2, max: 0.2, desvio: 0.1 };
    const ndwi = { media: 0, mediana: 0, min: -0.2, max: 0.2, desvio: 0.1 };
    const evi = { media: 0.325, mediana: 0.33, min: 0, max: 0.7, desvio: 0.1 };
    const puntaje = calcularPuntaje(ndvi, ndmi, ndwi, evi);
    expect(puntaje).toBe(36);
    expect(categorizar(puntaje)).toBe('regular');
    expect(generarAlertas({ diasDesde: 13, coberturaValida: 0.5, ndvi, ndmi, ndwi })).toEqual([
      'La última imagen despejada es de hace 13 días: puede haber cambiado la condición.',
      'Sólo se vio despejado el 50% del lote; el promedio es parcial.',
      'Hay sectores con agua libre o suelo anegado.',
      'Estrés hídrico: la vegetación está seca.',
      'Tapiz desparejo: conviven manchones verdes y pelados.',
    ]);
  });

  test('devuelve RVI por radar cuando la óptica no tiene datos', async () => {
    const resultado = await new AnalizadorSatelital(gateway(respuesta([]), respuesta([intervaloRadar('2026-08-19')]))).consultarLote(LOTE, AHORA);
    expect(resultado.estado).toBe('radar');
    if (resultado.estado === 'radar') expect(resultado.condicion.rvi.mediana).toBeCloseTo(0.61);
  });

  test('el radar sólo reemplaza una óptica cuando es más reciente', async () => {
    const masViejo = await new AnalizadorSatelital(gateway(respuesta([intervaloOptico('2026-08-17')]), respuesta([intervaloRadar('2026-08-19')]))).consultarLote(LOTE, AHORA);
    expect(masViejo.estado).toBe('radar');
    if (masViejo.estado === 'radar') expect(masViejo.optico?.fecha).toBe('2026-08-17');
    const mismaFecha = await new AnalizadorSatelital(gateway(respuesta([intervaloOptico('2026-08-19')]), respuesta([intervaloRadar('2026-08-19')]))).consultarLote(LOTE, AHORA);
    expect(mismaFecha.estado).toBe('ok');
  });

  test('mantiene el mensaje específico de 429 y no lo reemplaza por radar ausente', async () => {
    const resultado = await new AnalizadorSatelital(gateway({ status: 429, texto: '{}' })).consultarLote(LOTE, AHORA);
    expect(resultado).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('(429)') });
  });

  test('maneja JSON inválido y errores del gateway sin inventar datos', async () => {
    const invalido = await new AnalizadorSatelital(gateway({ status: 200, texto: 'no-json' })).consultarLote(LOTE, AHORA);
    expect(invalido).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('no se pudo interpretar') });
    const falla = await new AnalizadorSatelital({ obtenerEstadisticas: async () => { throw new Error('upstream caído'); } }).consultarLote(LOTE, AHORA);
    expect(falla).toEqual({ estado: 'error', loteId: LOTE.id, mensaje: 'upstream caído' });
  });
});
