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
  test('rechaza el límite anterior de un establecimiento por usuario', () => {
    const snapshot = snapshotCompleto();
    snapshot.constraints.push({ table_name: 'establecimientos', contype: 'u', definition: 'UNIQUE (user_id)' });
    expect(evaluarSchema(snapshot)).toContain('Persiste la restriccion de un establecimiento por usuario.');
  });

  test('exige que el principal sea una membresía propietaria de su establecimiento', () => {
    const snapshot = snapshotCompleto();
    snapshot.constraints = snapshot.constraints.filter(c => !c.definition.includes('principal_user_id'));
    expect(evaluarSchema(snapshot)).toContain('Falta constraint esencial: Principal unico miembro propietario.');
  });

  test('exige las validaciones de permisos y dependencias de invitaciones', () => {
    const snapshot = snapshotCompleto();
    snapshot.constraints = snapshot.constraints.filter((constraint) => !constraint.definition.includes('crear_admin_cualquier_permiso'));
    const errores = evaluarSchema(snapshot);
    expect(errores).toContain('Falta constraint esencial: Permisos validos de invitacion.');
    expect(errores).toContain('Falta constraint esencial: Dependencia de invitacion en invitacion.');
  });

  test('acepta el cast NULL::text que PostgreSQL agrega a array_position', () => {
    const snapshot = snapshotCompleto();
    snapshot.constraints = snapshot.constraints.map((constraint) => ({
      ...constraint,
      definition: constraint.definition
        .replace('array_position(permisos, null) is null', 'array_position(permisos, NULL::text) IS NULL')
        .replace('array_position(capacidades, null) is null', 'array_position(capacidades, NULL::text) IS NULL'),
    }));
    expect(evaluarSchema(snapshot)).toEqual([]);
  });

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
