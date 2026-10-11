import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const eid = '00000000-0000-4000-8000-000000000001';
const propietario = '00000000-0000-4000-8000-000000000002';
const puestoPropietario = '00000000-0000-4000-8000-000000000003';
const puestoAdmin = '00000000-0000-4000-8000-000000000004';
const sesion = '00000000-0000-4000-8000-000000000005';
const mock = vi.hoisted(() => ({ query: vi.fn(), evento: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query } }));
vi.mock('../../src/services/equipo.js', () => ({
  transaccion: (fn: (db: { query: typeof mock.query }) => Promise<unknown>) => fn({ query: mock.query }),
}));
vi.mock('../../src/services/notificaciones.js', () => ({
  registrarEventoAdministrativo: mock.evento,
  notificarResponsableGpsSiHayIncidencia: vi.fn(),
}));
import { aceptarInvitacionPuesto, cambiarPermisosPuesto, crearPuestoAdministrador, generarInvitacionPuesto } from '../../src/services/puestos.js';

const actor: Membresia = { establecimientoId: eid, userId: propietario, puestoOperativoId: puestoPropietario,
  sesionOperativaId: sesion, nombreOperativo: 'Propietario', rol: 'PROPIETARIO', principal: true,
  permisos: [], capacidades: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('FROM puestos_operativos WHERE id = $1')) {
      return { rows: [values[1] === eid && values[0] === puestoPropietario ? {
        id: puestoPropietario, establecimiento_id: eid, nombre: 'Propietario', rol: 'PROPIETARIO',
        propietario_user_id: propietario, legacy_user_id: null, permisos: [], capacidades: [], activo: true,
      } : values[1] === eid && values[0] === puestoAdmin ? {
        id: puestoAdmin, establecimiento_id: eid, nombre: 'Administrador de lotes', rol: 'ADMINISTRADOR',
        propietario_user_id: null, legacy_user_id: null, permisos: ['crear_lotes'], capacidades: [], activo: true,
      } : null].filter(Boolean) };
    }
    if (sql.includes('FROM sesiones_operativas WHERE id')) return { rows: [{ id: sesion }] };
    if (sql.includes('SELECT principal_user_id FROM establecimientos')) return { rows: [{ principal_user_id: propietario }] };
    if (sql.includes('INSERT INTO puestos_operativos')) return { rows: [{ id: puestoAdmin }] };
    if (sql.includes('INSERT INTO invitaciones')) return { rows: [{ id: 'inv-1', expires_at: new Date() }] };
    return { rows: [], rowCount: 1 };
  });
});

describe('puestos operativos y permisos compartidos', () => {
  test('crea un puesto administrador separado sin permisos por persona', async () => {
    const id = await crearPuestoAdministrador(actor, { nombre: 'Administrador de lotes', permisos: ['crear_lotes'] });
    expect(id).toBe(puestoAdmin);
    const insert = mock.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO puestos_operativos'))!;
    expect(insert[1]).toEqual([eid, 'Administrador de lotes', ['crear_lotes']]);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE membresias'))).toBe(false);
  });

  test('modificar un permiso cambia el puesto completo y audita sólo el cambio efectivo', async () => {
    await cambiarPermisosPuesto(actor, puestoAdmin, { rol: 'ADMINISTRADOR', permisos: ['crear_lotes', 'editar_lotes'] });
    expect(mock.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE puestos_operativos SET permisos'),
      [puestoAdmin, ['crear_lotes', 'editar_lotes'], []],
    );
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE integrantes_puesto'))).toBe(false);
    expect(mock.evento).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorPuestoId: puestoPropietario, afectadoPuestoId: puestoAdmin,
      mensaje: 'El Propietario principal le otorgó al puesto Administrador de lotes el permiso de editar información de lotes.',
      detalles: expect.objectContaining({ permisosAgregados: ['editar_lotes'], permisosRetirados: [] }),
    }));
  });

  test('un cambio inexistente no registra evento', async () => {
    await cambiarPermisosPuesto(actor, puestoAdmin, { rol: 'ADMINISTRADOR', permisos: ['crear_lotes'] });
    expect(mock.evento).not.toHaveBeenCalled();
  });

  test('el código invita al puesto concreto y guarda una instantánea de permisos', async () => {
    const invitacion = await generarInvitacionPuesto(actor, { puestoOperativoId: puestoAdmin });
    expect(invitacion.codigo).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const insert = mock.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO invitaciones'))!;
    expect(insert[1]?.[4]).toBe(puestoAdmin);
    expect(insert[1]?.[6]).toEqual(['crear_lotes']);
    expect(String(insert[1]?.[3])).not.toBe(invitacion.codigo);
  });

  test('acepta un código pegado con espacios y saltos de línea sin alterar el hash', async () => {
    const miembro = '00000000-0000-4000-8000-000000000006';
    const codigo = 'A'.repeat(32);
    const hash = createHash('sha256').update(codigo).digest('hex');
    const puestoOwner = { id: puestoPropietario, establecimiento_id: eid, nombre: 'Propietario', rol: 'PROPIETARIO',
      permisos: [], capacidades: [], propietario_user_id: propietario, legacy_user_id: null, predeterminado: true, activo: true };
    const puestoDestino = { id: puestoAdmin, establecimiento_id: eid, nombre: 'Administrador norte', rol: 'ADMINISTRADOR',
      permisos: ['crear_lotes'], capacidades: [], propietario_user_id: null, legacy_user_id: null, predeterminado: true, activo: true };
    const invitacion = { id: 'invitacion-1', establecimiento_id: eid, created_by: propietario,
      creador_puesto_operativo_id: puestoPropietario, codigo_hash: hash, puesto_operativo_id: puestoAdmin,
      rol: 'ADMINISTRADOR', permisos: ['crear_lotes'], capacidades: [], used_at: null,
      expires_at: new Date(Date.now() + 60_000), vigente: true };
    mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT establecimiento_id FROM invitaciones')) return { rows: [{ establecimiento_id: eid }] };
      if (sql.includes('SELECT *, expires_at > clock_timestamp()')) return { rows: [invitacion] };
      if (sql.includes('FROM puestos_operativos WHERE id = $1') && sql.includes('FOR UPDATE')) {
        const fila = values[0] === puestoAdmin ? puestoDestino : values[0] === puestoPropietario ? puestoOwner : null;
        return { rows: fila && values[1] === eid ? [fila] : [] };
      }
      if (sql.includes('SELECT principal_user_id FROM establecimientos')) return { rows: [{ principal_user_id: propietario }] };
      if (sql.includes('SELECT 1 FROM integrantes_puesto WHERE puesto_operativo_id = $1 AND user_id = $2')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    await expect(aceptarInvitacionPuesto(miembro, ` \n${codigo.slice(0, 10)}\t${codigo.slice(10)}\r\n`))
      .resolves.toEqual({ establecimientoId: eid, puestoOperativoId: puestoAdmin });
    expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('WHERE codigo_hash = $1'), [hash]);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO integrantes_puesto'))).toBe(true);
  });
});
