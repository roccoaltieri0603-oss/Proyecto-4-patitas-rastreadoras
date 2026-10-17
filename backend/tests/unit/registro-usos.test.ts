import type { Request, Response } from 'express';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: db.query } }));
import {
  MAXIMO_FILAS_EXCEL,
  descargarRegistroUsosExcel,
  obtenerRegistroUsos,
} from '../../src/controllers/registro-usos.js';
import { obtenerRegistroDeUsos } from '../../src/services/registro-usos.js';

const establecimientoId = '00000000-0000-4000-8000-000000000010';
const loteId = '00000000-0000-4000-8000-000000000001';
const otroLoteId = '00000000-0000-4000-8000-000000000002';
const paginacion = { limit: 50, offset: 0 };

/** Cuadrado de 0,01° de lado a la altura de Buenos Aires: 101,78 ha según Turf. */
const polygon = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-58.5, -34.6], [-58.49, -34.6], [-58.49, -34.59], [-58.5, -34.59], [-58.5, -34.6]]],
  },
};

const lote = (id: string, numero: number, extra: Record<string, unknown> = {}) =>
  ({ id, numero, apodo: null, activo: true, polygon, ...extra });

/** Las tres consultas del servicio, en orden: lotes, total y página de usos. */
function respondeCon(lotes: unknown[], usos: Array<Record<string, unknown>>) {
  db.query
    .mockResolvedValueOnce({ rows: lotes })
    .mockResolvedValueOnce({ rows: [{ total: String(usos.length) }] })
    .mockResolvedValueOnce({ rows: usos });
}

const uso = (id: string, lote: string, fecha: string, fechaAnterior: string | null) =>
  ({ id, lote_id: lote, fecha, origen: 'manual', created_at: `${fecha}T12:00:00.000Z`, fecha_anterior: fechaAnterior });

beforeEach(() => {
  vi.resetAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

describe('registro de uso de potreros', () => {
  test('deriva los días de descanso del uso anterior del mismo potrero', async () => {
    respondeCon([lote(loteId, 1)], [
      uso('u2', loteId, '2026-09-20', '2026-08-14'),
      uso('u1', loteId, '2026-08-14', null),
    ]);
    const { registros } = await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(registros.map((registro) => registro.diasDescanso)).toEqual([37, null]);
    expect(registros[1].fechaUsoAnterior).toBeNull();
  });

  test('cuenta el descanso contra el uso anterior aunque quede fuera del rango consultado', async () => {
    respondeCon([lote(loteId, 1)], [uso('u2', loteId, '2026-09-20', '2026-08-14')]);
    const { registros } = await obtenerRegistroDeUsos(
      establecimientoId, { desde: '2026-09-01', hasta: '2026-09-30' }, paginacion,
    );
    expect(registros[0]).toMatchObject({ fechaUsoAnterior: '2026-08-14', diasDescanso: 37 });
    // El LAG vive en el CTE y el rango se aplica después: si se filtrara antes,
    // el primer uso del mes aparecería como si nunca hubiera descansado.
    const [sqlPagina] = db.query.mock.calls[2];
    expect(sqlPagina.indexOf('LAG(fecha)')).toBeLessThan(sqlPagina.indexOf('fecha >= $'));
  });

  test('no mezcla el descanso entre potreros distintos', async () => {
    respondeCon([lote(loteId, 1), lote(otroLoteId, 2)], []);
    await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(db.query.mock.calls[2][0]).toContain('PARTITION BY lote_id');
  });

  test('calcula la superficie con Turf y dice "sin datos" si la geometría guardada no sirve', async () => {
    respondeCon([lote(loteId, 1), lote(otroLoteId, 2, { polygon: { type: 'Feature', geometry: null } })], []);
    const { lotes } = await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(lotes.map((item) => item.hectareas)).toEqual([101.78, null]);
  });

  test('toma renglones sólo de los potreros activos salvo que se pidan los inactivos', async () => {
    const potreros = [lote(loteId, 1), lote(otroLoteId, 2, { activo: false })];
    respondeCon(potreros, []);
    await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(db.query.mock.calls[1][1][0]).toEqual([loteId]);

    vi.resetAllMocks();
    respondeCon(potreros, []);
    await obtenerRegistroDeUsos(establecimientoId, { incluirInactivos: true }, paginacion);
    expect(db.query.mock.calls[1][1][0]).toEqual([loteId, otroLoteId]);
  });

  test('devuelve el catálogo completo de potreros aunque se filtre por uno solo', async () => {
    respondeCon([lote(loteId, 1), lote(otroLoteId, 2)], []);
    const { lotes } = await obtenerRegistroDeUsos(establecimientoId, { loteId }, paginacion);
    // El selector de la planilla necesita todos; los renglones, sólo el elegido.
    expect(lotes.map((item) => item.id)).toEqual([loteId, otroLoteId]);
    expect(db.query.mock.calls[1][1][0]).toEqual([loteId]);
  });

  test('filtrar por un potrero concreto funciona aunque esté inactivo', async () => {
    respondeCon([lote(loteId, 1, { activo: false })], []);
    await obtenerRegistroDeUsos(establecimientoId, { loteId }, paginacion);
    expect(db.query.mock.calls[1][1][0]).toEqual([loteId]);
  });

  test('rechaza con 404 un potrero que no es de este establecimiento', async () => {
    db.query.mockResolvedValueOnce({ rows: [lote(otroLoteId, 2)] });
    await expect(obtenerRegistroDeUsos(establecimientoId, { loteId }, paginacion))
      .rejects.toMatchObject({ status: 404, code: 'LOT_NOT_FOUND' });
    expect(db.query).toHaveBeenCalledOnce();
  });

  test('un establecimiento sin potreros no consulta usos', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const registro = await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(registro).toEqual({ lotes: [], registros: [], paginacion: { limit: 50, offset: 0, total: 0, hayMas: false } });
    expect(db.query).toHaveBeenCalledOnce();
  });

  test('si todos los potreros están inactivos no consulta usos, pero los sigue listando', async () => {
    db.query.mockResolvedValueOnce({ rows: [lote(loteId, 1, { activo: false })] });
    const registro = await obtenerRegistroDeUsos(establecimientoId, {}, paginacion);
    expect(registro.lotes).toHaveLength(1);
    expect(registro.registros).toEqual([]);
    expect(db.query).toHaveBeenCalledOnce();
  });

  test('informa si quedan páginas por recorrer', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [lote(loteId, 1)] })
      .mockResolvedValueOnce({ rows: [{ total: '120' }] })
      .mockResolvedValueOnce({ rows: [uso('u1', loteId, '2026-09-20', null)] });
    const { paginacion: resultado } = await obtenerRegistroDeUsos(establecimientoId, {}, { limit: 50, offset: 0 });
    expect(resultado).toEqual({ limit: 50, offset: 0, total: 120, hayMas: true });
  });
});

const req = (query: Record<string, unknown> = {}) => ({
  query,
  usuario: { id: '00000000-0000-4000-8000-000000000003' },
  membresia: { establecimientoId, rol: 'VISOR', principal: false, permisos: [], capacidades: [] },
}) as unknown as Request;
const res = () => ({ json: vi.fn() }) as unknown as Response;

describe('endpoint del registro de uso', () => {
  test('resuelve el establecimiento desde la membresía, no desde la query', async () => {
    respondeCon([lote(loteId, 1)], []);
    const response = res();
    await obtenerRegistroUsos(req({ establecimientoId: 'otro-establecimiento' }), response);
    expect(db.query.mock.calls[0][1]).toEqual([establecimientoId]);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ lotes: expect.any(Array), registros: [] }));
  });

  test('exige sesión antes de consultar la base', async () => {
    const anonimo = req(); delete anonimo.usuario;
    await expect(obtenerRegistroUsos(anonimo, res())).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each([{ loteId: 'no-uuid' }, { loteId: ['a', 'b'] }])('rechaza loteId inválido %j', async (query) => {
    await expect(obtenerRegistroUsos(req(query), res())).rejects.toMatchObject({ status: 400, code: 'INVALID_LOT_ID' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rechaza un rango de fechas dado vuelta', async () => {
    await expect(obtenerRegistroUsos(req({ desde: '2026-09-30', hasta: '2026-09-01' }), res()))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_DATE_RANGE' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('aplica el rango y la paginación pedidos', async () => {
    respondeCon([lote(loteId, 1)], []);
    await obtenerRegistroUsos(req({ desde: '2026-09-01', hasta: '2026-09-30', limit: '10', offset: '20' }), res());
    const [sql, valores] = db.query.mock.calls[2];
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(valores).toEqual([[loteId], '2026-09-01', '2026-09-30', 10, 20]);
  });
});

/** `res` que sirve de stream para el libro y recuerda las cabeceras. */
function resArchivo() {
  const stream = new PassThrough();
  const cabeceras: Record<string, string> = {};
  const trozos: Buffer[] = [];
  stream.on('data', (trozo: Buffer) => { trozos.push(trozo); });
  return Object.assign(stream, {
    cabeceras,
    trozos,
    setHeader: (nombre: string, valor: string) => { cabeceras[nombre] = valor; },
  }) as unknown as Response & { cabeceras: Record<string, string>; trozos: Buffer[] };
}

describe('descarga del registro en Excel', () => {
  test('responde un xlsx con nombre de archivo y el libro adentro', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [lote(loteId, 1)] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [uso('u1', loteId, '2026-09-20', '2026-08-14')] })
      .mockResolvedValueOnce({ rows: [{ nombre: 'La Esperanza' }] });
    const response = resArchivo();
    await descargarRegistroUsosExcel(req({ desde: '2026-09-01', hasta: '2026-09-30' }), response);

    expect(response.cabeceras['Content-Type'])
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.cabeceras['Content-Disposition'])
      .toBe('attachment; filename="registro-manejo-potreros-la-esperanza-2026-09-01_2026-09-30.xlsx"');
    // "PK": el libro salió como un zip de verdad, no como un cuerpo vacío.
    expect(Buffer.concat(response.trozos).subarray(0, 2).toString()).toBe('PK');
  });

  test('pide todo el período de una, no la primera página', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [lote(loteId, 1)] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nombre: 'La Esperanza' }] });
    await descargarRegistroUsosExcel(req({ limit: '10', offset: '20' }), resArchivo());
    expect(db.query.mock.calls[2][1]).toEqual([[loteId], MAXIMO_FILAS_EXCEL, 0]);
  });

  test('se niega a generar un libro imposible y explica cómo acotarlo', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [lote(loteId, 1)] })
      .mockResolvedValueOnce({ rows: [{ total: String(MAXIMO_FILAS_EXCEL + 1) }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(descargarRegistroUsosExcel(req(), resArchivo()))
      .rejects.toMatchObject({ status: 400, code: 'EXPORT_TOO_LARGE' });
  });

  test('con un potrero elegido el libro trae sólo su hoja', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [lote(loteId, 1), lote(otroLoteId, 2)] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nombre: 'La Esperanza' }] });
    const response = resArchivo();
    await descargarRegistroUsosExcel(req({ loteId }), response);
    expect(db.query.mock.calls[2][1][0]).toEqual([loteId]);
    expect(Buffer.concat(response.trozos).length).toBeGreaterThan(0);
  });

  test('valida los filtros antes de tocar la base', async () => {
    await expect(descargarRegistroUsosExcel(req({ loteId: 'no-uuid' }), resArchivo()))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_LOT_ID' });
    expect(db.query).not.toHaveBeenCalled();
  });
});
