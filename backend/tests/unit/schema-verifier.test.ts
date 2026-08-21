import { describe, expect, test } from 'vitest';
import {
  columnasEsperadas,
  constraintsEsperados,
  evaluarSchema,
  indicesEsperados,
  tablasEsperadas,
  type SnapshotSchema,
} from '../../src/base-datos/schema-verifier.js';

function snapshotCompleto(): SnapshotSchema {
  return {
    tablas: [...tablasEsperadas],
    columnas: columnasEsperadas.map((columna) => ({
      table_name: columna.tabla,
      column_name: columna.nombre,
      udt_name: columna.tipo,
      is_nullable: columna.nullable ? 'YES' : 'NO',
    })),
    constraints: constraintsEsperados.map((constraint) => ({
      table_name: constraint.tabla,
      contype: constraint.tipo,
      definition: constraint.contiene.join(' '),
    })),
    indices: indicesEsperados.map((indice) => ({
      tablename: indice.tabla,
      indexname: indice.nombre,
      indexdef: indice.contiene.join(' '),
    })),
  };
}

describe('verificador estructural de PostgreSQL', () => {
  test('acepta el schema esperado completo', () => {
    expect(evaluarSchema(snapshotCompleto())).toEqual([]);
  });

  test('falla si faltan una columna, un constraint o un índice esencial', () => {
    const snapshot = snapshotCompleto();
    snapshot.columnas = snapshot.columnas.filter((columna) => columna.column_name !== 'origen' || columna.table_name !== 'consultas_clima');
    snapshot.constraints = snapshot.constraints.filter((constraint) => !constraint.definition.includes('automatico'));
    snapshot.indices = snapshot.indices.filter((indice) => indice.indexname !== 'consultas_clima_automatico_reciente_idx');
    const errores = evaluarSchema(snapshot);
    expect(errores).toContain('Falta la columna consultas_clima.origen.');
    expect(errores).toContain('Falta constraint esencial: orígenes climáticos válidos.');
    expect(errores).toContain('Falta o no coincide el índice consultas_clima_automatico_reciente_idx.');
  });
});
