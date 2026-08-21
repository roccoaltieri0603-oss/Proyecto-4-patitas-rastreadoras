import { describe, expect, test } from 'vitest';
import { validarUsernameSmoke } from '../../scripts/smoke-cleanup.js';

describe('salvaguarda del cleanup smoke', () => {
  test('acepta únicamente el formato exacto generado por el smoke', () => {
    expect(validarUsernameSmoke('rodeo_smoke_1787313600000')).toBe('rodeo_smoke_1787313600000');
  });

  test('rechaza usuarios normales y prefijos smoke ambiguos', () => {
    for (const username of [undefined, 'usuario_real', 'rodeo_smoke_1', 'rodeo_smoke_1787313600000_extra']) {
      expect(() => validarUsernameSmoke(username)).toThrow(/formato estricto/);
    }
  });
});
