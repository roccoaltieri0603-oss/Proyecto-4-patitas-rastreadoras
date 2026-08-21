import { describe, expect, test } from 'vitest';
import { diasEntreFechas, esFechaCalendario, horasDesdeTimestamp, hoyCalendario } from '../../src/fechas.js';

describe('fechas calendario y frescura', () => {
  test('calcula días sin convertir DATE en instante local', () => {
    expect(esFechaCalendario('2026-08-20')).toBe(true);
    expect(esFechaCalendario('2026-02-30')).toBe(false);
    expect(diasEntreFechas('2026-08-14', '2026-08-20')).toBe(6);
    expect(diasEntreFechas('2026-08-20', '2026-08-20')).toBe(0);
  });

  test('calcula horas para timestamps reales', () => {
    expect(horasDesdeTimestamp('2026-08-20T11:36:00.000Z', Date.parse('2026-08-20T12:00:00.000Z'))).toBe(0.4);
  });

  test('usa el calendario argentino aunque el host trabaje en UTC', () => {
    expect(hoyCalendario(new Date('2026-08-21T01:30:00.000Z'))).toBe('2026-08-20');
    expect(hoyCalendario(new Date('2026-08-21T03:00:00.000Z'))).toBe('2026-08-21');
  });
});
