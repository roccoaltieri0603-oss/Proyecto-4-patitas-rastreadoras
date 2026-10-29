import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), analizarLotes: vi.fn(), persistir: vi.fn(),
}));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../../src/copernicus/analizar.js', () => ({ analizadorSatelital: { analizarLotes: mocks.analizarLotes } }));
vi.mock('../../src/services/mediciones-satelitales.js', () => ({ persistirResultadoSatelital: mocks.persistir }));
vi.mock('../../src/http/logger.js', () => ({ registrarError: vi.fn() }));

import { actualizarSateliteLotes } from '../../src/controllers/satelite.js';
import { actualizarSateliteLote } from '../../src/controllers/satelite.js';
import { lote } from '../helpers/fixtures.js';

const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const polygon = lote(0, 0.002);
const resultado = (loteId: string) => ({ estado: 'ok' as const, loteId, condicion: {} as never });

function request() {
  return {
    body: { loteIds: [id1, id2] }, params: {},
    usuario: { id: 'usuario' },
    membresia: { establecimientoId: 'establecimiento', userId: 'usuario', rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] },
  } as never;
}

function response() { return { json: vi.fn() }; }

describe('actualizar satélite por lote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ id: id1, polygon }, { id: id2, polygon }] });
    mocks.analizarLotes.mockResolvedValue([resultado(id1), resultado(id2)]);
    mocks.persistir.mockResolvedValue(undefined);
  });

  test('expone pendientes y causa cuando Copernicus corta la tanda luego de conservar un resultado útil', async () => {
    mocks.analizarLotes.mockResolvedValue([{ ...resultado(id1), limiteCopernicus: true }]);
    const res = response();
    await actualizarSateliteLotes(request(), res as never);
    expect(mocks.persistir).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'parcial', pendientes: [id2],
      motivoCorte: expect.stringContaining('Copernicus limitó'),
      resultados: [expect.objectContaining({ loteId: id1, estado: 'ok' })],
    }));
  });

  test('un fallo al persistir un resultado no evita guardar los siguientes', async () => {
    mocks.persistir.mockRejectedValueOnce(new Error('DB temporalmente no disponible'));
    const res = response();
    await actualizarSateliteLotes(request(), res as never);
    expect(mocks.persistir).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'parcial',
      erroresPersistencia: [{ loteId: id1, mensaje: 'No se pudo guardar el resultado satelital.' }],
      resultados: [expect.objectContaining({ loteId: id1, estado: 'ok' }), expect.objectContaining({ loteId: id2, estado: 'ok' })],
    }));
  });

  test('el endpoint individual informa fallo de persistencia sin exponer el detalle interno', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: id1, polygon }] });
    mocks.analizarLotes.mockResolvedValue([resultado(id1)]);
    mocks.persistir.mockRejectedValueOnce(new Error('detalle SQL interno'));
    const req = {
      body: {}, params: { id: id1 }, usuario: { id: 'usuario' },
      membresia: { establecimientoId: 'establecimiento', userId: 'usuario', rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] },
    } as never;
    const res = response();
    await actualizarSateliteLote(req, res as never);
    expect(res.json).toHaveBeenCalledWith({
      resultado: expect.objectContaining({ loteId: id1, estado: 'ok' }),
      erroresPersistencia: [{ loteId: id1, mensaje: 'No se pudo guardar el resultado satelital.' }],
      corteCopernicus: false,
    });
  });

  test('informa el corte individual por 429 aunque conserve la observación óptica', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: id1, polygon }] });
    mocks.analizarLotes.mockResolvedValue([{ ...resultado(id1), limiteCopernicus: true }]);
    const req = {
      body: {}, params: { id: id1 }, usuario: { id: 'usuario' },
      membresia: { establecimientoId: 'establecimiento', userId: 'usuario', rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] },
    } as never;
    const res = response();
    await actualizarSateliteLote(req, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      resultado: expect.objectContaining({ estado: 'ok', limiteCopernicus: true }),
      corteCopernicus: true,
    }));
  });
});
