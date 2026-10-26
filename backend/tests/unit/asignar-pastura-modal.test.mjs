import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
// Sin DOM: el portal devuelve el contenido tal cual y `document.body` sólo tiene que existir.
vi.mock('react-dom', async (original) => ({ ...(await original()), createPortal: (hijos) => hijos }));
vi.stubGlobal('document', { body: null });
vi.mock('../../../src/hooks/useEstablecimiento.js', () => ({ useEstablecimiento: () => ({ establecimientoId: 'campo', puede: () => true }) }));
import AsignarPasturaModal, { lotesDestino, lotesQueCambian } from '../../../src/components/AsignarPasturaModal.js';

const lote = (numero, cambios = {}) => ({ id: `l${numero}`, numero, apodo: null, activo: true, tipoPastura: null, fechaSiembra: null, favorito: false, polygon: null, createdAt: '', updatedAt: '', ...cambios });
const LOTES = [lote(3), lote(1, { tipoPastura: 'alfalfa' }), lote(2, { activo: false }), lote(4, { tipoPastura: 'festuca_alta', apodo: 'Bajo' })];
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a qué lotes va la pastura', () => {
  test('los tildados, en orden de número, sin los inactivos', () => {
    expect(lotesDestino(LOTES, ['l3', 'l1', 'l2'], false).map((item) => item.numero)).toEqual([1, 3]);
  });

  test('con "todos", todos los activos aunque no se haya tildado ninguno', () => {
    expect(lotesDestino(LOTES, [], true).map((item) => item.numero)).toEqual([1, 3, 4]);
  });

  test('avisa sólo los que ya tienen otra pastura; los vacíos y los iguales no', () => {
    const destino = lotesDestino(LOTES, [], true);
    expect(lotesQueCambian(destino, 'festuca_alta').map((item) => item.numero)).toEqual([1]);
    expect(lotesQueCambian(destino, '')).toEqual([]);
  });
});

describe('ventana de asignar pastura', () => {
  const render = (seleccionados) => renderToStaticMarkup(React.createElement(AsignarPasturaModal, { lotes: LOTES, seleccionados, onGuardado: () => {}, onCancelar: () => {} }));

  test('con lotes tildados, arranca en esos y ofrece aplicarla a todos los activos', () => {
    const html = texto(render(['l3', 'l4']));
    expect(html).toContain('Asignar pastura a varios lotes');
    expect(html).toContain('Ponérsela a todos los lotes activos (3)');
    expect(html).toContain('Si no, sólo a los 2 que tildaste.');
    expect(html).toContain('Se guarda en 2 lotes');
    expect(html).toContain('Lote 4 · Bajo');
    expect(html).not.toContain('Lote 1 ');
    expect(html).toContain('Festuca alta');
    expect(html).toContain('Pastizal natural');
  });

  test('sin lotes tildados, arranca aplicando a todos', () => {
    const html = render([]);
    expect(texto(html)).toContain('Se guarda en 3 lotes');
    expect(texto(html)).toContain('No tildaste ningún lote');
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  test('sin pastura elegida no deja guardar', () => {
    expect(render(['l3'])).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Asignar a 1 lote</);
  });
});
