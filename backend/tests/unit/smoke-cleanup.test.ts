import { describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { eliminarUsuarioSmoke, validarUsernameSmoke } from '../../scripts/smoke-cleanup.js';

describe('salvaguarda del cleanup smoke', () => {
  test('rechaza limpiar un usuario smoke que comparte establecimientos antes de cualquier borrado', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('FROM usuarios') ? [{id:'usuario'}] : sql.includes('FROM membresias') ? [{compartido:true}] : [] }));
    const release = vi.fn();
    const db = { connect: async () => ({query,release}) } as unknown as Pool;
    await expect(eliminarUsuarioSmoke(db,'rodeo_smoke_1787313600000')).rejects.toThrow('compartido');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');expect(release).toHaveBeenCalledOnce();
  });
  test('acepta únicamente el formato exacto generado por el smoke', () => {
    expect(validarUsernameSmoke('rodeo_smoke_1787313600000')).toBe('rodeo_smoke_1787313600000');
  });

  test('rechaza usuarios normales y prefijos smoke ambiguos', () => {
    for (const username of [undefined, 'usuario_real', 'rodeo_smoke_1', 'rodeo_smoke_1787313600000_extra']) {
      expect(() => validarUsernameSmoke(username)).toThrow(/formato estricto/);
    }
  });
});
