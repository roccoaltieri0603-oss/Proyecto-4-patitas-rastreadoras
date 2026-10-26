import { describe, expect, test } from 'vitest';
import { enteroPositivo, escribe, fecha, leerArgumentos, uuids } from '../../src/linea-comandos.js';

const ACEPTADAS = { banderas: ['dry-run', 'escribir'], conValor: ['desde', 'lote', 'max-lotes'] } as const;
const ID_A = '00000000-0000-4000-8000-000000000001';
const ID_B = '00000000-0000-4000-8000-000000000002';

describe('argumentos de los scripts', () => {
  test('por defecto no escribe', () => {
    expect(escribe(leerArgumentos([], ACEPTADAS))).toBe(false);
    expect(escribe(leerArgumentos(['--dry-run'], ACEPTADAS))).toBe(false);
    expect(escribe(leerArgumentos(['--escribir'], ACEPTADAS))).toBe(true);
  });

  test('--escribir y --dry-run juntos es un error', () => {
    expect(() => escribe(leerArgumentos(['--escribir', '--dry-run'], ACEPTADAS))).toThrow(/no van juntos/);
  });

  test('una opción desconocida es un error, no se ignora', () => {
    expect(() => leerArgumentos(['--escrbir'], ACEPTADAS)).toThrow(/desconocida/);
    expect(() => leerArgumentos(['suelto'], ACEPTADAS)).toThrow(/inesperado/);
  });

  test('lee valores con espacio o con igual, y lotes repetidos o separados por coma', () => {
    const argumentos = leerArgumentos(['--desde', '2026-01-01', '--lote', ID_A, `--lote=${ID_B},${ID_A}`, '--max-lotes=20'], ACEPTADAS);
    expect(fecha(argumentos, 'desde')).toBe('2026-01-01');
    expect(uuids(argumentos, 'lote')).toEqual([ID_A, ID_B]);
    expect(enteroPositivo(argumentos, 'max-lotes')).toBe(20);
  });

  test('valida fechas, enteros y UUID', () => {
    expect(() => fecha(leerArgumentos(['--desde', '2026-02-30'], ACEPTADAS), 'desde')).toThrow(/fecha/);
    expect(() => enteroPositivo(leerArgumentos(['--max-lotes', '0'], ACEPTADAS), 'max-lotes')).toThrow(/entero positivo/);
    expect(() => uuids(leerArgumentos(['--lote', 'abc'], ACEPTADAS), 'lote')).toThrow(/UUID/);
    expect(() => leerArgumentos(['--desde'], ACEPTADAS)).toThrow(/necesita un valor/);
    expect(() => leerArgumentos(['--dry-run=si'], ACEPTADAS)).toThrow(/no lleva valor/);
    expect(() => fecha(leerArgumentos(['--desde', '2026-01-01', '--desde', '2026-02-01'], ACEPTADAS), 'desde')).toThrow(/una sola vez/);
  });
});
