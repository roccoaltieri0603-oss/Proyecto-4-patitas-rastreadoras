import { describe, expect, test } from 'vitest';
import { esRequestIdValido } from '../../src/http/request-id.js';

describe('request ID', () => {
  test('acepta identificadores seguros y acotados', () => {
    expect(esRequestIdValido('req-2026_08.20:frontend')).toBe(true);
    expect(esRequestIdValido('a'.repeat(128))).toBe(true);
  });

  test('rechaza vacío, caracteres de control y valores demasiado largos', () => {
    expect(esRequestIdValido('')).toBe(false);
    expect(esRequestIdValido('request con espacios')).toBe(false);
    expect(esRequestIdValido('request\r\ninjected')).toBe(false);
    expect(esRequestIdValido('a'.repeat(129))).toBe(false);
  });
});
