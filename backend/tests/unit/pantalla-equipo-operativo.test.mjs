import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ useEstablecimiento: vi.fn() }));
vi.mock('../../../src/hooks/useEstablecimiento.js', () => ({ useEstablecimiento: mocks.useEstablecimiento }));
import PantallaEquipoOperativo, { EditorPuesto } from '../../../src/pages/PantallaEquipoOperativo.js';

const guardar = async () => undefined;

function render(rol, nombre, id) {
  const puesto = {
    id,
    establecimiento_id: 'establecimiento-test',
    nombre,
    rol,
    permisos: rol === 'ADMINISTRADOR' ? ['crear_lotes'] : [],
    capacidades: rol === 'PROPIETARIO' ? ['modificar_propietarios'] : [],
    propietario_user_id: rol === 'PROPIETARIO' ? 'usuario-test' : null,
    predeterminado: true,
    integrantes: [],
  };
  return renderToStaticMarkup(React.createElement(EditorPuesto, { puesto, guardar, bloqueado: false }));
}

describe('opciones avanzadas de puestos operativos', () => {
  test('el Administrador muestra sus permisos dentro de opciones del puesto identificado', () => {
    const html = render('ADMINISTRADOR', 'Administración norte', 'puesto-admin-norte');
    const detalles = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(detalles).toContain('Opciones avanzadas · Administración norte');
    expect(detalles).toContain('data-puesto-operativo-id="puesto-admin-norte"');
    expect(detalles).not.toContain('ID del puesto');
    expect(detalles).not.toContain('identificador');
    expect(detalles).not.toContain('PUESTO-A');
    expect(detalles).toContain('Crear lotes');
    expect(detalles).toContain('Los cambios afectan solamente a los integrantes de este puesto');
    expect(detalles.match(/type="checkbox"/g)).toHaveLength(19);
  });

  test('el Propietario conserva sus capacidades dentro de opciones avanzadas', () => {
    const html = render('PROPIETARIO', 'Propietario principal', 'puesto-owner');
    const detalles = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(detalles).toContain('Opciones avanzadas · Propietario principal');
    expect(detalles.match(/type="checkbox"/g)?.length).toBeGreaterThan(0);
  });

  test('el Visor explica que no tiene opciones configurables', () => {
    const html = render('VISOR', 'Visores', 'puesto-visor');
    expect(html).toContain('Opciones avanzadas · Visores');
    expect(html).toContain('Este puesto no tiene opciones configurables por ahora.');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Guardar configuración');
  });

  test('conserva el ID interno en el DOM sin mostrar códigos y simplifica la cuenta activa', () => {
    const id = '12345678-abcd-4abc-8abc-123456789012';
    const markup = render('ADMINISTRADOR', 'Administración norte', id);
    expect(markup).toContain(`data-puesto-operativo-id="${id}"`);
    const textoVisible = markup.replace(/<[^>]*>/gu, '');
    expect(textoVisible).not.toContain('12345678');
    expect(textoVisible).not.toContain('identificador');

    mocks.useEstablecimiento.mockReturnValue({
      establecimientoId: 'establecimiento-test', establecimiento: { nombre: 'Los Álamos' },
      membresia: { rol: 'ADMINISTRADOR', nombreOperativo: 'Administrador', puestoOperativoId: id, permisos: [], principal: false },
      recargar: vi.fn(),
    });
    const pantalla = renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(PantallaEquipoOperativo)));
    expect(pantalla).toContain('Cuenta activa: Administrador');
    expect(pantalla).not.toContain('Puesto 12345678');
    expect(pantalla).not.toContain('identificador');
  });
});
