import { describe, expect, test } from 'vitest';
import { agruparClimaPorDia, type RegistroClimaDia } from '../../src/estimacion/clima.js';
import { VERSION_MODELO, estimarForraje, estimarReingreso, type EntradaEstimacion } from '../../src/estimacion/motor.js';
import { PARAMETROS_PASTURA } from '../../src/estimacion/parametros.js';
import { sumarDias } from '../../src/fechas.js';

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

function entrada(cambios: Partial<EntradaEstimacion> = {}): EntradaEstimacion {
  return {
    tipoPastura: 'festuca_alta',
    desde: '2026-10-01',
    hoy: '2026-10-10',
    clima: clima('2026-10-01', 10),
    usos: [],
    ...cambios,
  };
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

  test('el histórico completa lo que no hay observado, pero no le gana a una consulta regular', () => {
    const registros: RegistroClimaDia[] = [
      { fecha: '2026-10-01', consultadoEn: '2026-10-05T12:00:00Z', esPronostico: false, esHistorico: true, tempMin: 0, tempMax: 10, radiacionMjM2: 12 },
      { fecha: '2026-10-01', consultadoEn: '2026-10-02T12:00:00Z', esPronostico: false, tempMin: 10, tempMax: 20, radiacionMjM2: null },
      { fecha: '2026-10-01', consultadoEn: '2026-10-06T12:00:00Z', esPronostico: true, tempMin: 2, tempMax: 4, radiacionMjM2: 9 },
    ];
    expect(agruparClimaPorDia(registros).get('2026-10-01')).toEqual({
      temperaturaMedia: { valor: 15, origen: 'observado' },
      radiacionMjM2: { valor: 12, origen: 'historico' },
    });
  });

  test('sin mínima o máxima no hay temperatura media', () => {
    const registros: RegistroClimaDia[] = [{ fecha: '2026-10-01', consultadoEn: '2026-10-02T12:00:00Z', esPronostico: false, tempMin: null, tempMax: 20, radiacionMjM2: 10 }];
    expect(agruparClimaPorDia(registros).get('2026-10-01')?.temperaturaMedia).toBeNull();
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
    expect(resultado.reingreso).toBeNull();
    expect(resultado.mensaje).toMatch(/Sin parámetros para Pastizal natural/);
    expect(resultado.parametrosUsados?.reingreso.valor).toBeNull();
  });

  test('alfalfa: sin criterio de reingreso no hay etapa, pero sí los días para el pasto en pie medido', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa' }));
    expect(resultado.dias).toHaveLength(10);
    expect(resultado.dias[0].etapa).toBeNull();
    expect(resultado.dias[0].motivoEtapa).toMatch(/Sin criterio de reingreso con fuente para Alfalfa/);
    expect(resultado.reingreso?.criterio).toBeNull();
    expect(resultado.reingreso?.mensaje).toMatch(/Sin criterio de reingreso/);
    expect(resultado.mensaje).toMatch(/sólo se informa el pasto en pie/);
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

  test('no hay crecimiento diario ni NDVI en los días: el satélite no interviene', () => {
    const dia = estimarForraje(entrada({ usos: [{ fecha: '2026-09-20', fechaSalida: null }] })).dias[0];
    expect(Object.keys(dia)).not.toEqual(expect.arrayContaining(['crecimientoKgMsHaDia']));
    expect(dia).not.toHaveProperty('ndviUsado');
    expect(dia).not.toHaveProperty('acumuladoKgMsHa');
  });

  test('siempre declara que es provisional y devuelve los parámetros con sus fuentes', () => {
    const resultado = estimarForraje(entrada());
    expect(resultado.avisos[0]).toMatch(/Estimación provisional/);
    expect(resultado.parametrosUsados?.reingreso.fuente?.cita).toContain('Berone');
    expect(resultado.parametrosUsados).not.toHaveProperty('eur');
    expect(resultado.mensaje).toBeNull();
  });

  test('cada día dice de dónde sale su temperatura', () => {
    const resultado = estimarForraje(entrada({ clima: clima('2026-10-01', 10, { pronosticoDesde: '2026-10-08' }) }));
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-07')?.climaUsado).toBe('observado');
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-08')?.climaUsado).toBe('pronostico');
  });
});

describe('estimarForraje: etapa y progreso', () => {
  // Festuca: vida media foliar 450-550 °Cd y base 2-4 °C. Con 12 °C constantes suma 10 °Cd por día con base 2 y 8 con base 4.
  const CALIDO = { tempMin: 6, tempMax: 18 };
  const dia = (resultado: ReturnType<typeof estimarForraje>, fecha: string) => resultado.dias.find((item) => item.fecha === fecha)!;

  test('con fecha de salida, todo el período queda con animales', () => {
    const resultado = estimarForraje(entrada({ usos: [{ fecha: '2026-10-03', fechaSalida: '2026-10-05' }] }));
    expect(resultado.dias.slice(2, 5).map((item) => item.etapa)).toEqual(['en-pastoreo', 'en-pastoreo', 'en-pastoreo']);
    expect(dia(resultado, '2026-10-06').etapa).toBe('rebrotando');
  });

  test('lote sin pastoreos: la etapa se cuenta desde el alta como mínimo', () => {
    const resultado = estimarForraje(entrada({ fechaAlta: '2026-09-20', clima: clima('2026-09-20', 21) }));
    expect(dia(resultado, '2026-10-01')).toMatchObject({ etapa: 'rebrotando', etapaEsMinimo: true });
    expect(dia(resultado, '2026-10-01').progresoRebrote).toBeCloseTo(12 * 10 / 450, 2);
  });

  test('pasa de rebrotando a listo y de listo a pasado igual que la condición del reingreso', () => {
    const resultado = estimarForraje(entrada({
      desde: '2026-10-10', hoy: '2026-11-20',
      usos: [{ fecha: '2026-09-01', fechaSalida: '2026-09-03' }],
      clima: clima('2026-08-25', 120, CALIDO),
    }));
    // Desde el 04/09: 450 °Cd con base 2 el día 45 (18/10); 550 con base 4 el día 69 (11/11).
    expect(dia(resultado, '2026-10-17').etapa).toBe('rebrotando');
    expect(dia(resultado, '2026-10-18')).toMatchObject({ etapa: 'listo', progresoRebrote: 1 });
    expect(dia(resultado, '2026-11-11').etapa).toBe('listo');
    expect(dia(resultado, '2026-11-12')).toMatchObject({ etapa: 'pasado', etapaEsMinimo: false });
    expect(resultado.reingreso?.condiciones.find((item) => item.fecha === '2026-11-12')?.condicion).toBe('regular');
  });

  test('un hueco de temperatura corta la etapa y lo dice', () => {
    const registros = clima('2026-08-25', 40, CALIDO);
    registros.find((registro) => registro.fecha === '2026-09-10')!.tempMax = null;
    const resultado = estimarForraje(entrada({ desde: '2026-09-01', hoy: '2026-09-30', usos: [{ fecha: '2026-09-01', fechaSalida: '2026-09-03' }], clima: registros }));
    expect(dia(resultado, '2026-09-09').etapa).toBe('rebrotando');
    expect(dia(resultado, '2026-09-12').etapa).toBeNull();
    expect(dia(resultado, '2026-09-12').motivoEtapa).toMatch(/Falta la temperatura del 10\/09\/2026/);
  });
});

describe('estimarForraje: pasto en pie medido', () => {
  const medicion = (fecha: string, cambios = {}) => ({ fecha, momento: 'recorrida' as const, instrumento: 'plato' as const, alturaPromedioCm: 10, cantidadLecturas: 30, ...cambios });

  test('vale sólo el día de la medición; los siguientes dicen cuándo fue la última', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa', mediciones: [medicion('2026-10-03')] }));
    expect(resultado.dias[2]).toMatchObject({ fecha: '2026-10-03', biomasaEnPieKgMsHa: 1956, biomasaOrigen: 'medido', fechaMedicion: '2026-10-03', biomasaConfianza: 'alta' });
    expect(resultado.dias[3]).toMatchObject({ biomasaEnPieKgMsHa: null, biomasaOrigen: null });
    expect(resultado.dias[3].motivoBiomasa).toBe('El pasto en pie se conoce sólo el día que se mide; la última medición es del 03/10.');
    expect(resultado.dias[1].motivoBiomasa).toBe('Sin una medición de altura que se pueda pasar a kilos.');
    expect(resultado.mediciones).toHaveLength(1);
  });

  test('con animales en el lote y sin medición ese día, lo dice', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa', usos: [{ fecha: '2026-10-04', fechaSalida: '2026-10-05' }], mediciones: [medicion('2026-10-03')] }));
    expect(resultado.dias[3]).toMatchObject({ etapa: 'en-pastoreo', biomasaEnPieKgMsHa: null, motivoBiomasa: 'Animales en el lote.' });
  });

  test('festuca: la medición se guarda pero no se pasa a kilos', () => {
    const resultado = estimarForraje(entrada({ mediciones: [medicion('2026-10-03')] }));
    expect(resultado.mediciones[0]).toMatchObject({ kgMsHa: null });
    expect(resultado.dias[2].biomasaEnPieKgMsHa).toBeNull();
  });

  test('las avisos de cada medición llegan a la estimación', () => {
    const resultado = estimarForraje(entrada({ tipoPastura: 'alfalfa', mediciones: [medicion('2026-10-03', { cantidadLecturas: 5 })] }));
    expect(resultado.avisos.some((aviso) => aviso.startsWith('Medición del 03/10/2026: Tiene 5 lecturas'))).toBe(true);
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

  test('el resumen se congela en la fecha tardía aunque haya clima después', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-07-01', 79));
    expect(resultado.contadoHasta).toBe(resultado.fechaTardia);
    expect(resultado.gradosDiaAcumulados).toEqual({ conBaseMaxima: 69 * 8, conBaseMinima: 69 * 10 });
    expect(resultado.condiciones).toHaveLength(80);
  });

  test('condición por día con 12 °C: no apto, cuidado a una hoja (230 °Cd), perfecto en la ventana y regular después', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-07-01', 79));
    const condicion = (dias: number) => resultado.condiciones.find((dia) => dia.fecha === sumarDias('2026-06-30', dias));
    expect(condicion(22)).toMatchObject({ condicion: 'no-apto', avanceEstadoFoliar: 49 });
    expect(condicion(23)?.condicion).toBe('cuidado');
    expect(condicion(44)?.condicion).toBe('cuidado');
    expect(condicion(45)).toMatchObject({ condicion: 'perfecto', avanceEstadoFoliar: 100 });
    expect(condicion(69)?.condicion).toBe('perfecto');
    expect(condicion(70)?.condicion).toBe('regular');
  });

  test('condicionHoy es la del día de hoy y marca si usa pronóstico', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-10-01', fechaSalida: null }], agruparClimaPorDia(clima('2026-10-02', 20, { pronosticoDesde: '2026-10-06' })), '2026-10-06', '2026-10-21');
    expect(resultado.condicionHoy).toMatchObject({ fecha: '2026-10-06', condicion: 'no-apto', climaUsado: 'pronostico' });
    expect(resultado.condiciones.find((dia) => dia.fecha === '2026-10-05')?.climaUsado).toBe('observado');
    expect(resultado.condiciones.at(-1)?.fecha).toBe('2026-10-21');
  });

  test('sin condición para hoy si hoy es el día del pastoreo', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-10-06', fechaSalida: null }], agruparClimaPorDia(clima('2026-10-02', 20)), '2026-10-06', '2026-10-21');
    expect(resultado.condicionHoy).toBeNull();
    expect(resultado.condiciones[0].fecha).toBe('2026-10-07');
  });

  test('un hueco de temperatura corta también las condiciones', () => {
    const registros = clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 });
    registros[10].tempMax = null;
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(registros), '2026-09-01', sumarDias('2026-07-01', 79));
    expect(resultado.condiciones.at(-1)?.fecha).toBe('2026-07-10');
    expect(resultado.condicionHoy).toBeNull();
  });

  test('con `desde`, las condiciones empiezan en esa fecha', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-07-01', 79), '2026-08-01');
    expect(resultado.condiciones[0].fecha).toBe('2026-08-01');
    expect(resultado.condiciones[0].gradosDia.conBaseMinima).toBe(32 * 10);
  });

  test('con un pastoreo registrado cuenta desde él y no es un mínimo', () => {
    const resultado = estimarReingreso(criterio, [{ fecha: '2026-06-30', fechaSalida: null }], agruparClimaPorDia(clima('2026-06-01', 120, { tempMin: 6, tempMax: 18 })), '2026-09-01', sumarDias('2026-06-01', 119), undefined, '2026-06-01');
    expect(resultado).toMatchObject({ inicioConteo: 'pastoreo', fechaInicioConteo: '2026-07-01', esMinimo: false, fechaTemprana: sumarDias('2026-06-30', 45) });
  });

  test('sin pastoreos cuenta desde el alta, incluido ese día, como mínimo', () => {
    const resultado = estimarReingreso(criterio, [], agruparClimaPorDia(clima('2026-07-01', 80, { tempMin: 6, tempMax: 18 })), '2026-08-10', sumarDias('2026-07-01', 79), undefined, '2026-07-01');
    expect(resultado).toMatchObject({ inicioConteo: 'alta', fechaInicioConteo: '2026-07-01', esMinimo: true, fechaUltimoPastoreo: null });
    // El alta cuenta como día 1: 450 °Cd con base 2 al día 45.
    expect(resultado.fechaTemprana).toBe(sumarDias('2026-07-01', 44));
    expect(resultado.condicionHoy).toMatchObject({ fecha: '2026-08-10', condicion: 'cuidado' });
    expect(resultado.mensaje).toBeNull();
  });

  test('sin pastoreos ni alta sigue sin desde cuándo contar', () => {
    const resultado = estimarReingreso(criterio, [], agruparClimaPorDia(clima('2026-07-01', 10)), '2026-07-05', '2026-07-10', undefined, null);
    expect(resultado).toMatchObject({ esMinimo: false, inicioConteo: null, condicionHoy: null });
    expect(resultado.mensaje).toMatch(/No hay pastoreos registrados/);
  });

  test('sin pastoreos y sin clima desde el alta, el corte lo dice', () => {
    const resultado = estimarReingreso(criterio, [], agruparClimaPorDia(clima('2026-07-10', 10)), '2026-07-15', '2026-07-19', undefined, '2026-07-01');
    expect(resultado.condicionHoy).toBeNull();
    expect(resultado.mensaje).toMatch(/Falta la temperatura del 01\/07\/2026: no se pueden seguir contando grados-día desde el alta del lote \(01\/07\/2026\)/);
  });

  test('estimarForraje pasa el alta al reingreso y avisa de la regla', () => {
    const resultado = estimarForraje(entrada({ fechaAlta: '2026-10-01' }));
    expect(resultado.reingreso).toMatchObject({ esMinimo: true, fechaInicioConteo: '2026-10-01' });
    expect(resultado.avisos.some((aviso) => aviso.includes('sin uso registrado no hubo pastoreo'))).toBe(true);
    expect(resultado.avisos.some((aviso) => aviso.includes('clima histórico'))).toBe(false);
  });

  test('avisa que la salida no se registra cuando el uso sólo tiene fecha', () => {
    const resultado = estimarForraje(entrada({ usos: [{ fecha: '2026-10-01', fechaSalida: null }] }));
    expect(resultado.avisos.some((aviso) => aviso.includes('La salida de los animales no se registra'))).toBe(true);
  });
});
