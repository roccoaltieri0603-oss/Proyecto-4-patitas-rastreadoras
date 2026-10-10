import { describe, expect, test, vi } from 'vitest';
import {
  mantenerIncidenciaActiva,
  notificarResponsableGpsSiHayIncidencia,
  registrarEventoAdministrativo,
  resolverIncidencia,
} from '../../src/services/notificaciones.js';

const eid = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';

function baseQuery(handlers: Array<(sql: string, values: unknown[]) => unknown>) {
  return vi.fn(async (sql: string, values: unknown[] = []) => {
    for (const handler of handlers) {
      const result = handler(sql, values);
      if (result !== undefined) return result;
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('servicio central de notificaciones', () => {
  test('audita el evento una sola vez y obtiene propietarios y administradores sólo con el permiso requerido', async () => {
    let eventoInsertado = false;
    const entregasRegistradas = new Set<string>();
    const db = { query: baseQuery([
      (sql) => sql.includes('INSERT INTO eventos_establecimiento')
        ? (eventoInsertado ? { rows: [] } : (eventoInsertado = true, { rows: [{ id: 'evento-1' }] }))
        : undefined,
      (sql) => sql.includes('SELECT id FROM eventos_establecimiento') ? { rows: [{ id: 'evento-1' }] } : undefined,
      (sql) => sql.includes('SELECT DISTINCT m.user_id') ? { rows: [{ user_id: 'owner-2' }, { user_id: 'admin-con-permiso' }, { user_id: 'admin-afectado' }] } : undefined,
      (sql, values) => {
        if (!sql.includes('INSERT INTO entregas_eventos_notificacion')) return undefined;
        const clave = `${values[0]}:${values[1]}`;
        if (entregasRegistradas.has(clave)) return { rows: [] };
        entregasRegistradas.add(clave);
        return { rows: [{ evento_id: String(values[0]) }] };
      },
      (sql) => sql.includes('INSERT INTO notificaciones') ? { rows: [{ id: 'notificacion-1' }] } : undefined,
    ]) };
    const evento = {
      idempotencyId: 'evento-1',
      establecimientoId: eid, tipo: 'permisos_modificados', actorId: actor, afectadoId: 'admin-afectado',
      titulo: 'Permisos modificados', mensaje: 'Se retiró eliminar lotes.', permisoDestinatario: 'gestionar_administradores',
      incluirAfectadoAdministrador: true, excluirAutor: true,
      detalles: { permisosRetirados: ['eliminar_lotes'] },
    } as const;
    await registrarEventoAdministrativo(db as never, evento);
    await registrarEventoAdministrativo(db as never, evento);
    const consultasDestinatarios = db.query.mock.calls.filter(([sql]) => String(sql).includes('SELECT DISTINCT m.user_id'));
    const consultaDestinatarios = consultasDestinatarios[0];
    expect(consultaDestinatarios[1]).toEqual([eid, 'gestionar_administradores', 'admin-afectado', actor]);
    expect(String(consultaDestinatarios[0])).toContain("m.rol = 'PROPIETARIO'");
    expect(String(consultaDestinatarios[0])).toContain("m.rol = 'ADMINISTRADOR'");
    expect(String(consultaDestinatarios[0])).toContain('ANY(m.permisos)');
    expect(String(consultaDestinatarios[0])).not.toContain("m.rol = 'VISOR'");
    const entregas = db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO entregas_eventos_notificacion'));
    expect(entregas).toHaveLength(6);
    expect(entregas.filter(([, values]) => values?.[0] === 'evento-1')).toHaveLength(6);
    const notificaciones = db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notificaciones'));
    expect(notificaciones).toHaveLength(3);
    expect(String(notificaciones[0][0])).toContain('ON CONFLICT (evento_id, user_id)');
    expect(String(notificaciones[0][0])).not.toContain('agrupacion_clave');
  });

  test('agrupa cambios geométricos de lotes por actor y guarda el historial de eventos', async () => {
    const db = { query: baseQuery([
      (sql) => sql.includes('INSERT INTO eventos_establecimiento') ? { rows: [{ id: 'evento-1' }] } : undefined,
      (sql) => sql.includes('SELECT DISTINCT m.user_id') ? { rows: [{ user_id: 'owner-2' }] } : undefined,
      (sql) => sql.includes('INSERT INTO entregas_eventos_notificacion') ? { rows: [{ evento_id: 'evento-1' }] } : undefined,
      (sql) => sql.includes('INSERT INTO notificaciones') ? { rows: [{ id: 'notificacion-agrupada' }] } : undefined,
    ]) };
    await registrarEventoAdministrativo(db as never, {
      establecimientoId: eid, tipo: 'limite_lote_modificado', actorId: actor, loteId: 'lote-1',
      titulo: 'Límites del lote modificados', tituloAgrupado: 'Límites de lotes modificados',
      mensaje: 'Ana modificó los límites del lote 1.', permisoDestinatario: 'editar_geometria_lotes', excluirAutor: true,
      detalles: { numeroLote: 1 },
    });
    const insercion = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notificaciones'))!;
    expect(insercion[1]?.[5]).toBe('cambios_limites');
    expect(insercion[1]?.[4]).toContain('limite_lote_modificado');
    expect(insercion[1]?.[2]).toBeNull();
    expect(String(insercion[0])).toContain('jsonb_array_length');
    expect(String(insercion[0])).toContain('ON CONFLICT (user_id, agrupacion_clave)');
    expect(String(insercion[0])).toContain('read_at = NULL');
    expect(String(insercion[0])).toContain('created_at = NOW()');
  });

  test('repetir un evento agrupable no incrementa el contador ni vuelve a notificar como no leído', async () => {
    let eventInsertCount = 0;
    let claimCount = 0;
    const db = { query: baseQuery([
      (sql) => sql.includes('INSERT INTO eventos_establecimiento')
        ? (++eventInsertCount === 1 ? { rows: [{ id: 'evento-repetido' }] } : { rows: [] })
        : undefined,
      (sql) => sql.includes('SELECT id FROM eventos_establecimiento') ? { rows: [{ id: 'evento-repetido' }] } : undefined,
      (sql) => sql.includes('SELECT DISTINCT m.user_id') ? { rows: [{ user_id: 'owner' }] } : undefined,
      (sql) => sql.includes('INSERT INTO entregas_eventos_notificacion')
        ? (++claimCount === 1 ? { rows: [{ evento_id: 'evento-repetido' }] } : { rows: [] })
        : undefined,
      (sql) => sql.includes('INSERT INTO notificaciones') ? { rows: [{ id: 'notificacion-agrupada' }] } : undefined,
    ]) };
    const evento = {
      idempotencyId: 'evento-repetido', establecimientoId: eid, tipo: 'lote_eliminado' as const,
      actorId: actor, titulo: 'Lote eliminado', tituloAgrupado: 'Lotes eliminados',
      mensaje: 'Ana eliminó el lote 3 del establecimiento.', detalles: { referenciaLote: { numero: 3 } },
    };
    await registrarEventoAdministrativo(db as never, evento);
    await registrarEventoAdministrativo(db as never, evento);
    expect(db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO entregas_eventos_notificacion'))).toHaveLength(2);
    const notificaciones = db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notificaciones'));
    expect(notificaciones).toHaveLength(1);
    expect(String(notificaciones[0][0])).toContain("COALESCE(notificaciones.metadata->'eventos', '[]'::jsonb) || EXCLUDED.metadata->'eventos'");
    expect(String(notificaciones[0][0])).toContain('jsonb_array_length');
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE entregas_eventos_notificacion SET notificacion_id'))).toBe(true);
  });

  test('eventos agrupados distintos siguen consolidándose en una notificación por ventana', async () => {
    let eventNumber = 0;
    const db = { query: baseQuery([
      (sql) => sql.includes('INSERT INTO eventos_establecimiento') ? { rows: [{ id: `evento-${++eventNumber}` }] } : undefined,
      (sql) => sql.includes('SELECT DISTINCT m.user_id') ? { rows: [{ user_id: 'owner' }] } : undefined,
      (sql) => sql.includes('INSERT INTO entregas_eventos_notificacion') ? { rows: [{ evento_id: 'claimed' }] } : undefined,
      (sql) => sql.includes('INSERT INTO notificaciones') ? { rows: [{ id: 'notificacion-agrupada' }] } : undefined,
    ]) };
    for (const numero of [1, 2]) await registrarEventoAdministrativo(db as never, {
      establecimientoId: eid, tipo: 'limite_lote_modificado', actorId: actor, loteId: `lote-${numero}`,
      titulo: `Límite del lote ${numero}`, tituloAgrupado: 'Límites de lotes modificados',
      mensaje: `Ana modificó los límites del lote ${numero}.`, detalles: { numeroLote: numero },
    });
    const notificaciones = db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notificaciones'));
    expect(notificaciones).toHaveLength(2);
    expect(notificaciones.every(([sql]) => String(sql).includes('ON CONFLICT (user_id, agrupacion_clave)'))).toBe(true);
    expect(notificaciones[0][1]?.[8]).toContain('evento-1');
    expect(notificaciones[1][1]?.[8]).toContain('evento-2');
  });

  test('una incidencia activa se actualiza y la clave única protege sus avisos por destinatario', async () => {
    const db = { query: baseQuery([
      (sql) => sql.startsWith('UPDATE incidencias_establecimiento') ? { rows: [], rowCount: 1 } : undefined,
      (sql) => sql.includes('SELECT id FROM incidencias_establecimiento') ? { rows: [{ id: 'incidencia-1' }] } : undefined,
      (sql) => sql.includes('SELECT DISTINCT m.user_id') ? { rows: [{ user_id: 'propietario' }] } : undefined,
    ]) };
    const id = await mantenerIncidenciaActiva(db as never, {
      establecimientoId: eid, tipo: 'satelite_optico_desactualizado', clave: 'todos',
      detalles: { lotesAfectados: 2 }, titulo: 'Datos satelitales desactualizados', mensaje: 'Dos lotes sin datos.',
      permisoDestinatario: 'actualizar_satelite',
    });
    expect(id).toBe('incidencia-1');
    const aviso = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notificaciones'))!;
    expect(String(aviso[0])).toContain('ON CONFLICT (incidencia_id, user_id)');
    expect(aviso[1]?.[3]).toBe('incidencia-1');
  });

  test('GPS sólo busca la designación actual y no cae a todos los administradores', async () => {
    const db = { query: baseQuery([
      (sql) => sql.startsWith('UPDATE incidencias_establecimiento') ? { rows: [], rowCount: 1 } : undefined,
      (sql) => sql.includes('SELECT id FROM incidencias_establecimiento') ? { rows: [{ id: 'incidencia-gps' }] } : undefined,
      (sql) => sql.includes('responsable_gps_notificaciones') && sql.includes('SELECT r.user_id') ? { rows: [] } : undefined,
    ]) };
    const id = await mantenerIncidenciaActiva(db as never, {
      establecimientoId: eid, tipo: 'gps_simulado_fuera_establecimiento', clave: 'gps_simulado',
      detalles: { origen: 'gps_simulado' }, titulo: 'GPS simulado fuera', mensaje: 'El punto quedó fuera.', soloResponsableGps: true,
    });
    expect(id).toBeTruthy();
    const seleccion = db.query.mock.calls.find(([sql]) => String(sql).includes('SELECT r.user_id'))!;
    expect(String(seleccion[0])).toContain("m.rol = 'ADMINISTRADOR'");
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notificaciones'))).toBe(false);
  });

  test('resolver una incidencia no borra su historial ni usa read_at como resolución', async () => {
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    await resolverIncidencia(db as never, eid, 'gps_simulado_fuera_establecimiento', 'gps_simulado');
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain("estado = 'resuelta'");
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain('resuelta_en = NOW()');
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).not.toContain('read_at');
  });

  test('al asignar responsable entrega una incidencia GPS vigente una sola vez al miembro elegido', async () => {
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    await notificarResponsableGpsSiHayIncidencia(db as never, eid, 'admin-designado');
    expect(db.query).toHaveBeenCalledOnce();
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain('JOIN responsable_gps_notificaciones');
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain("i.estado = 'activa'");
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain("m.rol = 'ADMINISTRADOR'");
    expect(String((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][0])).toContain('ON CONFLICT (incidencia_id, user_id)');
    expect((db.query.mock.calls as unknown as Array<[unknown, unknown]>)[0][1]).toEqual([eid, 'admin-designado']);
  });
});
