import ExcelJS from 'exceljs';
import { describe, expect, test } from 'vitest';
import { TITULO, construirLibroRegistro, gruposDeColumnas, nombreDeHoja } from '../../src/services/registro-usos-excel.js';
import type { LoteDelRegistro, RegistroDeUso } from '../../src/services/registro-usos.js';

const loteId = '00000000-0000-4000-8000-000000000001';
const otroLoteId = '00000000-0000-4000-8000-000000000002';

const lote = (id: string, numero: number, extra: Partial<LoteDelRegistro> = {}): LoteDelRegistro =>
  ({ id, numero, apodo: null, activo: true, hectareas: 101.78, ...extra });

const uso = (id: string, lote: string, fecha: string, diasDescanso: number | null, extra: Partial<RegistroDeUso> = {}): RegistroDeUso => ({
  id, loteId: lote, fecha, origen: 'manual', createdAt: `${fecha}T12:00:00.000Z`,
  ingresoAt: null, salidaAt: null, enCurso: false,
  animales: { adultos: null, toretesVaconas: null, terneros: null, total: null },
  alturaRemanenteCm: null, diasOcupacion: null, cabezasPorHa: null,
  fechaUsoAnterior: diasDescanso === null ? null : '2026-08-14',
  diasDescanso,
  ...extra,
});

const generadoEn = new Date('2026-10-17T15:00:00.000Z');

/** Escribe el libro a un buffer y lo vuelve a abrir, como haría Excel. */
async function reabrir(libro: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await libro.xlsx.writeBuffer();
  const leido = new ExcelJS.Workbook();
  await leido.xlsx.load(buffer as ArrayBuffer);
  return leido;
}

function textos(hoja: ExcelJS.Worksheet, fila: number, hasta: number): string[] {
  return Array.from({ length: hasta }, (_, indice) => {
    const valor = hoja.getRow(fila).getCell(indice + 1).value;
    return valor === null || valor === undefined ? '' : String(valor);
  });
}

describe('libro Excel del registro de manejo', () => {
  test('abre como xlsx válido y trae una hoja por potrero', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza',
      lotes: [lote(loteId, 1), lote(otroLoteId, 2, { apodo: 'El Bajo' })],
      registros: [uso('u1', loteId, '2026-09-20', 37)],
      generadoEn,
    }));
    expect(libro.worksheets.map((hoja) => hoja.name)).toEqual(['Lote 1', 'Lote 2 - El Bajo']);
    expect(libro.getWorksheet('Lote 1')?.getCell('A1').value).toBe(TITULO);
  });

  test('tiene las columnas de la planilla, agrupadas como en el papel', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)], registros: [], generadoEn,
    }));
    const hoja = libro.worksheets[0];

    const REMANENTE = 'Altura del remanente (cm)';
    // Fila 5: los títulos de columna, en orden.
    expect(textos(hoja, 5, 18)).toEqual([
      'Potrero', 'Superficie (ha)',
      'Fecha de entrada', 'Hora de entrada',
      'Fecha de salida', 'Hora de salida',
      'Días de descanso', 'Días de ocupación',
      'Adultos', 'Toretes o vaconas', 'Terneros o terneras', 'Cabezas por ha',
      REMANENTE,
      'Corte de igualación', 'Riego', 'Fertilización', 'Resiembra',
      'Origen del registro',
    ]);

    // Fila 4: los encabezados combinados. Al releer el archivo cada celda del
    // grupo devuelve el valor de su celda maestra, así que la repetición es
    // justamente la que confirma cuántas columnas abarca cada grupo.
    const ANIMALES = 'Número de animales que ingresan';
    const MANEJO = 'Recomendaciones de manejo';
    expect(textos(hoja, 4, 18)).toEqual([
      'Potrero', 'Potrero',
      'Entrada', 'Entrada',
      'Salida', 'Salida',
      'Días', 'Días',
      ANIMALES, ANIMALES, ANIMALES, ANIMALES,
      REMANENTE,
      MANEJO, MANEJO, MANEJO, MANEJO,
      'Origen del registro',
    ]);
  });

  test('combina celdas, congela el encabezado y deja anchos de columna', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)], registros: [], generadoEn,
    }));
    const hoja = libro.worksheets[0];
    expect(hoja.getCell('A1').isMerged).toBe(true);
    expect(hoja.getCell('G4').isMerged).toBe(true);
    expect(hoja.getCell('H4').master.address).toBe('G4');
    expect(hoja.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
    expect(hoja.getColumn(1).width).toBeGreaterThan(0);
  });

  test('un uso viejo, sólo con fecha, deja vacío lo que no se cargó', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza',
      lotes: [lote(loteId, 1)],
      registros: [uso('u1', loteId, '2026-09-20', 37)],
      generadoEn,
    }));
    const fila = libro.worksheets[0].getRow(6);
    expect(fila.getCell(1).value).toBe('Lote 1');
    expect(fila.getCell(2).value).toBe(101.78);
    expect(fila.getCell(3).value).toBeInstanceOf(Date);
    expect((fila.getCell(3).value as Date).toISOString().slice(0, 10)).toBe('2026-09-20');
    expect(fila.getCell(3).numFmt).toBe('dd/mm/yyyy');
    expect(fila.getCell(7).value).toBe(37);
    expect(fila.getCell(18).value).toBe('manual');
    // Horas, salida, ocupación, animales, remanente y recomendaciones: vacías para completar a mano.
    for (const columna of [4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
      expect(fila.getCell(columna).value).toBeNull();
    }
  });

  test('una jornada completa escribe horarios en hora argentina, animales, carga y remanente', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza',
      lotes: [lote(loteId, 1)],
      registros: [uso('u1', loteId, '2026-10-10', 20, {
        // 08:30 y 18:15 en Buenos Aires (UTC−3); la salida cae al día siguiente.
        ingresoAt: '2026-10-10T11:30:00.000Z', salidaAt: '2026-10-11T21:15:00.000Z', diasOcupacion: 1.4,
        animales: { adultos: 40, toretesVaconas: null, terneros: 12, total: 52 }, cabezasPorHa: 0.51, alturaRemanenteCm: 7,
      })],
      generadoEn,
    }));
    const fila = libro.worksheets[0].getRow(6);
    expect(fila.getCell(4).value).toBe('08:30');
    expect((fila.getCell(5).value as Date).toISOString().slice(0, 10)).toBe('2026-10-11');
    expect(fila.getCell(6).value).toBe('18:15');
    expect(fila.getCell(8).value).toBe(1.4);
    expect(fila.getCell(9).value).toBe(40);
    expect(fila.getCell(10).value).toBeNull();
    expect(fila.getCell(11).value).toBe(12);
    expect(fila.getCell(12).value).toBe(0.51);
    expect(fila.getCell(13).value).toBe(7);
    for (const columna of [14, 15, 16, 17]) expect(fila.getCell(columna).value).toBeNull();
  });

  test('una jornada abierta lo dice en la salida en lugar de dejarla vacía', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)],
      registros: [uso('u1', loteId, '2026-10-20', 9, { ingresoAt: '2026-10-20T12:00:00.000Z', enCurso: true, animales: { adultos: 30, toretesVaconas: null, terneros: null, total: 30 } })],
      generadoEn,
    }));
    const fila = libro.worksheets[0].getRow(6);
    expect(fila.getCell(5).value).toBe('Jornada abierta');
    expect(fila.getCell(6).value).toBeNull();
    expect(fila.getCell(8).value).toBeNull();
  });

  test('el primer uso del potrero dice que no hubo descanso previo, no un cero', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)],
      registros: [uso('u1', loteId, '2026-08-14', null)], generadoEn,
    }));
    expect(libro.worksheets[0].getRow(6).getCell(7).value).toBe('Primer uso registrado');
  });

  test('una superficie que no se pudo calcular queda vacía, no en cero', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1, { hectareas: null })],
      registros: [uso('u1', loteId, '2026-09-20', 37)], generadoEn,
    }));
    expect(libro.worksheets[0].getRow(6).getCell(2).value).toBeNull();
  });

  test('un potrero sin usos en el período igual tiene su hoja, y lo dice', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)], registros: [],
      desde: '2026-09-01', hasta: '2026-09-30', generadoEn,
    }));
    const hoja = libro.worksheets[0];
    expect(hoja.getCell('A6').value).toBe('Sin usos registrados en este período.');
    expect(String(hoja.getCell('A2').value)).toContain('01/09/2026 a 30/09/2026');
  });

  test('el subtítulo dice el período completo cuando no hay filtro de fechas', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)], registros: [], generadoEn,
    }));
    expect(String(libro.worksheets[0].getCell('A2').value)).toContain('todo el historial registrado');
  });

  test('avisa en la hoja por qué hay columnas vacías', async () => {
    const libro = await reabrir(construirLibroRegistro({
      establecimiento: 'La Esperanza', lotes: [lote(loteId, 1)], registros: [], generadoEn,
    }));
    const nota = String(libro.worksheets[0].getCell('A3').value);
    expect(nota).toContain('para completar a mano');
    expect(nota).toContain('sólo con fecha');
    expect(nota).toContain('no son equivalentes vaca');
  });
});

describe('nombres de hoja', () => {
  test('respeta el límite de Excel y saca los caracteres prohibidos', () => {
    const usados = new Set<string>();
    expect(nombreDeHoja(lote(loteId, 1, { apodo: 'Potrero/Norte[2]' }), usados)).toBe('Lote 1 - Potrero Norte 2');
    const largo = nombreDeHoja(lote(otroLoteId, 2, { apodo: 'a'.repeat(60) }), usados);
    expect(largo.length).toBeLessThanOrEqual(31);
  });

  test('no repite un nombre aunque dos apodos se corten igual', () => {
    const usados = new Set<string>();
    const apodo = 'b'.repeat(60);
    const primero = nombreDeHoja(lote(loteId, 1, { apodo }), usados);
    const segundo = nombreDeHoja(lote(otroLoteId, 1, { apodo }), usados);
    expect(segundo).not.toBe(primero);
    expect(segundo.length).toBeLessThanOrEqual(31);
  });
});

describe('agrupación de columnas', () => {
  test('cada grupo cubre columnas consecutivas y juntas son toda la planilla', () => {
    const grupos = gruposDeColumnas();
    expect(grupos[0]).toEqual({ nombre: 'Potrero', primera: 1, ultima: 2 });
    expect(grupos[grupos.length - 1].ultima).toBe(18);
    grupos.forEach((grupo, indice) => {
      if (indice > 0) expect(grupo.primera).toBe(grupos[indice - 1].ultima + 1);
      expect(grupo.ultima).toBeGreaterThanOrEqual(grupo.primera);
    });
  });
});
