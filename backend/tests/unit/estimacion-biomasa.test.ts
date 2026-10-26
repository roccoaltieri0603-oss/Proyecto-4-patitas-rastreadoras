import { describe, expect, test } from 'vitest';
import { biomasaPorDia, consumibleDelDia, convertirMedicion, type MedicionAltura } from '../../src/estimacion/biomasa.js';
import { VERSION_MODELO, estimarForraje } from '../../src/estimacion/motor.js';
import { PARAMETROS_PASTURA } from '../../src/estimacion/parametros.js';
import { sumarDias } from '../../src/fechas.js';

function medicion(cambios: Partial<MedicionAltura> = {}): MedicionAltura {
  return { fecha: '2026-10-12', momento: 'recorrida', instrumento: 'plato', alturaPromedioCm: 10, cantidadLecturas: 25, ...cambios };
}
const alfalfa = PARAMETROS_PASTURA.alfalfa.alturaAKg;
const avena = PARAMETROS_PASTURA.avena.alturaAKg;

describe('altura → kg MS/ha (Ojeda et al. 2021, RIA 47(1), Tabla 2)', () => {
  test('plato en alfalfa, primavera: 195,6 kg/cm con su intervalo y la validación publicada', () => {
    expect(convertirMedicion(medicion(), alfalfa.plato)).toMatchObject({
      kgMsHa: 1956, rango: [1845, 2067], coeficienteKgPorCm: 195.6, estacion: 'primavera', confianza: 'alta', avisos: [],
      validacion: { n: 55, r2: 0.64, sesgoPorcentaje: 41 },
    });
  });

  test('cada estación usa su coeficiente', () => {
    expect(convertirMedicion(medicion({ fecha: '2026-04-10' }), alfalfa.plato).kgMsHa).toBe(1530);
    expect(convertirMedicion(medicion({ fecha: '2026-07-10' }), alfalfa.plato).kgMsHa).toBe(1796);
    expect(convertirMedicion(medicion({ fecha: '2026-01-10' }), alfalfa.plato).kgMsHa).toBe(1942);
  });

  test('verdeos: primavera con n = 6 usa el anual; verano no se midió, con confianza baja', () => {
    expect(convertirMedicion(medicion({ fecha: '2026-10-12' }), avena.plato)).toMatchObject({ kgMsHa: 1519, confianza: 'alta' });
    expect(convertirMedicion(medicion({ fecha: '2026-10-12' }), avena.plato).avisos[0]).toMatch(/pocos datos: se usa su coeficiente anual/);
    expect(convertirMedicion(medicion({ fecha: '2026-01-12' }), avena.plato)).toMatchObject({ kgMsHa: 1519, confianza: 'baja' });
    expect(convertirMedicion(medicion({ fecha: '2026-05-12' }), avena.plato).kgMsHa).toBe(1495);
  });

  test('menos de 20 lecturas o fuera del rango calibrado: se calcula igual, con aviso y confianza baja', () => {
    const pocas = convertirMedicion(medicion({ cantidadLecturas: 8 }), alfalfa.plato);
    expect(pocas).toMatchObject({ kgMsHa: 1956, confianza: 'baja' });
    expect(pocas.avisos[0]).toMatch(/8 lecturas/);
    const alta = convertirMedicion(medicion({ alturaPromedioCm: 18 }), alfalfa.plato);
    expect(alta.confianza).toBe('baja');
    expect(alta.avisos[0]).toMatch(/fuera del rango con que se calibró la conversión \(3 a 15,5 cm\)/);
  });

  test('sin fuente no hay kilos: la regla en alfalfa, y festuca y agropiro, pedidos a INTA Balcarce', () => {
    expect(convertirMedicion(medicion({ instrumento: 'regla' }), alfalfa.regla)).toMatchObject({ kgMsHa: null, confianza: null });
    const festuca = convertirMedicion(medicion(), PARAMETROS_PASTURA.festuca_alta.alturaAKg.plato);
    expect(festuca.kgMsHa).toBeNull();
    expect(festuca.motivo).toMatch(/pendiente de INTA Balcarce/);
    expect(PARAMETROS_PASTURA.festuca_alta.alturaAKg.plato.fuente?.nota).toMatch(/615 kg MS\/ha con plato y 687 con regla/);
    expect(PARAMETROS_PASTURA.pastizal_natural.alturaAKg.plato.valor).toBeNull();
  });
});

describe('pasto en pie: sólo el día de la medición', () => {
  const medida = convertirMedicion(medicion({ fecha: '2026-10-01' }), alfalfa.plato);

  test('el día de la medición es lo medido; los siguientes no se proyectan y dicen cuándo fue la última', () => {
    const porFecha = biomasaPorDia(['2026-10-01', '2026-10-02', '2026-10-03'], [medida]);
    expect(porFecha.get('2026-10-01')).toMatchObject({ biomasaEnPieKgMsHa: 1956, biomasaRango: [1845, 2067], biomasaOrigen: 'medido', fechaMedicion: '2026-10-01', biomasaConfianza: 'alta' });
    expect(porFecha.get('2026-10-03')).toMatchObject({ biomasaEnPieKgMsHa: null, biomasaOrigen: null, motivoBiomasa: 'El pasto en pie se conoce sólo el día que se mide; la última medición es del 01/10.' });
  });

  test('antes de la primera medición dice que falta una', () => {
    expect(biomasaPorDia(['2026-09-30'], [medida]).get('2026-09-30')?.motivoBiomasa).toBe('Sin una medición de altura que se pueda pasar a kilos.');
  });

  test('con dos mediciones el mismo día, la de más lecturas', () => {
    const otra = convertirMedicion(medicion({ fecha: '2026-10-01', alturaPromedioCm: 9, cantidadLecturas: 40 }), alfalfa.plato);
    expect(biomasaPorDia(['2026-10-01'], [medida, otra]).get('2026-10-01')?.biomasaEnPieKgMsHa).toBe(1760);
  });

  test('una medición sin conversión no da pasto en pie', () => {
    const regla = convertirMedicion(medicion({ fecha: '2026-10-01', instrumento: 'regla' }), alfalfa.regla);
    expect(biomasaPorDia(['2026-10-01', '2026-10-02'], [regla]).get('2026-10-01')?.biomasaEnPieKgMsHa).toBeNull();
  });
});

describe('pasto en pie dentro de la estimación', () => {
  const clima = (desde: string, cantidad: number) => Array.from({ length: cantidad }, (_, i) => ({
    fecha: sumarDias(desde, i), consultadoEn: '2026-10-22T12:00:00Z', esPronostico: false, tempMin: 8, tempMax: 16, radiacionMjM2: 20,
  }));

  test('la medición al sacar los animales vale ese día, aunque haya animales', () => {
    const resultado = estimarForraje({
      tipoPastura: 'alfalfa', desde: '2026-10-01', hoy: '2026-10-20',
      clima: clima('2026-09-25', 26),
      usos: [{ fecha: '2026-10-02', fechaSalida: '2026-10-04' }],
      mediciones: [medicion({ fecha: '2026-10-04', momento: 'salida', alturaPromedioCm: 5 })],
    });
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-04')).toMatchObject({ etapa: 'en-pastoreo', biomasaEnPieKgMsHa: 978, biomasaOrigen: 'medido' });
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-05')?.biomasaEnPieKgMsHa).toBeNull();
    expect(resultado.dias.find((dia) => dia.fecha === '2026-10-03')?.biomasaEnPieKgMsHa).toBeNull();
    expect(resultado.versionModelo).toBe(VERSION_MODELO);
  });

  test('una medición anterior a "desde" no entra', () => {
    const resultado = estimarForraje({
      tipoPastura: 'avena', desde: '2026-06-01', hoy: '2026-06-10',
      clima: clima('2026-06-01', 10), usos: [], fechaAlta: '2026-05-01',
      mediciones: [medicion({ fecha: '2026-05-25' }), medicion({ fecha: '2026-06-03' })],
    });
    expect(resultado.mediciones.map((item) => item.fecha)).toEqual(['2026-06-03']);
    expect(resultado.dias.find((dia) => dia.fecha === '2026-06-03')?.biomasaEnPieKgMsHa).toBe(1542);
    expect(resultado.dias.find((dia) => dia.fecha === '2026-06-04')?.biomasaEnPieKgMsHa).toBeNull();
  });
});

describe('pasto para comer', () => {
  const medida = convertirMedicion(medicion(), alfalfa.plato);
  const enPie = (kg: number | null) => ({ biomasaEnPieKgMsHa: kg, biomasaRango: null, biomasaOrigen: 'medido' as const, fechaMedicion: '2026-10-12', biomasaConfianza: 'alta' as const, motivoBiomasa: null });
  // Un remanente de prueba: ninguna pastura tiene hoy uno con fuente.
  const remanente = { plato: { valor: 5, fuente: null, provisional: true }, regla: { valor: null, fuente: null, provisional: true } };

  test('sin remanente con fuente no se calcula, y lo dice', () => {
    expect(consumibleDelDia('2026-10-14', enPie(1956), [medida], PARAMETROS_PASTURA.alfalfa.remanenteObjetivoCm, alfalfa, 'Alfalfa')).toEqual({
      consumibleKgMsHa: null, motivoConsumible: 'Sin altura de remanente objetivo con fuente para Alfalfa con plato: no se calcula cuánto se puede comer.',
    });
    expect(consumibleDelDia('2026-10-14', enPie(null), [medida], remanente, alfalfa, 'Alfalfa').motivoConsumible).toBe('Sin pasto en pie: hace falta una medición de altura.');
  });

  test('con remanente, es el pasto en pie menos el remanente con el coeficiente de la estación, nunca negativo', () => {
    expect(consumibleDelDia('2026-10-14', enPie(1956), [medida], remanente, alfalfa, 'Alfalfa').consumibleKgMsHa).toBe(978);
    expect(consumibleDelDia('2026-10-14', enPie(800), [medida], remanente, alfalfa, 'Alfalfa').consumibleKgMsHa).toBe(0);
  });

  test('sin conversión para el instrumento de la medición, no se calcula', () => {
    const regla = convertirMedicion(medicion({ instrumento: 'regla' }), alfalfa.regla);
    expect(consumibleDelDia('2026-10-14', enPie(1956), [{ ...regla, kgMsHa: 1956 }], remanente, alfalfa, 'Alfalfa').consumibleKgMsHa).toBeNull();
  });
});
