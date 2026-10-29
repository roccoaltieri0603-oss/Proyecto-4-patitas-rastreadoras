import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), analizarLotes: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../../src/copernicus/analizar.js', () => ({ DIAS_VENTANA: 45, FECHAS_TENDENCIA: 6, analizadorSatelital: { analizarLotes: mocks.analizarLotes } }));

import { simularPastoreo } from '../../src/controllers/simulacion.js';
import { lote } from '../helpers/fixtures.js';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  establecimientoId: 'establecimiento', userId: 'usuario', rol: 'VISOR', principal: false,
  permisos: [], capacidades: [],
};

function request(conPermiso: boolean) {
  return {
    params: { id }, usuario: { id: 'usuario' },
    membresia: { ...base, ...(conPermiso ? { rol: 'ADMINISTRADOR', permisos: ['actualizar_satelite'] } : {}) },
  } as never;
}

function response() { return { json: vi.fn() }; }

describe('permiso Copernicus en la simulación de pastoreo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => sql.includes('SELECT l.id')
      ? { rows: [{ id, polygon: lote(0, 0.002) }] }
      : { rows: [] });
    mocks.analizarLotes.mockResolvedValue([]);
  });

  test('mantiene el preview sin consultar Copernicus cuando falta el permiso satelital', async () => {
    const res = response();
    await simularPastoreo(request(false), res as never);
    expect(mocks.analizarLotes).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ simulacion: expect.objectContaining({ origen: 'persistido', puntosReales: 0 }) }));
  });

  test('permite el fallback Copernicus a quien tiene actualizar_satelite', async () => {
    await simularPastoreo(request(true), response() as never);
    expect(mocks.analizarLotes).toHaveBeenCalledOnce();
  });
});
