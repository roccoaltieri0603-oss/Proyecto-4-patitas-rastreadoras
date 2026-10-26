import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import PersonalNotifications from '../../../src/components/PersonalNotifications.js';
import { agruparAvisosPersonales, agruparEstablecimientos } from '../../../src/utils/notificaciones-personales.js';

const miembro = (puestoOperativoId) => ({
  establecimientoId: 'campo-a', userId: 'user-a', puestoOperativoId, nombreOperativo: 'Administrador',
  rol: 'ADMINISTRADOR', principal: false, permisos: [], capacidades: [],
});
const campo = (puestoOperativoId) => ({ id: 'campo-a', nombre: 'Los Álamos',
  onboardingCompleted: true, membresia: miembro(puestoOperativoId) });
function aviso(id, establecimientoId, createdAt, tipo = 'ingreso_forzado') {
  return { id, establecimientoId, establecimientoNombre: establecimientoId === 'campo-a' ? 'Los Álamos' : 'La Loma',
    tipo, titulo: 'Ingreso forzado a tu puesto', mensaje: 'Juan forzó el ingreso al puesto Administrador.',
    createdAt, leida: false, readAt: null, loteId: null, metadata: {} };
}

describe('presentación de avisos personales por establecimiento', () => {
  test('agrupa varios puestos bajo un mismo campo y separa otros establecimientos por ID', () => {
    const grupos = agruparEstablecimientos([campo('puesto-a'), campo('puesto-a2')]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].membresias).toHaveLength(2);

    const agrupados = agruparAvisosPersonales([
      aviso('viejo', 'campo-a', '2026-10-09T10:00:00Z'),
      aviso('otro-campo', 'campo-b', '2026-10-11T10:00:00Z'),
      aviso('nuevo', 'campo-a', '2026-10-10T10:00:00Z'),
      aviso('no-visible', 'campo-a', '2026-10-12T10:00:00Z', 'invitacion_aceptada'),
      aviso('nuevo', 'campo-a', '2026-10-10T10:00:00Z'),
    ], new Set(grupos.map((item) => item.id)));

    expect(agrupados.visibles.get('campo-a')?.map((item) => item.id)).toEqual(['no-visible', 'nuevo', 'viejo']);
    expect(agrupados.visibles.has('campo-b')).toBe(false);
    expect(agrupados.sinAcceso.get('campo-b')?.map((item) => item.id)).toEqual(['otro-campo']);
  });

  test('no renderiza un panel vacío para un establecimiento sin avisos', () => {
    const html = renderToStaticMarkup(React.createElement(PersonalNotifications, {
      items: [], establecimientoNombre: 'Los Álamos', accionando: false,
      marcarLeida: async () => undefined, eliminarLeida: async () => undefined,
    }));
    expect(html).toBe('');
  });

  test('un aviso huérfano informa que no restablece permisos y conserva lectura/ocultación', () => {
    const html = renderToStaticMarkup(React.createElement(PersonalNotifications, {
      items: [aviso('huerfano', 'campo-b', '2026-10-11T10:00:00Z')], establecimientoNombre: 'La Loma', sinAcceso: true,
      accionando: false, marcarLeida: async () => undefined, eliminarLeida: async () => undefined,
    }));
    expect(html).toContain('ya no está en tu lista de establecimientos');
    expect(html).toContain('no restablece el acceso');
    expect(html).toContain('Marcar leído');
    const leido = renderToStaticMarkup(React.createElement(PersonalNotifications, {
      items: [{ ...aviso('leido', 'campo-b', '2026-10-11T10:00:00Z'), leida: true }], establecimientoNombre: 'La Loma',
      accionando: false, marcarLeida: async () => undefined, eliminarLeida: async () => undefined,
    }));
    expect(leido).toContain('Ocultar');
  });
});
