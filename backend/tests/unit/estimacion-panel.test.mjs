import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
vi.mock('../../../src/hooks/useEstablecimiento.js', () => ({ useEstablecimiento: () => ({ establecimientoId: 'campo', puede: () => true }) }));
import { ContenidoEstimacion } from '../../../src/components/EstimacionForrajePanel.js';
import { esMensajeTerminal, frasePastoEnPie, fraseVentanaReingreso } from '../../../src/estimacion/presentacion.js';
import { datosDeMedicion, problemaMedicion } from '../../../src/components/CamposMedicionAltura.js';

function sumarDias(fecha, cantidad) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + cantidad)).toISOString().slice(0, 10);
}

function dia(fecha, cambios = {}) {
  return {
    fecha, climaUsado: 'observado', etapa: 'rebrotando', motivoEtapa: null, etapaEsMinimo: false, progresoRebrote: 0.5,
    biomasaEnPieKgMsHa: null, biomasaRango: null, biomasaOrigen: null, fechaMedicion: null, biomasaConfianza: null, motivoBiomasa: null,
    consumibleKgMsHa: null, motivoConsumible: null,
    ...cambios,
  };
}

const CRITERIO = { hojasVivasPorMacollo: 2.5, filocronoGradosDia: [180, 220], vidaMediaFoliarGradosDia: [450, 550], temperaturaBaseC: [2, 4] };

function reingreso(cambios = {}) {
  return {
    criterio: CRITERIO, fechaUltimoPastoreo: '2026-09-20', fechaTemprana: '2026-10-30', fechaTardia: '2026-11-08',
    gradosDiaAcumulados: null, contadoHasta: null, usaPronostico: false, condiciones: [], condicionHoy: null,
    inicioConteo: 'pastoreo', fechaInicioConteo: '2026-09-21', esMinimo: false, mensaje: null,
    ...cambios,
  };
}

const MEDICION = { id: 'm', fecha: '2026-10-20', momento: 'recorrida', instrumento: 'plato', alturaPromedioCm: 10, cantidadLecturas: 25, kgMsHa: 1956, rango: [1845, 2067], coeficienteKgPorCm: 195.6, estacion: 'primavera', validacion: { n: 55, r2: 0.64, ccc: 0.72, sesgoPorcentaje: 41 }, confianza: 'alta', avisos: [], motivo: null };

describe('textos de la estimación', () => {
  const hoy = '2026-10-23';

  test('"Listo para volver a entrar entre el X y el Y"', () => {
    expect(fraseVentanaReingreso(reingreso(), hoy)).toBe('Listo para volver a entrar entre el 30 oct y el 8 nov.');
    expect(fraseVentanaReingreso(reingreso({ esMinimo: true, inicioConteo: 'alta' }), hoy)).toBe('Listo para volver a entrar entre el 30 oct y el 8 nov, a más tardar.');
    expect(fraseVentanaReingreso(reingreso({ fechaTemprana: '2026-10-01', fechaTardia: '2026-10-10' }), hoy)).toBe('La ventana para volver a entrar fue del 1 oct al 10 oct.');
  });

  test('sin fecha, dice por qué', () => {
    expect(fraseVentanaReingreso(reingreso({ fechaTardia: null, mensaje: 'La fecha tardía no se alcanza dentro de los 15 días con pronóstico.' }), hoy))
      .toBe('Listo para volver a entrar desde el 30 oct. La fecha tardía no se alcanza dentro de los 15 días con pronóstico.');
    expect(fraseVentanaReingreso(reingreso({ fechaTemprana: null, fechaTardia: null, mensaje: 'No alcanza el estado foliar óptimo dentro de los 15 días con pronóstico.' }), hoy))
      .toBe('Sin fecha para volver a entrar: no alcanza el estado foliar óptimo dentro de los 15 días con pronóstico.');
    expect(fraseVentanaReingreso(reingreso({ criterio: null, mensaje: 'Sin criterio de reingreso con fuente verificada para Alfalfa.' }), hoy))
      .toBe('Sin criterio de reingreso con fuente verificada para Alfalfa.');
    expect(fraseVentanaReingreso(reingreso({ fechaUltimoPastoreo: hoy }), hoy)).toMatch(/pastoreo registrado hoy/);
    expect(fraseVentanaReingreso(null, hoy)).toBeNull();
  });

  test('pasto en pie medido hoy: cuánto hay, con el margen y el sesgo de la fuente', () => {
    const conMedicion = {
      dias: [dia(hoy, { biomasaEnPieKgMsHa: 1956, biomasaRango: [1845, 2067], biomasaOrigen: 'medido', fechaMedicion: hoy })],
      mediciones: [{ ...MEDICION, fecha: hoy }],
    };
    expect(frasePastoEnPie(conMedicion, hoy)).toEqual({
      principal: 'Pasto en pie: unos 1.960 kg MS/ha (entre 1.850 y 2.070 por el ajuste de la fuente), medido hoy.',
      nota: 'En la validación de la fuente, la conversión sobrestimó 41 % en primavera.',
    });
  });

  test('sin medición hoy: la última con su fecha, sin proyectarla', () => {
    expect(frasePastoEnPie({ dias: [dia(hoy)], mediciones: [MEDICION] }, hoy)).toEqual({
      principal: 'Última medición: unos 1.960 kg MS/ha el 20 oct, hace 3 días.',
      nota: 'El pasto cambia día a día: para saber cuánto hay hoy, medí de nuevo.',
    });
    expect(frasePastoEnPie({ dias: [dia(hoy)], mediciones: [] }, hoy).principal).toMatch(/Sin mediciones de altura/);
    const regla = { ...MEDICION, instrumento: 'regla', kgMsHa: null, rango: null, motivo: 'No se convierte a kilos: Sin calibración con regla para esta pastura.' };
    expect(frasePastoEnPie({ dias: [dia(hoy)], mediciones: [regla] }, hoy)).toEqual({
      principal: 'La medición del 20 oct se guardó, pero no se pasa a kilos.',
      nota: 'No se convierte a kilos: Sin calibración con regla para esta pastura.',
    });
  });

  test('los campos de medición validan antes de mandar y respetan la lectura en medios centímetros', () => {
    expect(problemaMedicion({ instrumento: '', altura: '', lecturas: '', mediosCm: false })).toBeNull();
    expect(problemaMedicion({ instrumento: 'plato', altura: '0', lecturas: '20', mediosCm: false })).toMatch(/mayor que 0/);
    expect(problemaMedicion({ instrumento: 'plato', altura: '200', lecturas: '20', mediosCm: true })).toBeNull();
    expect(problemaMedicion({ instrumento: 'regla', altura: '12', lecturas: '2.5', mediosCm: false })).toMatch(/lecturas/);
    expect(datosDeMedicion({ instrumento: 'plato', altura: '18', lecturas: '25', mediosCm: true })).toEqual({ instrumento: 'plato', alturaPromedioCm: 18, cantidadLecturas: 25, lecturaEnMediosCm: true });
    expect(datosDeMedicion({ instrumento: 'regla', altura: '12', lecturas: '25', mediosCm: true })?.lecturaEnMediosCm).toBe(false);
    expect(datosDeMedicion({ instrumento: '', altura: '', lecturas: '', mediosCm: false })).toBeNull();
  });

  test('un mensaje sin reingreso es terminal; con reingreso, no', () => {
    expect(esMensajeTerminal({ mensaje: 'Sin parámetros para Pastizal natural.', reingreso: null })).toBe(true);
    expect(esMensajeTerminal({ mensaje: 'Sin criterio de reingreso con fuente verificada para Alfalfa: sólo se informa el pasto en pie de los días con medición.', reingreso: reingreso({ criterio: null }) })).toBe(false);
    expect(esMensajeTerminal({ mensaje: null, reingreso: null })).toBe(false);
  });
});

function estimacion(cambios = {}) {
  const fuente = { cita: 'Berone, G. D.; Recavarren, P. M.; Marino, M. A. (2021).', url: 'https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/9704', nota: 'Sudeste bonaerense.' };
  return {
    versionModelo: 'forraje-8', tipoPastura: 'festuca_alta', desde: '2026-10-01', hasta: '2026-10-10',
    dias: Array.from({ length: 10 }, (_, i) => dia(sumarDias('2026-10-01', i))),
    reingreso: reingreso({ fechaTemprana: '2026-10-04', fechaTardia: '2026-10-07' }),
    mediciones: [],
    avisos: ['Estimación provisional: los parámetros salen de bibliografía y no están calibrados en este campo.'],
    mensaje: null,
    parametrosUsados: {
      pastura: 'Festuca alta',
      reingreso: { valor: CRITERIO, fuente, provisional: true },
      alturaAKg: { plato: { valor: null, fuente: { cita: 'Sin ecuación publicada: pendiente de INTA Balcarce.', url: null }, provisional: true }, regla: { valor: null, fuente: null, provisional: true } },
      remanenteObjetivoCm: { plato: { valor: null, fuente: null, provisional: true }, regla: { valor: null, fuente: null, provisional: true } },
    },
    ...cambios,
  };
}

const lote = { id: 'lote', numero: 1, apodo: null, activo: true, tipoPastura: 'festuca_alta', fechaSiembra: null };

describe('contenido del panel de estimación', () => {
  const html = (valor) => renderToStaticMarkup(React.createElement(ContenidoEstimacion, { lote, estimacion: valor, dia: '2026-10-02' }));

  test('con un mensaje terminal muestra sólo el mensaje', () => {
    const markup = html(estimacion({ dias: [], reingreso: null, avisos: [], parametrosUsados: null, mensaje: 'La base de datos todavía no tiene la migración 015: no se puede leer el tipo de pastura del lote.' }));
    expect(markup).toContain('migración 015');
    expect(markup).not.toContain('Rebrote y pasto en pie');
    expect(markup).not.toContain('Cómo se calcula');
  });

  test('con datos muestra el rebrote, el pasto en pie, los avisos y los parámetros con sus fuentes', () => {
    const markup = html(estimacion());
    expect(markup).toContain('Rebrote y pasto en pie');
    expect(markup).toContain('Listo para volver a entrar entre el 4 oct y el 7 oct.');
    expect(markup).toContain('Rebrote al 50 % (100 % es listo para entrar).');
    // Los avisos van en un círculo, no en un recuadro.
    expect(markup).toContain('aria-label="A tener en cuenta"');
    expect(markup).not.toContain('>Avisos<');
    expect(markup).toContain('Sin mediciones de altura');
    expect(markup).toContain('2,5 hojas vivas por macollo');
    expect(markup).toContain('https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/9704');
    expect(markup).toContain('El satélite no interviene.');
  });

  test('contado desde el alta no muestra el porcentaje del rebrote, y la nota va en el círculo amarillo', () => {
    const minimo = estimacion({
      dias: Array.from({ length: 10 }, (_, i) => dia(sumarDias('2026-10-01', i), { etapaEsMinimo: true, progresoRebrote: 0.05 })),
      reingreso: reingreso({
        esMinimo: true, inicioConteo: 'alta', fechaInicioConteo: '2026-09-28', fechaUltimoPastoreo: null,
        condicionHoy: { fecha: '2026-10-02', condicion: 'cuidado', avanceEstadoFoliar: 60, gradosDia: { conBaseMaxima: 200, conBaseMinima: 270 }, climaUsado: 'observado' },
      }),
    });
    const markup = html(minimo);
    expect(markup).not.toContain('Rebrote al');
    expect(markup).toContain('aria-label="Sin pastoreos registrados"');
    expect(markup).not.toContain('registrá el último para afinar');
  });

  test('no muestra crecimiento diario, NDVI ni gráfico', () => {
    const markup = html(estimacion());
    expect(markup).not.toContain('<svg');
    expect(markup).not.toMatch(/Creció|crecimiento por día|NDVI|Sentinel-2|Eficiencia de uso de la radiación/i);
  });
});
