import { describe, expect, test } from 'vitest';
import { agruparClimaPorDia, type RegistroClimaDia } from '../../src/estimacion/clima.js';
import {
  COBERTURA_MINIMA_ESTIMACION,
  MAXIMO_DIAS_SIN_IMAGEN,
  VERSION_MODELO,
  crecimientoDiario,
  estimarForraje,
  estimarReingreso,
  frfaDesdeNdvi,
  type EntradaEstimacion,
  type ObservacionOptica,
} from '../../src/estimacion/motor.js';
import { FRFA_DESDE_NDVI, PARAMETROS_PASTURA, type ParametrosFrfa } from '../../src/estimacion/parametros.js';
import { sumarDias } from '../../src/fechas.js';

const FRFA = FRFA_DESDE_NDVI.valor as ParametrosFrfa;
const EUR_FESTUCA = PARAMETROS_PASTURA.festuca_alta.eur.valor!;
const EUR_ALFALFA = PARAMETROS_PASTURA.alfalfa.eur.valor!;

/** Un registro climático por día, todos de la misma consulta. */
function clima(desde: string, cantidad: number, opciones: { tempMin?: number; tempMax?: number; radiacion?: number | null; pronosticoDesde?: string; consultadoEn?: string } = {}): RegistroClimaDia[] {
  return Array.from({ length: cantidad }, (_, i) => {
    const fecha = sumarDias(desde, i);
    return {
      fecha,
      consultadoEn: opciones.consultadoEn ?? '2026-10-22T12:00:00.000Z',
      esPronostico: opciones.pronosticoDesde !== undefined && fecha >= opciones.pronosticoDesde,
      tempMin: opciones.tempMin ?? 8,
      tempMax: opciones.tempMax ?? 16,
      radiacionMjM2: opciones.radiacion === undefined ? 20 : opciones.radiacion,
    };
  });
}

function imagen(fecha: string, ndvi: number, cobertura = 0.9): ObservacionOptica {
  return { fecha, ndviMediana: ndvi, coberturaValida: cobertura };
}

function entrada(cambios: Partial<EntradaEstimacion> = {}): EntradaEstimacion {
  return {
    tipoPastura: 'festuca_alta',
    desde: '2026-10-01',
    hoy: '2026-10-10',
    observaciones: [imagen('2026-09-28', 0.8)],
    clima: clima('2026-10-01', 10),
    usos: [],
    ...cambios,
  };
}

function esperado(eur: number, ndvi: number, radiacion: number): number {
  return Math.round(crecimientoDiario(eur, frfaDesdeNdvi(ndvi, FRFA).valor, 0.48, radiacion) * 10) / 10;
}

describe('agruparClimaPorDia', () => {
  test('prefiere el observado aunque haya un pronóstico más nuevo', () => {
    const registros: RegistroClimaDia[] = [
      { fecha: '2026-10-01', consultadoEn: '2026-10-01T12:00:00Z', esPronostico: true, tempMin: 0, tempMax: 10, radiacionMjM2: 5 },
      { fecha: '2026-10-01', consultadoEn: '2026-10-02T12:00:00Z', esPronostico: false, tempMin: 10, tempMax: 20, radiacionMjM2: 18 },
      { fecha: '2026-10-01', consultadoEn: '2026-10-03T12:00:00Z', esPronostico: true, tempMin: 2, tempMax: 4, radiacionMjM2: 9 },
    ];
    expect(agruparClimaPorDia(registros).get('2026-10-01')).toEqual({
      temperaturaMedia: { valor: 15, origen: 'observado' },
      radiacionMjM2: { valor: 18, origen: 'observado' },
    });
  });

  test('entre observados, el de la consulta más reciente', () => {
    const registros: RegistroClimaDia[] = [
      { fecha: '2026-10-01', consultadoEn: '2026-10-02T12:00:00Z', esPronostico: false, tempMin: 10, tempMax: 20, radiacionMjM2: 18 },
      { fecha: '2026-10-01', consultadoEn: '2026-10-05T12:00:00Z', esPronostico: false, tempMin: 12, tempMax: 20, radiacionMjM2: 17 },
    ];
    expect(agruparClimaPorDia(registros).get('2026-10-01')?.radiacionMjM2).toEqual({ valor: 17, origen: 'observado' });
  });

  test('elige variable por variable: una fila vieja sin radiación no hace perder su temperatura observada', () => {
    const registros: RegistroClimaDia[] = [
      { fecha: '2026-10-01', consultadoEn: '2026-10-05T12:00:00Z', esPronostico: false, tempMin: 10, tempMax: 20, radiacionMjM2: null },
      { fecha: '2026-10-01', consultadoEn: '2026-09-28T12:00:00Z', esPronostico: true, tempMin: 0, tempMax: 2, radiacionMjM2: 14 },
    ];
    expect(agruparClimaPorDia(registros).get('2026-10-01')).toEqual({
      temperaturaMedia: { valor: 15, origen: 'observado' },
      radiacionMjM2: { valor: 14, origen: 'pronostico' },
    });
  });

  test('sin mínima o máxima no hay temperatura media', () => {
    const registros: RegistroClimaDia[] = [{ fecha: '2026-10-01', consultadoEn: '2026-10-02T12:00:00Z', esPronostico: false, tempMin: null, tempMax: 20, radiacionMjM2: 10 }];
    expect(agruparClimaPorDia(registros).get('2026-10-01')?.temperaturaMedia).toBeNull();
  });
});

describe('fórmulas', () => {
  test('fRFA sigue la exponencial de Pellegrini y se acota en 0,95', () => {
    expect(frfaDesdeNdvi(0.8, FRFA).valor).toBeCloseTo(0.013 * Math.exp(4.48 * 0.8), 10);
    expect(frfaDesdeNdvi(0.8, FRFA).enTope).toBe(false);
    expect(frfaDesdeNdvi(1, FRFA)).toEqual({ valor: 0.95, enTope: true });
    expect(frfaDesdeNdvi(-0.5, FRFA).valor).toBeGreaterThanOrEqual(0);
  });

  test('crecimiento = EUR × fRFA × 0,48 × radiación × 10', () => {
    expect(crecimientoDiario(1, 0.5, 0.48, 20)).toBeCloseTo(48, 10);
  });
});

describe('estimarForraje: faltantes explícitos', () => {
  test('sin tipo de pastura no estima nada y explica por qué', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: null }));
    expect(resultado.dias).toEqual([]);
    expect(resultado.reingreso).toBeNull();
    expect(resultado.mensaje).toMatch(/no tiene tipo de pastura/);
    expect(resultado.versionModelo).toBe(VERSION_MODELO);
  });

  test('pastizal natural: sin parámetros, sin tomar valores prestados', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'pastizal_natural' }));
    expect(resultado.dias).toEqual([]);
    expect(resultado.mensaje).toMatch(/Sin parámetros para Pastizal natural/);
    expect(resultado.parametrosUsados?.eur.valor).toBeNull();
  });

  test('raigrás anual: sin EUR no hay curva, pero el reingreso se estima igual', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'raigras_anual', usos: [{ fecha: '2026-10-01', fechaSalida: null }] }));
    expect(resultado.dias).toEqual([]);
    expect(resultado.mensaje).toMatch(/no se estima el crecimiento diario/);
    expect(resultado.reingreso?.criterio).not.toBeNull();
    expect(resultado.reingreso?.fechaUltimoPastoreo).toBe('2026-10-01');
  });

  test('alfalfa: hay curva, pero el reingreso dice que no tiene criterio con fuente', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa' }));
    expect(resultado.dias.length).toBe(10);
    expect(resultado.reingreso?.criterio).toBeNull();
    expect(resultado.reingreso?.mensaje).toMatch(/Sin criterio de reingreso/);
  });

  test('sin clima guardado no inventa días', () => {
    const resultado = estimarForraje(entrada({ clima: [] }));
    expect(resultado.dias).toEqual([]);
    expect(resultado.hasta).toBeNull();
    expect(resultado.mensaje).toMatch(/No hay clima guardado/);
  });

  test('nada se extiende más allá del último día con clima', () => {
    const resultado = estimarForraje(entrada({ clima: clima('2026-10-01', 4) }));
    expect(resultado.hasta).toBe('2026-10-04');
    expect(resultado.dias.at(-1)?.fecha).toBe('2026-10-04');
  });
});

describe('estimarForraje: curva de crecimiento', () => {
  test('usa el NDVI de la última imagen buena, la radiación del día y la EUR de la estación', () => {
    const resultado = estimarForraje(entrada());
    const primero = resultado.dias[0];
    expect(primero).toMatchObject({
      fecha: '2026-10-01', origen: 'proyectado', ndviUsado: 0.8, fechaImagen: '2026-09-28', diasDesdeImagen: 3,
      climaUsado: 'observado', crecimientoKgMsHaDia: esperado(EUR_FESTUCA.primavera, 0.8, 20),
      tipoAncla: 'inicio', fechaAncla: '2026-10-01', diasDesdeAncla: 0,
    });
  });

  test('el acumulado suma los crecimientos diarios desde el ancla', () => {
    const resultado = estimarForraje(entrada());
    const diario = crecimientoDiario(EUR_FESTUCA.primavera, frfaDesdeNdvi(0.8, FRFA).valor, 0.48, 20);
    expect(resultado.dias.at(-1)?.acumuladoKgMsHa).toBeCloseTo(Math.round(diario * 10 * 10) / 10, 5);
    expect(resultado.dias.at(-1)?.diasDesdeAncla).toBe(9);
  });

  test('el día de una imagen buena es "observado" y desde ahí se usa su NDVI', () => {
    const resultado = estimarForraje(entrada({ observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-05', 0.6)] }));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-05')).toMatchObject({ origen: 'observado', ndviUsado: 0.6, diasDesdeImagen: 0 });
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-06')).toMatchObject({ origen: 'proyectado', ndviUsado: 0.6, diasDesdeImagen: 1 });
  });

  test(`ignora imágenes con cobertura menor a ${COBERTURA_MINIMA_ESTIMACION} o sin NDVI`, () => {
    const resultado = estimarForraje(entrada({ observaciones: [imagen('2026-09-28', 0.8, 0.59), { fecha: '2026-09-29', ndviMediana: null, coberturaValida: 1 }] }));
    expect(resultado.dias.every((dia) => dia.origen === 'sin-dato')).toBe(true);
    expect(resultado.dias[0].motivo).toMatch(/Sin imagen Sentinel-2/);
  });

  test(`no arrastra un NDVI de más de ${MAXIMO_DIAS_SIN_IMAGEN} días`, () => {
    const resultado = estimarForraje(entrada({ observaciones: [imagen('2026-09-05', 0.8)] }));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-05')?.origen).toBe('proyectado');
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-06')).toMatchObject({ origen: 'sin-dato', crecimientoKgMsHaDia: null });
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-06')?.motivo).toMatch(/hace más de 30 días/);
  });

  test('un día sin radiación queda sin dato y el acumulado se reanuda después', () => {
    const registros = clima('2026-10-01', 10);
    registros[3].radiacionMjM2 = null;
    const resultado = estimarForraje(entrada({ clima: registros }));
    expect(resultado.dias[3]).toMatchObject({ origen: 'sin-dato', acumuladoKgMsHa: null, motivo: 'Sin radiación guardada para este día.' });
    expect(resultado.dias[4]).toMatchObject({ tipoAncla: 'reanudacion', fechaAncla: '2026-10-05', diasDesdeAncla: 0 });
    expect(resultado.dias[4].acumuladoKgMsHa).toBe(resultado.dias[4].crecimientoKgMsHaDia);
  });

  test('los días con pronóstico se marcan y llevan aviso', () => {
    const resultado = estimarForraje(entrada({ clima: clima('2026-10-01', 10, { pronosticoDesde: '2026-10-08' }) }));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-07')?.climaUsado).toBe('observado');
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-08')?.climaUsado).toBe('pronostico');
    expect(resultado.avisos.some((aviso) => aviso.includes('radiación pronosticada'))).toBe(true);
  });

  test('cambia la EUR al cambiar de estación', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa', desde: '2026-11-29', observaciones: [imagen('2026-11-28', 0.8)], clima: clima('2026-11-29', 4) }));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-11-30')?.crecimientoKgMsHaDia).toBe(esperado(EUR_ALFALFA.primavera, 0.8, 20));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-12-01')?.crecimientoKgMsHaDia).toBe(esperado(EUR_ALFALFA.verano, 0.8, 20));
  });

  test('avisa cuando la fracción absorbida llega al tope', () => {
    const resultado = estimarForraje(entrada({ observaciones: [imagen('2026-09-28', 0.99)] }));
    expect(resultado.avisos.some((aviso) => aviso.includes('tope de 0,95'))).toBe(true);
  });

  test('siempre declara que es provisional y devuelve los parámetros con sus fuentes', () => {
    const resultado = estimarForraje(entrada());
    expect(resultado.avisos[0]).toMatch(/Estimación provisional/);
    expect(resultado.parametrosUsados?.eur.fuente?.url).toContain('zenodo');
    expect(resultado.parametrosUsados?.frfa.fuente?.cita).toContain('Pellegrini');
  });
});

describe('estimarForraje: pastoreos', () => {
  test('el día del uso es "en-pastoreo" y después no hay dato hasta una imagen posterior', () => {
    const resultado = estimarForraje(entrada({
      usos: [{ fecha: '2026-10-03', fechaSalida: null }],
      observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-07', 0.4)],
    }));
    expect(resultado.dias[2]).toMatchObject({ fecha: '2026-10-03', origen: 'en-pastoreo', crecimientoKgMsHaDia: null });
    expect(resultado.dias[3]).toMatchObject({ fecha: '2026-10-04', origen: 'sin-dato' });
    expect(resultado.dias[3].motivo).toMatch(/Sin imagen posterior al pastoreo del 03\/10\/2026/);
    expect(resultado.dias[6]).toMatchObject({ fecha: '2026-10-07', origen: 'observado', ndviUsado: 0.4, tipoAncla: 'reanudacion' });
    expect(resultado.avisos.some((aviso) => aviso.includes('Después del pastoreo del 03/10/2026'))).toBe(true);
  });

  test('con una imagen al día siguiente del pastoreo, el acumulado cuenta desde el pastoreo', () => {
    const resultado = estimarForraje(entrada({
      usos: [{ fecha: '2026-10-03', fechaSalida: null }],
      observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-04', 0.4)],
    }));
    expect(resultado.dias[3]).toMatchObject({ fecha: '2026-10-04', tipoAncla: 'pastoreo', fechaAncla: '2026-10-03', diasDesdeAncla: 1 });
    expect(resultado.dias[3].acumuladoKgMsHa).toBe(resultado.dias[3].crecimientoKgMsHaDia);
  });

  test('con fecha de salida, todo el período queda "en-pastoreo" (preparado para la fase D)', () => {
    const resultado = estimarForraje(entrada({
      usos: [{ fecha: '2026-10-03', fechaSalida: '2026-10-05' }],
      observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-06', 0.4)],
    }));
    expect(resultado.dias.slice(2, 5).map((dia) => dia.origen)).toEqual(['en-pastoreo', 'en-pastoreo', 'en-pastoreo']);
    expect(resultado.dias[5]).toMatchObject({ fecha: '2026-10-06', tipoAncla: 'pastoreo', fechaAncla: '2026-10-05' });
  });
});

describe('estimarForraje: error de reinicio', () => {
  test('registra NDVI supuesto − observado cuando llega una imagen nueva', () => {
    const resultado = estimarForraje(entrada({ observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-05', 0.7)] }));
    expect(resultado.erroresReinicio).toEqual([{
      fecha: '2026-10-05', fechaImagenAnterior: '2026-09-28', diasSinImagen: 7, ndviSupuesto: 0.8, ndviObservado: 0.7, diferencia: 0.1,
    }]);
  });

  test('no lo registra si hubo un pastoreo entre las dos imágenes', () => {
    const resultado = estimarForraje(entrada({
      usos: [{ fecha: '2026-10-02', fechaSalida: null }],
      observaciones: [imagen('2026-09-28', 0.8), imagen('2026-10-05', 0.4)],
    }));
    expect(resultado.erroresReinicio).toEqual([]);
  });
});

describe('estimarReingreso: estado foliar óptimo', () => {
  const criterio = PARAMETROS_PASTURA.festuca_alta.reingreso.valor!;

  test('sin pastoreos registrados no hay desde cuándo contar', () => {
    const resultado = estimarReingreso(criterio, [], agruparClimaPorDia(clima('2026-10-01', 10)), '2026-10-05', '2026-10-10');
    expect(resultado.fechaTemprana).toBeNull();
    expect(resultado.mensaje).toMatch(/No hay pastoreos registrados/);
  });

  test('con 12 °C constantes: temprana a los 45 días (450 °Cd, base 2) y tardía a los 69 (550 °Cd, base 4)', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-07-01', 79));
    expect(resultado.fechaTemprana).toBe(sumarDias('2026-06-30', 45));
    expect(resultado.fechaTardia).toBe(sumarDias('2026-06-30', 69));
    expect(resultado.mensaje).toBeNull();
    expect(resultado.usaPronostico).toBe(false);
  });

  test('cuenta desde el último pastoreo', () => {
    const usos = [{ fecha: '2026-06-01', fechaSalida: null }, { fecha: '2026-06-30', fechaSalida: null }];
    const resultado = estimarReingreso(criterio, usos, agruparClimaPorDia(clima('2026-06-01', 110, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-06-01', 109));
    expect(resultado.fechaUltimoPastoreo).toBe('2026-06-30');
  });

  test('si no llega dentro del pronóstico, la fecha queda en null con el mensaje del horizonte', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-10-01', fechaSalida: null }], agruparClimaPorDia(clima('2026-10-02', 20, { pronosticoDesde: '2026-10-06' })), '2026-10-06', '2026-10-21');
    expect(resultado.fechaTemprana).toBeNull();
    expect(resultado.fechaTardia).toBeNull();
    expect(resultado.mensaje).toBe('No alcanza el estado foliar óptimo dentro de los 15 días con pronóstico.');
    expect(resultado.usaPronostico).toBe(true);
    expect(resultado.contadoHasta).toBe('2026-10-21');
  });

  test('un hueco de temperatura corta la cuenta y lo dice', () => {
    const registros = clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 });
    registros[10].tempMax = null;
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(registros), '2026-09-01', sumarDias('2026-07-01', 79));
    expect(resultado.fechaTemprana).toBeNull();
    expect(resultado.mensaje).toMatch(/Falta la temperatura del 11\/07\/2026/);
    expect(resultado.contadoHasta).toBe('2026-07-10');
  });

  test('cuenta desde la salida cuando existe', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-25', fechaSalida: '2026-06-30' }], agruparClimaPorDia(clima('2026-06-25', 90, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-06-25', 89));
    expect(resultado.fechaUltimoPastoreo).toBe('2026-06-30');
    expect(resultado.fechaTemprana).toBe(sumarDias('2026-06-30', 45));
  });

  test('avisa que la salida no se registra cuando el uso sólo tiene fecha', () => {
    const resultado = estimarForraje(entrada({ usos: [{ fecha: '2026-10-01', fechaSalida: null }] }));
    expect(resultado.avisos.some((aviso) => aviso.includes('La salida de los animales no se registra'))).toBe(true);
  });
});
