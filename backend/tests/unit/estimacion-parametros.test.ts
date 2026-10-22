import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), columnasEnBase: 2 }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: mock.connect } }));
import { columnasPasturaDisponibles, reiniciarDeteccionPastura } from '../../src/base-datos/columnas-pastura.js';
import { actualizarLote, obtenerLotes } from '../../src/controllers/lotes.js';
import {
  FRACCION_RFA,
  FRFA_DESDE_NDVI,
  PARAMETROS_PASTURA,
  TIPOS_PASTURA,
  esTipoPastura,
  estacionDelMes,
} from '../../src/estimacion/parametros.js';
import { hoyCalendario } from '../../src/fechas.js';

describe('parámetros de la estimación de forraje', () => {
  test('la lista de pasturas coincide con el CHECK de la migración 015', async () => {
    const sql = await readFile(new URL('../../migrations/015_lotes_tipo_pastura.sql', import.meta.url), 'utf8');
    const lista = sql.slice(sql.indexOf('tipo_pastura IN ('));
    const enMigracion = [...lista.slice(0, lista.indexOf(')')).matchAll(/'([a-z_]+)'/g)].map(([, valor]) => valor);
    expect(enMigracion).toEqual([...TIPOS_PASTURA]);
  });

  test('la lista de pasturas coincide con la del frontend', async () => {
    const tipos = await readFile(new URL('../../../src/types.ts', import.meta.url), 'utf8');
    const bloque = tipos.slice(tipos.indexOf('export const NOMBRES_PASTURA'), tipos.indexOf('} as const;'));
    const enFrontend = [...bloque.matchAll(/^\s+([a-z_]+):/gm)].map(([, clave]) => clave);
    expect(enFrontend).toEqual([...TIPOS_PASTURA]);
  });

  test('la migración 015 es aditiva e idempotente', async () => {
    const sql = await readFile(new URL('../../migrations/015_lotes_tipo_pastura.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS tipo_pastura TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS fecha_siembra DATE');
    expect(sql).toContain("WHERE conname = 'lotes_tipo_pastura_check'");
    expect(sql).not.toMatch(/\bDEFAULT\b|\bNOT NULL\b|\bDROP\b|\bUPDATE\b/i);
  });

  test('todo valor cargado tiene una fuente con cita', () => {
    const parametros = [FRFA_DESDE_NDVI, FRACCION_RFA, ...Object.values(PARAMETROS_PASTURA).flatMap((p) => [p.eur, p.reingreso])];
    for (const parametro of parametros) {
      if (parametro.valor !== null) expect(parametro.fuente?.cita.length).toBeGreaterThan(20);
    }
  });

  test('las EUR cargadas son positivas y cubren las cuatro estaciones', () => {
    for (const { eur } of Object.values(PARAMETROS_PASTURA)) {
      if (eur.valor === null) continue;
      expect(Object.keys(eur.valor).sort()).toEqual(['invierno', 'otono', 'primavera', 'verano']);
      for (const valor of Object.values(eur.valor)) expect(valor).toBeGreaterThan(0);
    }
  });

  test('los criterios de reingreso son rangos ordenados y coherentes con hojas × filocrono', () => {
    for (const { reingreso } of Object.values(PARAMETROS_PASTURA)) {
      if (reingreso.valor === null) continue;
      const { hojasVivasPorMacollo, filocronoGradosDia, vidaMediaFoliarGradosDia, temperaturaBaseC } = reingreso.valor;
      for (const [minimo, maximo] of [filocronoGradosDia, vidaMediaFoliarGradosDia, temperaturaBaseC]) expect(minimo).toBeLessThanOrEqual(maximo);
      // La fuente publica la vida media foliar redondeada; se exige sólo que sea del orden de hojas × filocrono.
      expect(vidaMediaFoliarGradosDia[1]).toBeGreaterThanOrEqual(hojasVivasPorMacollo * filocronoGradosDia[0] * 0.75);
      expect(vidaMediaFoliarGradosDia[0]).toBeLessThanOrEqual(hojasVivasPorMacollo * filocronoGradosDia[1] * 1.25);
    }
  });

  test('las pasturas sin fuente quedan en null y no heredan valores de otra especie', () => {
    expect(PARAMETROS_PASTURA.pastizal_natural.eur.valor).toBeNull();
    expect(PARAMETROS_PASTURA.mezcla_alfalfa_gramineas.eur.valor).toBeNull();
    expect(PARAMETROS_PASTURA.raigras_anual.eur.valor).toBeNull();
    expect(PARAMETROS_PASTURA.alfalfa.reingreso.valor).toBeNull();
  });

  test('estaciones del hemisferio sur', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(estacionDelMes)).toEqual([
      'verano', 'verano', 'otono', 'otono', 'otono', 'invierno', 'invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano',
    ]);
  });

  test('esTipoPastura rechaza valores fuera de la lista', () => {
    expect(esTipoPastura('festuca_alta')).toBe(true);
    expect(esTipoPastura('Festuca alta')).toBe(false);
    expect(esTipoPastura(null)).toBe(false);
  });
});

const eid = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const lid = '00000000-0000-4000-8000-000000000004';
const actor: Membresia = { establecimientoId: eid, userId, rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] };

function req(body: unknown): Request {
  return { body, params: { id: lid }, usuario: { id: userId }, membresia: actor } as unknown as Request;
}
function res(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Response;
}

describe('PATCH de lote con tipo de pastura y fecha de siembra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reiniciarDeteccionPastura();
    mock.columnasEnBase = 2;
    mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM information_schema.columns')) return { rows: [{ cantidad: mock.columnasEnBase }] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql === 'SELECT id, polygon FROM establecimientos WHERE id = $1') return { rows: [{ id: eid, polygon: null }] };
      if (sql.includes('FROM lotes l WHERE l.establecimiento_id = $1')) {
        return { rows: [{ id: lid, numero: 1, apodo: null, polygon: null, activo: true, tipo_pastura: null, fecha_siembra: null, favorito: false, created_at: new Date(), updated_at: new Date() }] };
      }
      if (sql.startsWith('UPDATE lotes SET') && !sql.includes('tipo_pastura = $4')) return { rows: [{ id: lid, numero: 1, apodo: values[0], polygon: values[2], activo: values[1], tipo_pastura: null, fecha_siembra: null, created_at: new Date(), updated_at: new Date() }] };
      if (sql.includes('SELECT id FROM establecimientos WHERE id = $1 FOR UPDATE')) return { rows: [{ id: eid }] };
      if (sql.includes('SELECT l.id, l.numero')) return { rows: [{ id: lid, numero: 1, apodo: null, polygon: null, activo: true, tipo_pastura: null, fecha_siembra: null, created_at: new Date(), updated_at: new Date(), establecimiento_id: eid }] };
      if (sql.startsWith('UPDATE lotes SET')) return { rows: [{ id: lid, numero: 1, apodo: values[0], polygon: values[2], activo: values[1], tipo_pastura: values[3], fecha_siembra: values[4], created_at: new Date(), updated_at: new Date() }] };
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM lotes_favoritos')) return { rows: [{ favorito: false }] };
      throw new Error(`Consulta no prevista: ${sql}`);
    });
    mock.connect.mockResolvedValue({ query: mock.query, release: vi.fn() });
  });

  test('guarda tipo y fecha y los devuelve en el DTO', async () => {
    const response = res();
    await actualizarLote(req({ tipoPastura: 'festuca_alta', fechaSiembra: '2025-03-15' }), response);
    expect(response.json).toHaveBeenCalledWith({ lote: expect.objectContaining({ tipoPastura: 'festuca_alta', fechaSiembra: '2025-03-15' }) });
  });

  test('null borra el tipo cargado: nunca se reemplaza por uno por defecto', async () => {
    const response = res();
    await actualizarLote(req({ tipoPastura: null }), response);
    expect(response.json).toHaveBeenCalledWith({ lote: expect.objectContaining({ tipoPastura: null }) });
  });

  test.each([
    [{ tipoPastura: 'soja' }, 'INVALID_PASTURE_TYPE'],
    [{ tipoPastura: 7 }, 'INVALID_PASTURE_TYPE'],
    [{ fechaSiembra: '2025-02-30' }, 'INVALID_SOWING_DATE'],
    [{ fechaSiembra: '15/03/2025' }, 'INVALID_SOWING_DATE'],
  ])('rechaza %j con %s sin tocar la base', async (body, codigo) => {
    await expect(actualizarLote(req(body), res())).rejects.toMatchObject({ code: codigo });
    expect(mock.connect).not.toHaveBeenCalled();
  });

  test('rechaza una fecha de siembra futura según el calendario de Buenos Aires', async () => {
    const [anio, mes, dia] = hoyCalendario().split('-').map(Number);
    const manana = new Date(Date.UTC(anio, mes - 1, dia + 1)).toISOString().slice(0, 10);
    await expect(actualizarLote(req({ fechaSiembra: manana }), res())).rejects.toMatchObject({ code: 'FUTURE_SOWING_DATE' });
  });

  describe('base sin la migración 015', () => {
    beforeEach(() => { mock.columnasEnBase = 0; });

    test('el listado de lotes no pide columnas inexistentes y devuelve la pastura en null', async () => {
      const response = res();
      await obtenerLotes(req({}), response);
      const consulta = mock.query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes('FROM lotes l WHERE'))!;
      expect(consulta).not.toContain('l.tipo_pastura');
      expect(consulta).toContain('NULL::text AS tipo_pastura');
      expect(response.json).toHaveBeenCalledWith({ lotes: [expect.objectContaining({ tipoPastura: null, fechaSiembra: null })] });
    });

    test('editar el apodo sigue funcionando sin tocar las columnas nuevas', async () => {
      const response = res();
      await actualizarLote(req({ apodo: 'Bajo' }), response);
      const update = mock.query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.startsWith('UPDATE lotes SET'))!;
      expect(update).not.toContain('tipo_pastura =');
      expect(response.json).toHaveBeenCalledWith({ lote: expect.objectContaining({ apodo: 'Bajo', tipoPastura: null }) });
    });

    test('guardar la pastura responde un error explícito en vez de un 500', async () => {
      await expect(actualizarLote(req({ tipoPastura: 'festuca_alta' }), res())).rejects.toMatchObject({ status: 503, code: 'PASTURE_MIGRATION_PENDING' });
      expect(mock.connect).not.toHaveBeenCalled();
    });
  });
});

describe('detección de la migración 015', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reiniciarDeteccionPastura();
    mock.query.mockImplementation(async () => ({ rows: [{ cantidad: mock.columnasEnBase }] }));
  });

  test('la ausencia se vuelve a consultar al minuto y la presencia queda fija', async () => {
    mock.columnasEnBase = 0;
    expect(await columnasPasturaDisponibles(1_000_000)).toBe(false);
    mock.columnasEnBase = 2;
    expect(await columnasPasturaDisponibles(1_030_000)).toBe(false);
    expect(await columnasPasturaDisponibles(1_060_000)).toBe(true);
    mock.columnasEnBase = 0;
    expect(await columnasPasturaDisponibles(9_000_000)).toBe(true);
    expect(mock.query).toHaveBeenCalledTimes(2);
  });

  test('una sola de las dos columnas no alcanza', async () => {
    mock.columnasEnBase = 1;
    expect(await columnasPasturaDisponibles(1_000_000)).toBe(false);
  });
});
