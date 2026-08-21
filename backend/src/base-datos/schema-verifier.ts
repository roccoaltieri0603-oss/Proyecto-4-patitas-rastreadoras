import type { Pool } from 'pg';

export interface ColumnaSchema {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
}

export interface ConstraintSchema {
  table_name: string;
  contype: string;
  definition: string;
}

export interface IndiceSchema {
  tablename: string;
  indexname: string;
  indexdef: string;
}

export interface SnapshotSchema {
  tablas: string[];
  columnas: ColumnaSchema[];
  constraints: ConstraintSchema[];
  indices: IndiceSchema[];
}

type ColumnaEsperada = { tabla: string; nombre: string; tipo: string; nullable: boolean };
type ReglaEsperada = { tabla: string; tipo: string; contiene: string[]; descripcion: string };
type IndiceEsperado = { nombre: string; tabla: string; contiene: string[] };

export const tablasEsperadas = [
  'usuarios', 'establecimientos', 'lotes', 'mediciones_satelitales',
  'consultas_clima', 'dias_clima', 'notificaciones', 'usos_lote',
] as const;

function columnas(tabla: string, definiciones: Array<[string, string, boolean]>): ColumnaEsperada[] {
  return definiciones.map(([nombre, tipo, nullable]) => ({ tabla, nombre, tipo, nullable }));
}

export const columnasEsperadas: ColumnaEsperada[] = [
  ...columnas('usuarios', [
    ['id', 'uuid', false], ['username', 'text', false], ['password_hash', 'text', false],
    ['onboarding_completed_at', 'timestamptz', true], ['created_at', 'timestamptz', false], ['updated_at', 'timestamptz', false],
  ]),
  ...columnas('establecimientos', [
    ['id', 'uuid', false], ['user_id', 'uuid', false], ['nombre', 'text', false], ['polygon', 'jsonb', false],
    ['created_at', 'timestamptz', false], ['updated_at', 'timestamptz', false],
  ]),
  ...columnas('lotes', [
    ['id', 'uuid', false], ['establecimiento_id', 'uuid', false], ['numero', 'int4', false], ['apodo', 'text', true],
    ['polygon', 'jsonb', false], ['activo', 'bool', false], ['deleted_at', 'timestamptz', true],
    ['created_at', 'timestamptz', false], ['updated_at', 'timestamptz', false],
  ]),
  ...columnas('mediciones_satelitales', [
    ['id', 'uuid', false], ['lote_id', 'uuid', false], ['fuente', 'text', false], ['observed_at', 'date', false],
    ['consulted_at', 'timestamptz', false], ['cobertura_valida', 'float8', true],
    ...['ndvi', 'ndmi', 'ndwi', 'evi', 'rvi'].flatMap((indice) =>
      ['media', 'mediana', 'min', 'max', 'desvio'].map((estadistica) => [`${indice}_${estadistica}`, 'float8', true] as [string, string, boolean]),
    ),
    ['puntaje', 'int4', true], ['categoria', 'text', true], ['alertas', 'jsonb', true], ['raw_metadata', 'jsonb', true],
    ['created_at', 'timestamptz', false],
  ]),
  ...columnas('consultas_clima', [
    ['id', 'uuid', false], ['lote_id', 'uuid', false], ['consulted_at', 'timestamptz', false],
    ['lluvia_ultimos_7_dias', 'float8', true], ['lluvia_proximos_dias', 'float8', true], ['categoria', 'text', true],
    ['raw_metadata', 'jsonb', true], ['created_at', 'timestamptz', false], ['origen', 'text', false],
  ]),
  ...columnas('dias_clima', [
    ['id', 'uuid', false], ['consulta_clima_id', 'uuid', false], ['fecha', 'date', false], ['lluvia_mm', 'float8', true],
    ['temp_min', 'float8', true], ['temp_max', 'float8', true], ['es_pronostico', 'bool', false], ['created_at', 'timestamptz', false],
  ]),
  ...columnas('notificaciones', [
    ['id', 'uuid', false], ['user_id', 'uuid', false], ['lote_id', 'uuid', true], ['tipo', 'text', false],
    ['titulo', 'text', false], ['mensaje', 'text', false], ['read_at', 'timestamptz', true], ['metadata', 'jsonb', true],
    ['created_at', 'timestamptz', false],
  ]),
  ...columnas('usos_lote', [
    ['id', 'uuid', false], ['lote_id', 'uuid', false], ['fecha', 'date', false], ['origen', 'text', false], ['created_at', 'timestamptz', false],
  ]),
];

const primaryKeys: ReglaEsperada[] = tablasEsperadas.map((tabla) => ({
  tabla, tipo: 'p', contiene: ['primary key (id)'], descripcion: `PK ${tabla}.id`,
}));

export const constraintsEsperados: ReglaEsperada[] = [
  ...primaryKeys,
  { tabla: 'establecimientos', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK establecimientos → usuarios' },
  { tabla: 'lotes', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK lotes → establecimientos' },
  { tabla: 'mediciones_satelitales', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK mediciones → lotes' },
  { tabla: 'consultas_clima', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK consultas clima → lotes' },
  { tabla: 'dias_clima', tipo: 'f', contiene: ['foreign key (consulta_clima_id)', 'references consultas_clima(id)', 'on delete restrict'], descripcion: 'FK días clima → consultas' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK notificaciones → usuarios' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK notificaciones → lotes' },
  { tabla: 'usos_lote', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK usos → lotes' },
  { tabla: 'usuarios', tipo: 'u', contiene: ['unique (username)'], descripcion: 'username único' },
  { tabla: 'establecimientos', tipo: 'u', contiene: ['unique (user_id)'], descripcion: 'un establecimiento por usuario' },
  { tabla: 'lotes', tipo: 'u', contiene: ['unique (establecimiento_id, numero)'], descripcion: 'número histórico de lote único' },
  { tabla: 'mediciones_satelitales', tipo: 'u', contiene: ['unique (lote_id, fuente, observed_at)'], descripcion: 'upsert satelital único' },
  { tabla: 'dias_clima', tipo: 'u', contiene: ['unique (consulta_clima_id, fecha)'], descripcion: 'un día por consulta climática' },
  { tabla: 'mediciones_satelitales', tipo: 'c', contiene: ['fuente', 'sentinel-1', 'sentinel-2'], descripcion: 'fuentes satelitales válidas' },
  { tabla: 'consultas_clima', tipo: 'c', contiene: ['origen', 'automatico', 'manual', 'legacy'], descripcion: 'orígenes climáticos válidos' },
];

export const indicesEsperados: IndiceEsperado[] = [
  { nombre: 'lotes_establecimiento_idx', tabla: 'lotes', contiene: ['(establecimiento_id)'] },
  { nombre: 'mediciones_lote_fecha_idx', tabla: 'mediciones_satelitales', contiene: ['(lote_id, observed_at desc)'] },
  { nombre: 'consultas_clima_lote_fecha_idx', tabla: 'consultas_clima', contiene: ['(lote_id, consulted_at desc)'] },
  { nombre: 'consultas_clima_automatico_reciente_idx', tabla: 'consultas_clima', contiene: ['(lote_id, created_at desc)', "where (origen = 'automatico'::text)"] },
  { nombre: 'dias_clima_consulta_fecha_idx', tabla: 'dias_clima', contiene: ['(consulta_clima_id, fecha)'] },
  { nombre: 'notificaciones_usuario_fecha_idx', tabla: 'notificaciones', contiene: ['(user_id, created_at desc)'] },
  { nombre: 'usos_lote_fecha_idx', tabla: 'usos_lote', contiene: ['(lote_id, fecha desc)'] },
];

function normalizar(sql: string): string {
  return sql.toLowerCase().replaceAll('"', '').replaceAll('public.', '').replace(/\s+/g, ' ').trim();
}

export function evaluarSchema(snapshot: SnapshotSchema): string[] {
  const errores: string[] = [];
  const tablas = new Set(snapshot.tablas);
  for (const tabla of tablasEsperadas) if (!tablas.has(tabla)) errores.push(`Falta la tabla ${tabla}.`);

  for (const esperada of columnasEsperadas) {
    const actual = snapshot.columnas.find((columna) => columna.table_name === esperada.tabla && columna.column_name === esperada.nombre);
    if (!actual) {
      errores.push(`Falta la columna ${esperada.tabla}.${esperada.nombre}.`);
      continue;
    }
    if (actual.udt_name !== esperada.tipo) errores.push(`${esperada.tabla}.${esperada.nombre} tiene tipo ${actual.udt_name}; se esperaba ${esperada.tipo}.`);
    const nullable = actual.is_nullable === 'YES';
    if (nullable !== esperada.nullable) errores.push(`${esperada.tabla}.${esperada.nombre} tiene nullable=${nullable}; se esperaba ${esperada.nullable}.`);
  }

  for (const esperada of constraintsEsperados) {
    const coincide = snapshot.constraints.some((constraint) => {
      const definicion = normalizar(constraint.definition);
      return constraint.table_name === esperada.tabla
        && constraint.contype === esperada.tipo
        && esperada.contiene.every((fragmento) => definicion.includes(normalizar(fragmento)));
    });
    if (!coincide) errores.push(`Falta constraint esencial: ${esperada.descripcion}.`);
  }

  for (const esperada of indicesEsperados) {
    const actual = snapshot.indices.find((indice) => indice.indexname === esperada.nombre && indice.tablename === esperada.tabla);
    if (!actual || !esperada.contiene.every((fragmento) => normalizar(actual.indexdef).includes(normalizar(fragmento)))) {
      errores.push(`Falta o no coincide el índice ${esperada.nombre}.`);
    }
  }
  return errores;
}

export async function obtenerSnapshotSchema(db: Pool): Promise<SnapshotSchema> {
  const [tablas, columnasActuales, constraints, indices] = await Promise.all([
    db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ),
    db.query<ColumnaSchema>(
      `SELECT table_name, column_name, udt_name, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    ),
    db.query<ConstraintSchema>(
      `SELECT rel.relname AS table_name, con.contype, pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE ns.nspname = 'public' ORDER BY rel.relname, con.conname`,
    ),
    db.query<IndiceSchema>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' ORDER BY tablename, indexname`,
    ),
  ]);
  return {
    tablas: tablas.rows.map((tabla) => tabla.table_name),
    columnas: columnasActuales.rows,
    constraints: constraints.rows,
    indices: indices.rows,
  };
}
