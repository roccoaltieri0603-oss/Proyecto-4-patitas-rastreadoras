import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
const permisos = vi.hoisted(() => ({ negados: new Set() }));
vi.mock('../../../src/hooks/useEstablecimiento.js', () => ({ useEstablecimiento: () => ({ establecimientoId: 'campo', puede: (permiso) => !permisos.negados.has(permiso) }) }));
import OrdenPastoreoPanel from '../../../src/components/OrdenPastoreoPanel.js';
import { fraseConsumible } from '../../../src/estimacion/presentacion.js';

const LEYENDA = 'Orden según los datos disponibles. La decisión es tuya.';

function ordenado(numero, grupo, posicion, cambios = {}) {
  return {
    loteId: `lote-${numero}`, numero, posicion, grupo, etapa: null, etapaEsMinimo: false, diasHastaPasado: null, progresoRebrote: null,
    pastoEnPieKgMsHa: null, consumibleKgMsHa: null, pisoPesado: false, confianza: 'media', confianzaPastoEnPie: null, falta: null,
    motivos: [`Motivo del lote ${numero}.`], ...cambios,
  };
}

const ACCIONES = { onLoteActualizado: () => {}, onPastoreoRegistrado: () => {}, onActualizarClima: () => {}, actualizandoClima: false };

function render(lotesOrdenados, lotes = []) {
  const orden = { estado: 'ok', orden: { hoy: '2026-10-23', leyenda: LEYENDA, lotes: lotesOrdenados } };
  return renderToStaticMarkup(React.createElement(OrdenPastoreoPanel, { orden, lotes, onSelectLote: () => {}, onVerOrden: () => {}, ...ACCIONES }));
}

const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('resumen del orden arriba de la lista de lotes', () => {
  test('muestra los primeros que se pueden pastorear, con su motivo y la leyenda, sin la confianza', () => {
    const html = texto(render(
      [ordenado(3, 'listo', 1), ordenado(1, 'listo', 2), ordenado(2, 'pasado', 3), ordenado(5, 'esperar-al-piso', 4), ordenado(4, 'rebrotando', 5), ordenado(6, 'sin-datos', 6)],
      [{ id: 'lote-3', apodo: 'El bajo' }],
    ));
    expect(html).toContain('1. Lote 3 — El bajo');
    expect(html).toContain('Motivo del lote 3.');
    expect(html).toContain('2. Lote 1');
    expect(html).toContain('3. Lote 2');
    expect(html).not.toContain('4. Lote 5');
    expect(html).toContain('Además: listos, pero con el piso pesado, 1 · rebrotando, 1 · sin datos para ordenar, 1');
    expect(html).not.toContain('Confianza');
    expect(html).toContain(LEYENDA);
  });

  test('si ninguno está listo lo dice, y muestra el próximo que rebrota', () => {
    const html = texto(render([ordenado(4, 'rebrotando', 1, { motivos: ['Rebrotando: 80 % del estado foliar óptimo; listo el 30/10.'] }), ordenado(2, 'en-pastoreo', 2)]));
    expect(html).toContain('Ningún lote está listo hoy.');
    expect(html).toContain('El próximo: Lote 4');
    expect(html).toContain('listo el 30/10');
    expect(html).toContain('Además: con animales, 1');
  });

  test('a los lotes que les falta un dato les ofrece cargarlo ahí mismo', () => {
    const html = texto(render([
      ordenado(3, 'listo', 1, { falta: 'ultimo-pastoreo' }),
      ordenado(2, 'rebrotando', 2),
      ordenado(5, 'sin-datos', 3, { falta: 'pastura' }),
      ordenado(6, 'sin-datos', 4, { falta: 'clima', motivos: ['No hay clima de hoy guardado: actualizá el clima del lote.'] }),
      ordenado(7, 'sin-datos', 5, { motivos: ['Sin criterio de reingreso con fuente para Alfalfa: no se puede decir si está listo.'] }),
    ]));
    // La explicación de "como mínimo" va en el círculo amarillo, no en el texto.
    expect(html).toContain('1. Lote 3 ! Motivo del lote 3.');
    expect(html).not.toContain('Como mínimo');
    expect(html).toContain('Cargar último pastoreo');
    expect(html).toContain('Les faltan datos');
    expect(html).toContain('Lote 5 Sin tipo de pastura no se puede estimar. Elegir pastura');
    expect(html).toContain('Lote 6 No hay clima de hoy guardado: actualizá el clima del lote. Actualizar clima');
    // La alfalfa no tiene nada que el usuario pueda cargar: queda en la cuenta, sin botón.
    expect(html).toContain('Además: rebrotando, 1 · sin datos para ordenar, 1');
  });

  test('muestra hasta tres lotes con datos por completar y manda el resto a Condición', () => {
    const html = texto(render([1, 2, 3, 4, 5].map((numero) => ordenado(numero, 'sin-datos', numero, { falta: 'pastura' }))));
    expect(html.match(/Elegir pastura/g)).toHaveLength(3);
    expect(html).toContain('Y 2 más: verlos en Condición');
  });

  test('sin permiso para cargarlo, dice qué falta pero no ofrece el botón', () => {
    permisos.negados = new Set(['editar_lotes', 'registrar_usos']);
    try {
      const html = texto(render([ordenado(3, 'listo', 1, { falta: 'ultimo-pastoreo' }), ordenado(5, 'sin-datos', 2, { falta: 'pastura' })]));
      expect(html).toContain('Sin tipo de pastura no se puede estimar.');
      expect(html).not.toContain('Elegir pastura');
      expect(html).not.toContain('Cargar último pastoreo');
    } finally {
      permisos.negados = new Set();
    }
  });

  test('cargando o con error, lo dice sin mostrar un orden', () => {
    const cargando = renderToStaticMarkup(React.createElement(OrdenPastoreoPanel, { orden: { estado: 'cargando' }, lotes: [], onSelectLote: () => {}, onVerOrden: () => {}, ...ACCIONES }));
    expect(cargando).toContain('Armando el orden');
    const error = renderToStaticMarkup(React.createElement(OrdenPastoreoPanel, { orden: { estado: 'error', mensaje: 'Sin conexión.' }, lotes: [], onSelectLote: () => {}, onVerOrden: () => {}, ...ACCIONES }));
    expect(texto(error)).toContain('No se pudo armar el orden de los lotes: Sin conexión.');
  });
});

describe('pasto para comer en la ficha', () => {
  const conDia = (cambios) => ({ dias: [{ fecha: '2026-10-23', biomasaEnPieKgMsHa: 2016, consumibleKgMsHa: null, motivoConsumible: null, ...cambios }] });

  test('con remanente, el número redondeado a la decena', () => {
    expect(fraseConsumible(conDia({ consumibleKgMsHa: 1034 }), '2026-10-23')).toEqual({ texto: 'Para comer: unos 1.030 kg MS/ha, dejando el remanente objetivo.', calculado: true });
  });

  test('sin remanente con fuente, el motivo; sin pasto en pie, nada', () => {
    expect(fraseConsumible(conDia({ motivoConsumible: 'Sin altura de remanente objetivo con fuente para Alfalfa con plato: no se calcula cuánto se puede comer.' }), '2026-10-23'))
      .toEqual({ texto: 'Sin altura de remanente objetivo con fuente para Alfalfa con plato: no se calcula cuánto se puede comer.', calculado: false });
    expect(fraseConsumible(conDia({ biomasaEnPieKgMsHa: null }), '2026-10-23')).toBeNull();
  });
});
