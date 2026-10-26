import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';

const consultas = vi.hoisted(() => [] as string[]);
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: async (sql: string) => { consultas.push(sql); return { rows: [], rowCount: 1 }; } } }));
import { guardarDiasHistoricos } from '../../src/services/clima-historico.js';

/**
 * El clima histórico completa días para la estimación de forraje y nada más:
 * nunca puede pasar por "el clima actual" de un lote ni disparar un aviso. El
 * diseño lo garantiza con una tabla aparte (migración 016) que sólo leen la
 * estimación y su propio servicio; estas pruebas lo fijan para que un cambio
 * futuro no lo rompa sin darse cuenta.
 */

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function archivos(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

const fuentes = archivos(path.join(backend, 'src')).filter((ruta) => /\.m?ts$/.test(ruta));
const relativa = (ruta: string) => path.relative(path.join(backend, 'src'), ruta).replaceAll('\\', '/');

describe('aislamiento del clima histórico', () => {
  test('sólo la estimación, su servicio y la verificación del esquema nombran la tabla', () => {
    const conTabla = fuentes.filter((ruta) => readFileSync(ruta, 'utf8').includes('clima_historico_lote')).map(relativa).sort();
    expect(conTabla).toEqual([
      'base-datos/clima-historico-disponible.ts',
      'base-datos/schema-verifier.ts',
      'estimacion/clima.ts',
      'services/clima-historico.ts',
      'services/estimacion-forraje.ts',
    ]);
  });

  test('el estado del lote, el historial, las lecturas compartidas y las notificaciones no lo tocan', () => {
    const sensibles = fuentes.filter((ruta) => /estado-lotes|historial|lecturas-compartidas|notificacion/.test(relativa(ruta)));
    expect(sensibles.length).toBeGreaterThan(4);
    for (const ruta of sensibles) {
      const texto = readFileSync(ruta, 'utf8');
      expect(texto, relativa(ruta)).not.toContain('clima_historico');
      expect(texto, relativa(ruta)).not.toContain('clima-historico');
    }
  });

  test('ninguna migración agrega un origen "historico" a las consultas de clima', () => {
    const migraciones = readdirSync(path.join(backend, 'migrations')).filter((nombre) => nombre.endsWith('.sql'));
    for (const nombre of migraciones) {
      const texto = readFileSync(path.join(backend, 'migrations', nombre), 'utf8').toLowerCase();
      if (texto.includes('consultas_clima') && texto.includes('origen')) expect(texto, nombre).not.toMatch(/'historico'/);
    }
  });

  test('guardar el histórico escribe sólo en su tabla, nunca en consultas_clima ni dias_clima', async () => {
    await guardarDiasHistoricos(
      { estado: 'ok', loteId: '00000000-0000-4000-8000-000000000001', latitud: -37, longitud: -58, dias: [{ fecha: '2026-08-01', tempMin: 5, tempMax: 15, radiacionMjM2: 12 }] },
      new Set(['2026-08-01']),
      new Date('2026-10-22T12:00:00Z'),
    );
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toMatch(/INSERT INTO clima_historico_lote/);
    expect(consultas[0]).not.toMatch(/consultas_clima|dias_clima|notificaciones/);
  });
});
