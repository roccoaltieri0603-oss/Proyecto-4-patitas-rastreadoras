import { describe, expect, test, vi } from 'vitest';
// La suite inyecta todas las dependencias; importar el pool real la hacía exigir una DB externa.
vi.mock('../../src/base-datos/pool.js', () => ({ pool: {
  query: () => { throw new Error('Una prueba unitaria no debe consultar PostgreSQL.'); },
  connect: () => { throw new Error('Una prueba unitaria no debe conectar a PostgreSQL.'); },
} }));
import {
  actualizarLotesPendientes,
  type DependenciasActualizacion,
} from '../../src/services/actualizacion-programada.js';
import type { LoteSatelital, ResultadoLote } from '../../src/copernicus/types.js';
import type { ResultadoClimaLote } from '../../src/services/open-meteo.js';
import { lote } from '../helpers/fixtures.js';

function lotes(cantidad: number): LoteSatelital[] {
  return Array.from({ length: cantidad }, (_, i) => ({ id: `lote-${i + 1}`, polygon: lote(i, i + 1) }));
}

function ok(id: string): ResultadoLote {
  return {
    estado: 'ok',
    loteId: id,
    condicion: {
      fecha: '2026-09-01', diasDesde: 1, coberturaValida: 0.9,
      ndvi: { media: 0.5, mediana: 0.5, min: 0.4, max: 0.6, desvio: 0.05 },
      ndmi: { media: 0.3, mediana: 0.3, min: 0.2, max: 0.4, desvio: 0.05 },
      ndwi: { media: -0.2, mediana: -0.2, min: -0.3, max: -0.1, desvio: 0.05 },
      evi: { media: 0.4, mediana: 0.4, min: 0.3, max: 0.5, desvio: 0.05 },
      puntaje: 60, categoria: 'buena', alertas: [], tendencia: [],
    },
  };
}

function climaOk(id: string): ResultadoClimaLote {
  return {
    estado: 'ok',
    loteId: id,
    clima: { consultadoEn: Date.now(), dias: [], lluviaUltimos7Dias: 10, lluviaProximosDias: 5, hoy: null },
    categoria: 'normal',
  } as ResultadoClimaLote;
}

/** Dependencias que no tocan red ni base; cada test cambia lo que le importa. */
function dependencias(overrides: Partial<DependenciasActualizacion> = {}): DependenciasActualizacion {
  return {
    lotesPendientesSatelite: async () => [],
    lotesPendientesClima: async () => [],
    analizarSatelite: async (items) => items.map((item) => ok(item.id)),
    persistirSatelite: async () => {},
    consultarClima: async (items) => Object.fromEntries(items.map((item) => [item.id, climaOk(item.id)])),
    persistirClima: async () => ({ consultaId: 'c1', guardado: true }),
    dormir: async () => {},
    registrar: () => {},
    ...overrides,
  };
}

describe('actualización programada', () => {
  test('consulta y persiste los lotes pendientes de satélite y de clima', async () => {
    const resumen = await actualizarLotesPendientes({ tamanoTanda: 2 }, dependencias({
      lotesPendientesSatelite: async () => lotes(3),
      lotesPendientesClima: async () => lotes(2),
    }));

    expect(resumen.satelite).toMatchObject({ pendientes: 3, consultados: 3, persistidos: 3, errores: 0 });
    expect(resumen.clima).toMatchObject({ pendientes: 2, consultados: 2, persistidos: 2, errores: 0 });
  });

  test('sin lotes pendientes no consulta nada: correrlo de más no cuesta', async () => {
    const analizar = vi.fn(async () => []);
    const resumen = await actualizarLotesPendientes({}, dependencias({ analizarSatelite: analizar }));

    expect(analizar).not.toHaveBeenCalled();
    expect(resumen.satelite.consultados).toBe(0);
    expect(resumen.clima.consultados).toBe(0);
  });

  test('un lote sin imágenes despejadas no genera historial falso', async () => {
    const persistir = vi.fn(async () => {});
    const resumen = await actualizarLotesPendientes({}, dependencias({
      lotesPendientesSatelite: async () => lotes(2),
      analizarSatelite: async (items) => items.map((item) => ({ estado: 'sin-datos' as const, loteId: item.id, mensaje: 'sin imágenes' })),
      persistirSatelite: persistir,
    }));

    expect(persistir).not.toHaveBeenCalled();
    expect(resumen.satelite).toMatchObject({ sinDatos: 2, persistidos: 0, errores: 0 });
  });

  test('corta cuando Copernicus rechaza tres tandas seguidas, en vez de gastar la cuota', async () => {
    const analizar = vi.fn(async (items: LoteSatelital[]) =>
      items.map((item) => ({ estado: 'error' as const, loteId: item.id, mensaje: 'HTTP 429' })));

    const resumen = await actualizarLotesPendientes({ tamanoTanda: 1, maxLotes: 20 }, dependencias({
      lotesPendientesSatelite: async () => lotes(10),
      analizarSatelite: analizar,
    }));

    expect(analizar).toHaveBeenCalledTimes(3);
    expect(resumen.satelite.cortado).toBe(true);
    expect(resumen.satelite.errores).toBe(3);
  });

  test('un error suelto no corta la corrida', async () => {
    const resumen = await actualizarLotesPendientes({ tamanoTanda: 2 }, dependencias({
      lotesPendientesSatelite: async () => lotes(6),
      analizarSatelite: async (items) => items.map((item, indice) => (
        indice === 0 ? { estado: 'error' as const, loteId: item.id, mensaje: 'falló' } : ok(item.id)
      )),
    }));

    expect(resumen.satelite.cortado).toBe(false);
    expect(resumen.satelite).toMatchObject({ consultados: 6, errores: 3, persistidos: 3 });
  });

  test('el clima repetido dentro de la hora se cuenta como omitido, no como guardado', async () => {
    const resumen = await actualizarLotesPendientes({}, dependencias({
      lotesPendientesClima: async () => lotes(2),
      persistirClima: async () => ({ consultaId: 'c1', guardado: false, omitido: 'reciente' as const }),
    }));

    expect(resumen.clima).toMatchObject({ persistidos: 0, sinDatos: 2, errores: 0 });
  });

  test('respeta el tamaño de tanda y espera entre una y otra', async () => {
    const dormir = vi.fn(async () => {});
    const analizar = vi.fn(async (items: LoteSatelital[]) => items.map((item) => ok(item.id)));

    await actualizarLotesPendientes({ tamanoTanda: 2, pausaMs: 50 }, dependencias({
      lotesPendientesSatelite: async () => lotes(5),
      analizarSatelite: analizar,
      dormir,
    }));

    expect(analizar).toHaveBeenCalledTimes(3);
    expect(analizar.mock.calls[0][0]).toHaveLength(2);
    expect(analizar.mock.calls[2][0]).toHaveLength(1);
    expect(dormir).toHaveBeenCalledWith(50);
  });

  test('pide los pendientes con la antigüedad y el techo configurados', async () => {
    const pendientesSatelite = vi.fn(async () => []);
    const pendientesClima = vi.fn(async () => []);
    const ahora = new Date('2026-09-05T12:00:00.000Z');

    await actualizarLotesPendientes({ horasSatelite: 48, horasClima: 3, maxLotes: 7, ahora }, dependencias({
      lotesPendientesSatelite: pendientesSatelite,
      lotesPendientesClima: pendientesClima,
    }));

    expect(pendientesSatelite).toHaveBeenCalledWith(48, 7, ahora);
    expect(pendientesClima).toHaveBeenCalledWith(3, 7, ahora);
  });
});
