import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), disponible: true, consultas: [] as Array<[string, unknown[]]> }));
vi.mock('../../src/base-datos/pool.js', () => ({
  pool: {
    query: mock.query,
    connect: async () => ({ query: mock.query, release: () => {} }),
  },
}));
vi.mock('../../src/base-datos/mediciones-altura-disponibles.js', () => ({ medicionesAlturaDisponibles: async () => mock.disponible }));
import { crearMedicionAltura, eliminarMedicionAltura, modificarMedicionAltura } from '../../src/controllers/mediciones-altura.js';
import { hoyCalendario, sumarDias } from '../../src/fechas.js';
import { leerDatosMedicion } from '../../src/services/mediciones-altura.js';

const eid = '00000000-0000-4000-8000-000000000001';
const lid = '00000000-0000-4000-8000-000000000004';
const usoId = '00000000-0000-4000-8000-000000000009';
const medicionId = '00000000-0000-4000-8000-00000000000a';
const actor: Membresia = { establecimientoId: eid, userId: 'u', rol: 'ADMINISTRADOR', principal: false, permisos: ['registrar_usos', 'modificar_usos'], capacidades: [] };
const hoy = '2026-10-23';

function fila(cambios: Record<string, unknown> = {}) {
  return {
    id: medicionId, lote_id: lid, fecha: '2026-10-20', momento: 'salida', instrumento: 'plato', altura_promedio_cm: 6,
    cantidad_lecturas: 25, desvio_cm: null, uso_id: usoId, created_at: new Date(), updated_at: new Date(), ...cambios,
  };
}

let usoDelLote: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  mock.disponible = true;
  usoDelLote = true;
  mock.query.mockImplementation(async (sql: string, valores: unknown[] = []) => {
    if (sql.includes('FROM lotes l JOIN establecimientos e')) return { rows: [{ id: lid }] };
    if (sql.startsWith('SELECT 1 FROM usos_lote')) return { rows: usoDelLote ? [{}] : [] };
    if (sql.startsWith('INSERT INTO mediciones_altura')) return { rows: [fila({ fecha: valores[1], momento: valores[2], instrumento: valores[3], altura_promedio_cm: valores[4], uso_id: valores[7] })] };
    if (sql.includes('FOR UPDATE')) return { rows: [fila()] };
    if (sql.startsWith('UPDATE mediciones_altura')) return { rows: [fila({ altura_promedio_cm: valores[5] })] };
    if (sql.startsWith('DELETE FROM mediciones_altura')) return { rows: [fila()] };
    return { rows: [], rowCount: 1 };
  });
});

function req(body: unknown = {}, params: Record<string, string> = {}): Request {
  return { params: { id: lid, ...params }, query: {}, body, usuario: { id: 'u' }, membresia: actor } as unknown as Request;
}
function res() {
  const respuesta = { status: vi.fn(), json: vi.fn(), send: vi.fn() };
  respuesta.status.mockReturnValue(respuesta);
  return respuesta as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}
const sqls = () => mock.query.mock.calls.map(([sql]) => String(sql));

describe('validación de una medición', () => {
  const base = { fecha: '2026-10-20', momento: 'recorrida', instrumento: 'plato', alturaPromedioCm: 9, cantidadLecturas: 30 };

  test('acepta una medición completa y deja el desvío y el uso opcionales', () => {
    expect(leerDatosMedicion(base, hoy)).toEqual({ ...base, desvioCm: null, usoId: null });
  });

  test('la lectura del plato Filip\'s en medios centímetros se divide por 2, como en la fuente', () => {
    expect(leerDatosMedicion({ ...base, alturaPromedioCm: 18, desvioCm: 4, lecturaEnMediosCm: true }, hoy)).toMatchObject({ alturaPromedioCm: 9, desvioCm: 2 });
    expect(() => leerDatosMedicion({ ...base, instrumento: 'regla', lecturaEnMediosCm: true }, hoy)).toThrow(/Sólo el plato/);
  });

  test.each([
    [{ fecha: sumarDias(hoyCalendario(), 1) }, 'FUTURE_MEASUREMENT_DATE'],
    [{ fecha: '2026-02-30' }, 'INVALID_DATE'],
    [{ momento: 'despues' }, 'INVALID_MEASUREMENT_MOMENT'],
    [{ instrumento: 'capacitometro' }, 'INVALID_INSTRUMENT'],
    [{ alturaPromedioCm: 0 }, 'INVALID_HEIGHT'],
    [{ alturaPromedioCm: 151 }, 'INVALID_HEIGHT'],
    [{ cantidadLecturas: 0 }, 'INVALID_READINGS_COUNT'],
    [{ cantidadLecturas: 2.5 }, 'INVALID_READINGS_COUNT'],
    [{ desvioCm: -1 }, 'INVALID_DEVIATION'],
    [{ usoId: 'abc' }, 'INVALID_USE_ID'],
  ])('rechaza %j con %s', (cambio, codigo) => {
    expect(() => leerDatosMedicion({ ...base, ...cambio }, hoyCalendario())).toThrow(expect.objectContaining({ code: codigo, status: 400 }));
  });

  test('al modificar, lo que no viene queda como estaba', () => {
    const anterior = leerDatosMedicion(base, hoy);
    expect(leerDatosMedicion({ cantidadLecturas: 40 }, hoy, anterior)).toEqual({ ...anterior, cantidadLecturas: 40 });
  });
});

describe('endpoints de mediciones de altura', () => {
  const cuerpo = { fecha: '2026-10-20', momento: 'salida', instrumento: 'plato', alturaPromedioCm: 6, cantidadLecturas: 25, usoId };

  test('sin la migración 018 responde 503 y no toca la base', async () => {
    mock.disponible = false;
    await expect(crearMedicionAltura(req(cuerpo), res())).rejects.toMatchObject({ status: 503, code: 'HEIGHT_MIGRATION_PENDING' });
    expect(mock.query).not.toHaveBeenCalled();
  });

  test('el lote sale de la URL y del establecimiento de la sesión', async () => {
    await crearMedicionAltura(req(cuerpo), res());
    const [sql, valores] = mock.query.mock.calls[0];
    expect(sql).toContain('l.deleted_at IS NULL');
    expect(valores).toEqual([lid, eid]);
  });

  test('una medición de salida se guarda y copia el remanente a la jornada, en una transacción', async () => {
    const respuesta = res();
    await crearMedicionAltura(req(cuerpo), respuesta);
    expect(respuesta.status).toHaveBeenCalledWith(201);
    expect(respuesta.json.mock.calls[0][0].medicion).toMatchObject({ momento: 'salida', alturaPromedioCm: 6, usoId });
    expect(sqls()).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    const copia = mock.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE usos_lote SET altura_remanente_cm = $1'));
    expect(copia?.[1]).toEqual([6, usoId, lid]);
    expect(String(copia?.[0])).toContain('salida_at IS NOT NULL');
  });

  test('una recorrida no toca la jornada', async () => {
    await crearMedicionAltura(req({ ...cuerpo, momento: 'recorrida' }), res());
    expect(sqls().some((sql) => sql.startsWith('UPDATE usos_lote'))).toBe(false);
  });

  test('un uso de otro lote no se puede asociar', async () => {
    usoDelLote = false;
    await expect(crearMedicionAltura(req(cuerpo), res())).rejects.toMatchObject({ status: 404, code: 'USE_NOT_FOUND' });
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls().some((sql) => sql.startsWith('INSERT'))).toBe(false);
  });

  test('modificar vuelve a copiar el remanente y borrar lo quita sólo si era el copiado', async () => {
    await modificarMedicionAltura(req({ alturaPromedioCm: 7 }, { medicionId }), res());
    const quitar = mock.query.mock.calls.find(([sql]) => String(sql).includes('SET altura_remanente_cm = NULL'));
    expect(quitar?.[1]).toEqual([usoId, lid, 6]);
    expect(mock.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE usos_lote SET altura_remanente_cm = $1'))?.[1]).toEqual([7, usoId, lid]);

    vi.clearAllMocks();
    const respuesta = res();
    await eliminarMedicionAltura(req({}, { medicionId }), respuesta);
    expect(respuesta.status).toHaveBeenCalledWith(204);
    expect(sqls().some((sql) => sql.includes('SET altura_remanente_cm = NULL') && sql.includes('altura_remanente_cm = $3'))).toBe(true);
  });

  test('una medición inexistente o de otro lote es 404', async () => {
    await expect(modificarMedicionAltura(req({}, { medicionId: 'no-es-uuid' }), res())).rejects.toMatchObject({ status: 404 });
    mock.query.mockImplementation(async (sql: string) => (sql.includes('FROM lotes l JOIN') ? { rows: [{ id: lid }] } : { rows: [] }));
    await expect(eliminarMedicionAltura(req({}, { medicionId }), res())).rejects.toMatchObject({ status: 404, code: 'MEASUREMENT_NOT_FOUND' });
  });
});
