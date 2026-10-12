import { describe, expect, test, vi } from 'vitest';
import { registrarNotificacionPersonal } from '../../src/services/notificaciones-personales.js';

describe('notificaciones personales', () => {
  test('inserta el aviso dentro del cliente transaccional con idempotencia destinatario-origen', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
    await registrarNotificacionPersonal({ query } as never, {
      userId: '00000000-0000-4000-8000-000000000001',
      establecimientoId: '00000000-0000-4000-8000-000000000002',
      sourceId: '00000000-0000-4000-8000-000000000003', tipo: 'ingreso_forzado',
      titulo: 'Ingreso forzado a tu puesto', mensaje: 'Tu sesión operativa fue cerrada.',
      metadata: { puestoOperativoId: '00000000-0000-4000-8000-000000000004' },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO notificaciones_personales');
    expect(sql).toContain('ON CONFLICT (user_id, source_id) DO NOTHING');
    expect(values).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      'ingreso_forzado', 'Ingreso forzado a tu puesto', 'Tu sesión operativa fue cerrada.',
      JSON.stringify({ puestoOperativoId: '00000000-0000-4000-8000-000000000004' }),
    ]);
    expect(JSON.stringify(values)).not.toMatch(/password|cookie|token_hash|secret/i);
  });
});
