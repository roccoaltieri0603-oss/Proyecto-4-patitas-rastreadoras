import { describe, expect, test } from 'vitest';
import { agruparClimaPorDia, type RegistroClimaDia } from '../../src/estimacion/clima.js';
import { estimarCrecimiento, frfaDesdeNdvi, ndviInterpolado, ventanaCrecimiento, type ObservacionNdvi } from '../../src/estimacion/crecimiento.js';
import { PARAMETROS_CRECIMIENTO, PARAMETROS_PASTURA } from '../../src/estimacion/parametros.js';
import { sumarDias } from '../../src/fechas.js';

const PARAMETROS = PARAMETROS_CRECIMIENTO.valor!;
const HASTA = '2026-10-30';
const DESDE = sumarDias(HASTA, -59);

/** Radiación constante todos los días de la ventana, más margen hacia atrás. */
function clima(radiacion: number | null, desde = sumarDias(DESDE, -5), cantidad = 70): Map<string, ReturnType<typeof agruparClimaPorDia> extends Map<string, infer T> ? T : never> {
  const registros: RegistroClimaDia[] = Array.from({ length: cantidad }, (_, i) => ({
    fecha: sumarDias(desde, i),
    consultadoEn: '2026-10-30T12:00:00.000Z',
    esPronostico: false,
    tempMin: 8,
    tempMax: 16,
    radiacionMjM2: radiacion,
  }));
  return agruparClimaPorDia(registros);
}

/** Una imagen despejada cada `cada` días, con NDVI constante, cubriendo la ventana y un día anterior. */
function imagenes(ndvi: number, cada = 7, desde = sumarDias(DESDE, -cada), hasta = HASTA): ObservacionNdvi[] {
  const lista: ObservacionNdvi[] = [];
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, cada)) lista.push({ fecha: dia, ndvi });
  if (lista.at(-1)?.fecha !== hasta) lista.push({ fecha: hasta, ndvi });
  return lista;
}

const LOMA = PARAMETROS_PASTURA.festuca_alta.ppna;
const BAJO = PARAMETROS_PASTURA.pastizal_natural.ppna;
const SIN_ECUACION = PARAMETROS_PASTURA.avena.ppna;

describe('frfaDesdeNdvi', () => {
  test('la fórmula del cociente simple de la fuente', () => {
    // NDVI 0,6 → SR 4 → (4 − 1,55) / (11,62 − 1,55) = 0,2433...
    expect(frfaDesdeNdvi(0.6)).toBeCloseTo((4 - 1.55) / (11.62 - 1.55), 10);
  });

  test('un NDVI por debajo del piso da 0, no un valor negativo', () => {
    // SR = 1,55 ⇔ NDVI = 0,2156...: por debajo, la fRFA se acota en 0.
    expect(frfaDesdeNdvi(0.2)).toBe(0);
    expect(frfaDesdeNdvi(0)).toBe(0);
    expect(frfaDesdeNdvi(-0.4)).toBe(0);
  });

  test('un NDVI alto queda en el tope de 0,95, incluso con NDVI 1', () => {
    expect(frfaDesdeNdvi(0.95)).toBe(PARAMETROS.frfaMaxima);
    expect(frfaDesdeNdvi(1)).toBe(PARAMETROS.frfaMaxima);
  });
});

describe('ndviInterpolado', () => {
  const observaciones: ObservacionNdvi[] = [{ fecha: '2026-10-01', ndvi: 0.4 }, { fecha: '2026-10-11', ndvi: 0.8 }];

  test('interpola linealmente entre dos imágenes despejadas', () => {
    expect(ndviInterpolado(observaciones, '2026-10-01')).toBeCloseTo(0.4, 10);
    expect(ndviInterpolado(observaciones, '2026-10-06')).toBeCloseTo(0.6, 10);
    expect(ndviInterpolado(observaciones, '2026-10-11')).toBeCloseTo(0.8, 10);
  });

  test('no extrapola ni hacia atrás ni hacia adelante', () => {
    expect(ndviInterpolado(observaciones, '2026-09-30')).toBeNull();
    expect(ndviInterpolado(observaciones, '2026-10-12')).toBeNull();
  });
});

describe('ventanaCrecimiento', () => {
  test('los 60 días que terminan en la última imagen despejada', () => {
    expect(ventanaCrecimiento(['2026-09-01', HASTA, '2026-10-02'])).toEqual({ desde: DESDE, hasta: HASTA });
  });

  test('sin imágenes no hay ventana', () => {
    expect(ventanaCrecimiento([])).toBeNull();
  });
});

describe('estimarCrecimiento', () => {
  test('convierte a kg MS/ha/día con la ecuación de loma', () => {
    const resultado = estimarCrecimiento(imagenes(0.6), clima(20), LOMA, 'Festuca alta');
    const rfaa = frfaDesdeNdvi(0.6) * PARAMETROS.fraccionRfaDeRadiacion * 20 * PARAMETROS.diasVentana;
    const ppna = 0.6 * rfaa + 12;
    expect(resultado.ventana).toEqual({ desde: DESDE, hasta: HASTA });
    expect(resultado.rfaaMjM2).toBeCloseTo(rfaa, 1);
    expect(resultado.ppnaGM2).toBeCloseTo(ppna, 1);
    // g/m² en 60 días → kg/ha/día: × 10 / 60.
    expect(resultado.kgMsHaDia).toBeCloseTo((ppna * 10) / 60, 1);
    expect(resultado.motivo).toBeNull();
    expect(resultado.avisos.length).toBe(3);
  });

  test('la ecuación de bajo da menos pasto que la de loma con la misma radiación absorbida', () => {
    const loma = estimarCrecimiento(imagenes(0.6), clima(20), LOMA, 'Festuca alta');
    const bajo = estimarCrecimiento(imagenes(0.6), clima(20), BAJO, 'Pastizal natural');
    expect(bajo.rfaaMjM2).toBe(loma.rfaaMjM2);
    expect(bajo.kgMsHaDia!).toBeLessThan(loma.kgMsHaDia!);
  });

  test('una pastura sin ecuación con fuente no estima nada', () => {
    const resultado = estimarCrecimiento(imagenes(0.6), clima(20), SIN_ECUACION, 'Avena (verdeo de invierno)');
    expect(resultado.kgMsHaDia).toBeNull();
    expect(resultado.motivo).toMatch(/Sin ecuación con fuente para Avena/);
    expect(resultado.avisos).toEqual([]);
  });

  test('sin imágenes guardadas lo dice en vez de estimar', () => {
    expect(estimarCrecimiento([], clima(20), LOMA, 'Festuca alta').motivo).toMatch(/Sin imágenes ópticas despejadas/);
  });

  test('con menos de 2 imágenes en un tramo de 30 días responde sin dato y con el motivo', () => {
    const pocas: ObservacionNdvi[] = [
      { fecha: sumarDias(DESDE, -3), ndvi: 0.6 },
      { fecha: sumarDias(DESDE, 2), ndvi: 0.6 },
      { fecha: sumarDias(DESDE, 10), ndvi: 0.6 },
      { fecha: HASTA, ndvi: 0.6 },
    ];
    const resultado = estimarCrecimiento(pocas, clima(20), LOMA, 'Festuca alta');
    expect(resultado.kgMsHaDia).toBeNull();
    expect(resultado.motivo).toMatch(/hacen falta 2 por cada 30 días/);
    expect(resultado.ventana).toEqual({ desde: DESDE, hasta: HASTA });
  });

  test('sin una imagen anterior al inicio de la ventana no extrapola hacia atrás', () => {
    const resultado = estimarCrecimiento(imagenes(0.6, 7, sumarDias(DESDE, 1)), clima(20), LOMA, 'Festuca alta');
    expect(resultado.kgMsHaDia).toBeNull();
    expect(resultado.motivo).toMatch(/no se extrapola hacia atrás/);
  });

  test('un día sin radiación corta la estimación y lo informa', () => {
    const climaConHueco = clima(20);
    climaConHueco.set(sumarDias(DESDE, 10), { temperaturaMedia: { valor: 12, origen: 'observado' }, radiacionMjM2: null });
    const resultado = estimarCrecimiento(imagenes(0.6), climaConHueco, LOMA, 'Festuca alta');
    expect(resultado.kgMsHaDia).toBeNull();
    expect(resultado.motivo).toMatch(/Falta la radiación del/);
  });

  test('sin ningún día de radiación tampoco inventa un valor', () => {
    expect(estimarCrecimiento(imagenes(0.6), clima(null), LOMA, 'Festuca alta').kgMsHaDia).toBeNull();
  });
});
