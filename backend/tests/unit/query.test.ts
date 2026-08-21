import { describe, expect, test } from 'vitest';
import { leerBooleano, leerPaginacion, leerRangoCalendario } from '../../src/http/query.js';

describe('query params de historial', () => {
  test('usa defaults y acepta rango válido', () => {
    expect(leerPaginacion({})).toEqual({ limit: 50, offset: 0 });
    expect(leerPaginacion({ limit: '2', offset: '4' })).toEqual({ limit: 2, offset: 4 });
    expect(leerRangoCalendario({ desde: '2026-08-01', hasta: '2026-08-20' })).toEqual({ desde: '2026-08-01', hasta: '2026-08-20' });
  });

  test('rechaza valores fuera de contrato', () => {
    expect(() => leerPaginacion({ limit: '0' })).toThrow();
    expect(() => leerPaginacion({ limit: '101' })).toThrow();
    expect(() => leerPaginacion({ limit: 'abc' })).toThrow();
    expect(() => leerPaginacion({ offset: '-1' })).toThrow();
    expect(() => leerRangoCalendario({ desde: '2026-08-21', hasta: '2026-08-20' })).toThrow();
  });

  test('permite default específico y booleanos estrictos', () => {
    expect(leerPaginacion({}, 20)).toEqual({ limit: 20, offset: 0 });
    expect(leerBooleano({ soloNoLeidas: 'true' }, 'soloNoLeidas')).toBe(true);
    expect(leerBooleano({ soloNoLeidas: 'false' }, 'soloNoLeidas')).toBe(false);
    expect(leerBooleano({}, 'soloNoLeidas')).toBeUndefined();
    expect(() => leerBooleano({ soloNoLeidas: '1' }, 'soloNoLeidas')).toThrow();
  });
});
