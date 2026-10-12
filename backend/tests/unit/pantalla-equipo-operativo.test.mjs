import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { EditorPuesto } from '../../../src/pages/PantallaEquipoOperativo.js';
import { referenciaPuesto } from '../../../src/utils/puestos.js';

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
    expect(detalles).toContain('ID del puesto: PUESTO-A');
    expect(detalles).toContain('ID completo del puesto: puesto-admin-norte');
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

  test('identifica de forma distinta puestos con el mismo nombre', () => {
    const norte = referenciaPuesto('12345678-abcd-4abc-8abc-123456789012');
    const sur = referenciaPuesto('87654321-abcd-4abc-8abc-123456789012');
    expect(norte).not.toBe(sur);
  });
});
