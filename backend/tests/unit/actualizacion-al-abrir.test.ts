import { beforeEach, describe, expect, test, vi } from 'vitest';
const mockPoolQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: {
  query: mockPoolQuery,
  connect: () => { throw new Error('Una prueba unitaria no debe conectar a PostgreSQL.'); },
} }));
import { actualizarAlAbrir, reiniciarEstadoAlAbrir, MINUTOS_ENFRIAMIENTO } from '../../src/services/actualizacion-al-abrir.js';
import { actualizarLotesPendientes, lotesPendientes, type DependenciasActualizacion } from '../../src/services/actualizacion-programada.js';

function dependencias(parciales: Partial<DependenciasActualizacion> = {}): DependenciasActualizacion {
  return {
    lotesPendientesSatelite: async () => [],
    lotesPendientesClima: async () => [],
    analizarSatelite: async () => [],
    persistirSatelite: (async () => ({})) as any,
    consultarClima: async () => ({}),
    persistirClima: (async () => ({ consultaId: 'c1', guardado: true })) as any,
    dormir: async () => {},
    registrar: () => {},
    ...parciales,
  };
}

beforeEach(() => {
  reiniciarEstadoAlAbrir();
  mockPoolQuery.mockClear();
});

describe('actualizarAlAbrir', () => {
  test('no consulta el satélite: es lento y lo cubre la rutina diaria', async () => {
    const pendientesSatelite = vi.fn(async () => []);
    await actualizarAlAbrir('est-1', dependencias({ lotesPendientesSatelite: pendientesSatelite }));
    expect(pendientesSatelite).toHaveBeenCalledWith(expect.any(Number), 0, expect.any(Date), 'est-1');
  });

  test('acota la corrida al establecimiento que se abrió', async () => {
    const pendientesClima = vi.fn(async () => []);
    await actualizarAlAbrir('est-1', dependencias({ lotesPendientesClima: pendientesClima }));
    expect(pendientesClima).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Date), 'est-1');
  });

  test('recargar la página enseguida no vuelve a consultar', async () => {
    const deps = dependencias();
    const primera = await actualizarAlAbrir('est-1', deps);
    const segunda = await actualizarAlAbrir('est-1', deps);
    expect(primera.ejecutado).toBe(true);
    expect(segunda).toEqual({ ejecutado: false, motivo: 'reciente' });
  });

  test('pasado el enfriamiento vuelve a consultar', async () => {
    const deps = dependencias();
    const inicio = new Date('2026-10-27T09:00:00Z');
    await actualizarAlAbrir('est-1', deps, inicio);
    const despues = new Date(inicio.getTime() + (MINUTOS_ENFRIAMIENTO + 1) * 60_000);
    expect((await actualizarAlAbrir('est-1', deps, despues)).ejecutado).toBe(true);
  });

  test('el enfriamiento de un campo no frena al de otro', async () => {
    const deps = dependencias();
    await actualizarAlAbrir('est-1', deps);
    expect((await actualizarAlAbrir('est-2', deps)).ejecutado).toBe(true);
  });

  test('dos personas entrando juntas comparten una sola corrida', async () => {
    let consultas = 0;
    const deps = dependencias({
      lotesPendientesClima: async () => { consultas += 1; await new Promise((listo) => setTimeout(listo, 10)); return []; },
    });
    await Promise.all([actualizarAlAbrir('est-1', deps), actualizarAlAbrir('est-1', deps)]);
    expect(consultas).toBe(1);
  });

  test('un fallo no deja el campo en enfriamiento sin haber consultado', async () => {
    const deps = dependencias({ lotesPendientesSatelite: async () => { throw new Error('Copernicus caído'); } });
    await expect(actualizarAlAbrir('est-1', deps)).rejects.toThrow('Copernicus caído');
    // La próxima visita tiene que poder reintentar, no quedar bloqueada 15 minutos.
    expect((await actualizarAlAbrir('est-1', dependencias())).ejecutado).toBe(true);
  });
});

describe('límite de tiempo', () => {
  test('corta entre tandas en vez de colgar el request', async () => {
    // Con muchos lotes en tandas de 5 y consultas lentas, sin límite la corrida
    // se pasaba de los 90 s en que el servidor corta el request: el navegador no
    // recibía nada y la pantalla se quedaba sin actualizar.
    const lotes = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, polygon: {} as any, establecimientoId: 'est-1' }));
    let tandas = 0;
    const deps = dependencias({
      lotesPendientesClima: async () => lotes,
      consultarClima: async () => { tandas += 1; await new Promise((listo) => setTimeout(listo, 20)); return {}; },
    });
    const resumen = await actualizarLotesPendientes({ establecimientoId: 'est-1', limiteMs: 50, pausaMs: 0 }, deps);
    expect(resumen.clima.cortado).toBe(true);
    expect(tandas).toBeLessThan(8); // las 8 tandas completas no llegaron a correr
  });

  test('sin límite recorre todas las tandas, como la rutina diaria', async () => {
    const lotes = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, polygon: {} as any, establecimientoId: 'est-1' }));
    let tandas = 0;
    const deps = dependencias({
      lotesPendientesClima: async () => lotes,
      consultarClima: async () => { tandas += 1; return {}; },
    });
    const resumen = await actualizarLotesPendientes({ pausaMs: 0 }, deps);
    expect(resumen.clima.cortado).toBe(false);
    expect(tandas).toBe(4);
  });
});

describe('lotesPendientes', () => {
  test('filtra por establecimiento cuando se lo piden', async () => {
    await lotesPendientes('consultas_clima', 6, 10, new Date(), 'est-1');
    const [sql, params] = mockPoolQuery.mock.calls.at(-1) as unknown as [string, unknown[]];
    expect(sql).toContain('l.establecimiento_id = $6');
    expect(params).toContain('est-1');
  });

  test('sin establecimiento recorre todos, como la rutina diaria', async () => {
    await lotesPendientes('consultas_clima', 6, 10, new Date());
    const [sql, params] = mockPoolQuery.mock.calls.at(-1) as unknown as [string, unknown[]];
    expect(sql).not.toContain('l.establecimiento_id = $6');
    expect(params).toHaveLength(5);
  });
});
