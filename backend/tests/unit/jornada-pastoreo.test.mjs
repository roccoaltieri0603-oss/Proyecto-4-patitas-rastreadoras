import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
vi.mock('../../../src/hooks/useEstablecimiento.js', () => ({ useEstablecimiento: () => ({ establecimientoId: 'campo', puede: () => true }) }));
import JornadaPastoreoPanel, { instanteDe, momentoDe, problemaAnimales, problemaMomento, problemaSalida } from '../../../src/components/JornadaPastoreoPanel.js';

const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function render(props) {
  return renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(JornadaPastoreoPanel, { loteId: 'lote', ultimoUso: null, diasDescanso: null, onCambio: () => {}, ...props })));
}

const abierta = {
  id: 'uso', loteId: 'lote', fecha: '2026-10-20', origen: 'manual', createdAt: '2026-10-20T10:00:00.000Z', ingresoAt: '2026-10-20T10:00:00.000Z', salidaAt: null,
  enCurso: true, fechaFin: '2026-10-24', diasOcupacion: null, alturaRemanenteCm: null, animales: { adultos: 40, toretesVaconas: null, terneros: null },
};

describe('validaciones del pastoreo', () => {
  test('un pastoreo terminado con salida después de la entrada pasa: el caso que el navegador bloqueaba', () => {
    const entrada = { fecha: '2026-10-20', hora: '10:00' };
    expect(problemaMomento(entrada, 'entraron los animales')).toBeNull();
    expect(problemaSalida({ fecha: '2026-10-23', hora: '08:30' }, instanteDe(entrada))).toBeNull();
    expect(problemaSalida({ fecha: '2026-10-20', hora: '10:30' }, instanteDe(entrada))).toBeNull();
  });

  test('una salida igual o anterior a la entrada se explica con la entrada', () => {
    const entrada = instanteDe({ fecha: '2026-10-20', hora: '10:00' });
    expect(problemaSalida({ fecha: '2026-10-20', hora: '10:00' }, entrada)).toMatch(/^La salida tiene que ser después de la entrada \(20 oct/);
    expect(problemaSalida({ fecha: '2026-10-19', hora: '18:00' }, entrada)).toMatch(/después de la entrada/);
  });

  test('pide día y hora completos y rechaza lo futuro', () => {
    expect(problemaMomento({ fecha: '', hora: '' }, 'entraron los animales')).toBe('Completá el día y la hora en que entraron los animales.');
    expect(problemaMomento({ fecha: '2026-10-20', hora: '' }, 'salieron los animales')).toBe('Completá el día y la hora en que salieron los animales.');
    const manana = momentoDe(new Date(Date.now() + 2 * 86_400_000));
    expect(problemaMomento(manana, 'salieron los animales')).toBe('El momento en que salieron los animales no puede ser futuro.');
    expect(problemaMomento(momentoDe(new Date()), 'entraron los animales')).toBeNull();
  });

  test('al menos un animal, en enteros; las otras categorías pueden quedar vacías', () => {
    expect(problemaAnimales({ adultos: '', toretesVaconas: '', terneros: '' })).toMatch(/al menos una categoría/);
    expect(problemaAnimales({ adultos: '40', toretesVaconas: '', terneros: '' })).toBeNull();
    expect(problemaAnimales({ adultos: '4.5', toretesVaconas: '', terneros: '' })).toMatch(/número entero/);
  });
});

describe('panel de pastoreo', () => {
  test('sin animales adentro ofrece entrar o cargar un pastoreo terminado, sin formularios abiertos', () => {
    const html = texto(render({}));
    expect(html).toContain('Sin pastoreos registrados');
    expect(html).toContain('Entraron animales');
    expect(html).toContain('Cargar un pastoreo que ya terminó');
    expect(html).not.toContain('¿Cuándo entraron?');
  });

  test('con animales adentro ofrece sólo la salida', () => {
    const html = texto(render({ ultimoUso: abierta }));
    expect(html).toContain('Hay animales en el lote');
    expect(html).toContain('Salieron los animales');
    expect(html).not.toContain('Entraron animales');
  });

  test('desde el orden abre el pastoreo terminado, con día y hora separados y sin límites del navegador', () => {
    const html = render({ enfocarPastoreoTerminado: true });
    expect(texto(html)).toContain('¿Cuándo entraron?');
    expect(texto(html)).toContain('¿Cuándo salieron?');
    expect(texto(html)).toContain('Registrar sólo el día');
    expect(html).not.toContain('datetime-local');
    expect(html).toMatch(/<form novalidate=""/);
    expect(html).not.toMatch(/type="(date|time)"[^>]*\s(min|max)=/);
  });
});
