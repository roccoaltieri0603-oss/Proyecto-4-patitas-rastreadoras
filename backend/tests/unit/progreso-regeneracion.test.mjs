import { describe, expect, test } from 'vitest';
import { progresoRegeneracion } from '../../../src/estimacion/presentacion.js';

// `avanceEstadoFoliar` viaja en porcentaje (la API manda 78, no 0,78) y la barra
// dibuja una fracción: la conversión es parte de lo que se prueba acá.
const reingreso = (avance) => ({ condicionHoy: avance === null ? null : { avanceEstadoFoliar: avance } });

describe('progreso para la barra de Regeneración', () => {
  test('usa el avance de hoy de la estimación, pasado de porcentaje a fracción', () => {
    expect(progresoRegeneracion(reingreso(78), { progresoRebrote: 0.1 })).toBe(0.78);
  });

  test('un avance de más de 100 % no se recorta acá: la barra lo limita al dibujar', () => {
    expect(progresoRegeneracion(reingreso(112), undefined)).toBe(1.12);
  });

  test('sin avance de hoy, cae al progreso del orden de pastoreo', () => {
    expect(progresoRegeneracion(reingreso(null), { progresoRebrote: 0.38 })).toBe(0.38);
    expect(progresoRegeneracion(null, { progresoRebrote: 0.38 })).toBe(0.38);
  });

  test('sin ninguno de los dos devuelve null, no un cero inventado', () => {
    expect(progresoRegeneracion(null, undefined)).toBeNull();
    expect(progresoRegeneracion(reingreso(null), { progresoRebrote: null })).toBeNull();
  });

  test('un cero real se conserva: es un lote recién pastoreado', () => {
    expect(progresoRegeneracion(reingreso(0), undefined)).toBe(0);
  });
});
