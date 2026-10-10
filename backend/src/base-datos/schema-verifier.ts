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
  'consultas_clima', 'dias_clima', 'notificaciones', 'usos_lote', 'lotes_favoritos', 'membresias', 'invitaciones',
  'gps_simulado_posicion', 'eventos_establecimiento', 'incidencias_establecimiento',
  'entregas_eventos_notificacion', 'responsable_gps_notificaciones', 'estado_fallos_actualizacion', 'ejecuciones_actualizacion_proveedor',
] as const;

function columnas(tabla: string, definiciones: Array<[string, string, boolean]>): ColumnaEsperada[] {
  return definiciones.map(([nombre, tipo, nullable]) => ({ tabla, nombre, tipo, nullable }));
}

export const columnasEsperadas: ColumnaEsperada[] = [
  ...columnas('membresias', [
    ['establecimiento_id','uuid',false], ['user_id','uuid',false], ['rol','text',false], ['permisos','_text',false], ['capacidades','_text',false], ['created_at','timestamptz',false], ['updated_at','timestamptz',false],
  ]),
  ...columnas('invitaciones', [
    ['id','uuid',false], ['establecimiento_id','uuid',false], ['created_by','uuid',false], ['codigo_hash','text',false], ['rol','text',false], ['permisos','_text',false], ['capacidades','_text',false], ['created_at','timestamptz',false], ['expires_at','timestamptz',false], ['used_at','timestamptz',true], ['used_by','uuid',true],
  ]),
  ...columnas('lotes_favoritos', [
    ['user_id', 'uuid', false], ['lote_id', 'uuid', false], ['created_at', 'timestamptz', false],
  ]),
  ...columnas('usuarios', [
    ['email', 'text', false],
    ['id', 'uuid', false], ['username', 'text', false], ['password_hash', 'text', false],
    ['onboarding_completed_at', 'timestamptz', true], ['created_at', 'timestamptz', false], ['updated_at', 'timestamptz', false],
  ]),
  ...columnas('establecimientos', [
    ['principal_user_id', 'uuid', false], ['principal_rol', 'text', true], ['onboarding_completed_at', 'timestamptz', true],
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
    ['created_at', 'timestamptz', false], ['establecimiento_id', 'uuid', true], ['evento_id', 'uuid', true],
    ['incidencia_id', 'uuid', true], ['agrupacion_clave', 'text', true],
    ['deleted_at', 'timestamptz', true],
  ]),
  ...columnas('usos_lote', [
    ['id', 'uuid', false], ['lote_id', 'uuid', false], ['fecha', 'date', false], ['origen', 'text', false], ['created_at', 'timestamptz', false],
  ]),
  ...columnas('gps_simulado_posicion', [
    ['establecimiento_id', 'uuid', false], ['latitud', 'float8', false], ['longitud', 'float8', false],
    ['updated_at', 'timestamptz', false], ['updated_by', 'uuid', false],
  ]),
  ...columnas('eventos_establecimiento', [
    ['id','uuid',false], ['establecimiento_id','uuid',false], ['tipo','text',false], ['actor_user_id','uuid',false],
    ['afectado_user_id','uuid',true], ['lote_id','uuid',true], ['ocurrido_en','timestamptz',false], ['detalles','jsonb',false],
  ]),
  ...columnas('incidencias_establecimiento', [
    ['id','uuid',false], ['establecimiento_id','uuid',false], ['tipo','text',false], ['clave','text',false],
    ['estado','text',false], ['primera_deteccion','timestamptz',false], ['ultima_deteccion','timestamptz',false],
    ['resuelta_en','timestamptz',true], ['detalles','jsonb',false],
  ]),
  ...columnas('entregas_eventos_notificacion', [
    ['evento_id','uuid',false], ['user_id','uuid',false], ['establecimiento_id','uuid',false],
    ['notificacion_id','uuid',true], ['creada_en','timestamptz',false],
  ]),
  ...columnas('responsable_gps_notificaciones', [
    ['establecimiento_id','uuid',false], ['user_id','uuid',false], ['actualizado_por','uuid',false], ['updated_at','timestamptz',false],
  ]),
  ...columnas('estado_fallos_actualizacion', [
    ['establecimiento_id','uuid',false], ['proveedor','text',false], ['fallos_consecutivos','int4',false],
    ['ultima_ejecucion_id','text',true], ['actualizado_en','timestamptz',false],
  ]),
  ...columnas('ejecuciones_actualizacion_proveedor', [
    ['establecimiento_id','uuid',false], ['proveedor','text',false], ['ejecucion_id','text',false],
    ['fallo_tecnico','bool',false], ['ocurrida_en','timestamptz',false],
  ]),
];

const primaryKeys: ReglaEsperada[] = tablasEsperadas.filter((tabla) => !['lotes_favoritos', 'membresias', 'gps_simulado_posicion', 'entregas_eventos_notificacion', 'responsable_gps_notificaciones', 'estado_fallos_actualizacion', 'ejecuciones_actualizacion_proveedor'].includes(tabla)).map((tabla) => ({
  tabla, tipo: 'p', contiene: ['primary key (id)'], descripcion: `PK ${tabla}.id`,
}));

export const constraintsEsperados: ReglaEsperada[] = [
  ...primaryKeys,
  { tabla: 'membresias', tipo: 'p', contiene: ['primary key (establecimiento_id, user_id)'], descripcion: 'Una membresia por usuario y establecimiento' },
  { tabla: 'membresias', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)'], descripcion: 'FK membresia establecimiento' },
  { tabla: 'membresias', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)'], descripcion: 'FK membresia usuario' },
  { tabla: 'membresias', tipo: 'c', contiene: ['rol', 'PROPIETARIO', 'ADMINISTRADOR', 'VISOR'], descripcion: 'Roles de membresia' },
  { tabla: 'membresias', tipo: 'c', contiene: ['permisos', 'gestionar_administradores', 'revocar_cualquier_permiso'], descripcion: 'Dependencias de gestion' },
  { tabla: 'membresias', tipo: 'c', contiene: ['permisos', 'crear_admin_cualquier_permiso', 'invitar_administradores'], descripcion: 'Dependencia de invitacion' },
  { tabla: 'establecimientos', tipo: 'f', contiene: ['foreign key (id, principal_user_id, principal_rol)', 'references membresias(establecimiento_id, user_id, rol)', 'deferrable initially deferred'], descripcion: 'Principal unico miembro propietario' },
  { tabla: 'invitaciones', tipo: 'u', contiene: ['unique (codigo_hash)'], descripcion: 'Hash de codigo unico' },
  { tabla: 'invitaciones', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)'], descripcion: 'FK invitacion establecimiento' },
  { tabla: 'invitaciones', tipo: 'f', contiene: ['foreign key (created_by)', 'references usuarios(id)'], descripcion: 'Creador invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['rol', 'PROPIETARIO', 'ADMINISTRADOR', 'VISOR'], descripcion: 'Roles de invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['expires_at > created_at'], descripcion: 'Expiracion invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['rol', 'ADMINISTRADOR', 'cardinality(permisos) = 0'], descripcion: 'Permisos según rol de invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['rol', 'PROPIETARIO', 'cardinality(capacidades) = 0'], descripcion: 'Capacidades según rol de invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['permisos', 'crear_lotes', 'crear_admin_cualquier_permiso', 'array_position(permisos, null) is null'], descripcion: 'Permisos validos de invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['capacidades', 'crear_propietarios', 'poderes_principal', 'array_position(capacidades, null) is null'], descripcion: 'Capacidades validas de invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['permisos', 'gestionar_administradores', 'revocar_cualquier_permiso'], descripcion: 'Dependencias de gestion en invitacion' },
  { tabla: 'invitaciones', tipo: 'c', contiene: ['permisos', 'crear_admin_cualquier_permiso', 'invitar_administradores'], descripcion: 'Dependencia de invitacion en invitacion' },
  { tabla: 'lotes_favoritos', tipo: 'p', contiene: ['primary key (user_id, lote_id)'], descripcion: 'PK lotes_favoritos por usuario y lote' },
  { tabla: 'lotes_favoritos', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK favoritos a usuarios' },
  { tabla: 'lotes_favoritos', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK favoritos a lotes' },
  { tabla: 'establecimientos', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK establecimientos → usuarios' },
  { tabla: 'lotes', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK lotes → establecimientos' },
  { tabla: 'mediciones_satelitales', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK mediciones → lotes' },
  { tabla: 'consultas_clima', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK consultas clima → lotes' },
  { tabla: 'dias_clima', tipo: 'f', contiene: ['foreign key (consulta_clima_id)', 'references consultas_clima(id)', 'on delete restrict'], descripcion: 'FK días clima → consultas' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK notificaciones → usuarios' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK notificaciones → lotes' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK notificaciones → establecimiento' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (lote_id, establecimiento_id)', 'references lotes(id, establecimiento_id)'], descripcion: 'Lote notificado pertenece al mismo establecimiento' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (evento_id, establecimiento_id)', 'references eventos_establecimiento(id, establecimiento_id)'], descripcion: 'Notificación y evento del mismo establecimiento' },
  { tabla: 'notificaciones', tipo: 'f', contiene: ['foreign key (incidencia_id, establecimiento_id)', 'references incidencias_establecimiento(id, establecimiento_id)'], descripcion: 'Notificación e incidencia del mismo establecimiento' },
  { tabla: 'notificaciones', tipo: 'u', contiene: ['unique (id, establecimiento_id, user_id)'], descripcion: 'Clave destinatario y establecimiento de notificación' },
  { tabla: 'entregas_eventos_notificacion', tipo: 'p', contiene: ['primary key (evento_id, user_id)'], descripcion: 'Una entrega administrativa por evento y usuario' },
  { tabla: 'entregas_eventos_notificacion', tipo: 'f', contiene: ['foreign key (evento_id, establecimiento_id)', 'references eventos_establecimiento(id, establecimiento_id)'], descripcion: 'Entrega ligada al evento del establecimiento' },
  { tabla: 'entregas_eventos_notificacion', tipo: 'f', contiene: ['foreign key (notificacion_id, establecimiento_id, user_id)', 'references notificaciones(id, establecimiento_id, user_id)'], descripcion: 'Entrega ligada a su notificación/destinatario' },
  { tabla: 'entregas_eventos_notificacion', tipo: 'f', contiene: ['foreign key (user_id)', 'references usuarios(id)'], descripcion: 'Entrega a usuario existente' },
  { tabla: 'eventos_establecimiento', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK auditoría → establecimiento' },
  { tabla: 'eventos_establecimiento', tipo: 'u', contiene: ['unique (id, establecimiento_id)'], descripcion: 'Clave compuesta evento y establecimiento' },
  { tabla: 'eventos_establecimiento', tipo: 'f', contiene: ['foreign key (lote_id, establecimiento_id)', 'references lotes(id, establecimiento_id)'], descripcion: 'Lote auditado pertenece al mismo establecimiento' },
  { tabla: 'eventos_establecimiento', tipo: 'f', contiene: ['foreign key (actor_user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK auditoría → autor' },
  { tabla: 'eventos_establecimiento', tipo: 'f', contiene: ['foreign key (afectado_user_id)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK auditoría → afectado' },
  { tabla: 'eventos_establecimiento', tipo: 'c', contiene: ['tipo', 'lote_eliminado', 'propiedad_principal_transferida'], descripcion: 'Tipos de eventos auditables' },
  { tabla: 'lotes', tipo: 'u', contiene: ['unique (id, establecimiento_id)'], descripcion: 'Clave compuesta de lote y establecimiento' },
  { tabla: 'incidencias_establecimiento', tipo: 'c', contiene: ['estado', 'activa', 'resuelta', 'resuelta_en'], descripcion: 'Estado de incidencia consistente' },
  { tabla: 'incidencias_establecimiento', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK incidencia → establecimiento' },
  { tabla: 'responsable_gps_notificaciones', tipo: 'p', contiene: ['primary key (establecimiento_id)'], descripcion: 'Un responsable GPS por establecimiento' },
  { tabla: 'responsable_gps_notificaciones', tipo: 'f', contiene: ['foreign key (establecimiento_id, user_id)', 'references membresias(establecimiento_id, user_id)', 'on delete cascade'], descripcion: 'Responsable GPS es miembro' },
  { tabla: 'estado_fallos_actualizacion', tipo: 'p', contiene: ['primary key (establecimiento_id, proveedor)'], descripcion: 'Estado de fallos por establecimiento y proveedor' },
  { tabla: 'ejecuciones_actualizacion_proveedor', tipo: 'p', contiene: ['primary key (establecimiento_id, proveedor, ejecucion_id)'], descripcion: 'Ejecución proveedor idempotente' },
  { tabla: 'usos_lote', tipo: 'f', contiene: ['foreign key (lote_id)', 'references lotes(id)', 'on delete restrict'], descripcion: 'FK usos → lotes' },
  { tabla: 'gps_simulado_posicion', tipo: 'p', contiene: ['primary key (establecimiento_id)'], descripcion: 'Una sola posicion simulada por establecimiento' },
  { tabla: 'gps_simulado_posicion', tipo: 'f', contiene: ['foreign key (establecimiento_id)', 'references establecimientos(id)', 'on delete restrict'], descripcion: 'FK posicion simulada → establecimientos' },
  { tabla: 'gps_simulado_posicion', tipo: 'f', contiene: ['foreign key (updated_by)', 'references usuarios(id)', 'on delete restrict'], descripcion: 'FK posicion simulada → usuarios' },
  { tabla: 'gps_simulado_posicion', tipo: 'c', contiene: ['latitud >=', 'latitud <=', '-90', '90'], descripcion: 'Latitud simulada en rango' },
  { tabla: 'gps_simulado_posicion', tipo: 'c', contiene: ['longitud >=', 'longitud <=', '-180', '180'], descripcion: 'Longitud simulada en rango' },
  { tabla: 'usuarios', tipo: 'u', contiene: ['unique (username)'], descripcion: 'username único' },
  { tabla: 'lotes', tipo: 'u', contiene: ['unique (establecimiento_id, numero)'], descripcion: 'número histórico de lote único' },
  { tabla: 'mediciones_satelitales', tipo: 'u', contiene: ['unique (lote_id, fuente, observed_at)'], descripcion: 'upsert satelital único' },
  { tabla: 'dias_clima', tipo: 'u', contiene: ['unique (consulta_clima_id, fecha)'], descripcion: 'un día por consulta climática' },
  { tabla: 'mediciones_satelitales', tipo: 'c', contiene: ['fuente', 'sentinel-1', 'sentinel-2'], descripcion: 'fuentes satelitales válidas' },
  { tabla: 'consultas_clima', tipo: 'c', contiene: ['origen', 'automatico', 'manual', 'legacy'], descripcion: 'orígenes climáticos válidos' },
];

export const indicesEsperados: IndiceEsperado[] = [
  { nombre: 'membresias_usuario_idx', tabla: 'membresias', contiene: ['(user_id, establecimiento_id)'] },
  { nombre: 'invitaciones_establecimiento_idx', tabla: 'invitaciones', contiene: ['(establecimiento_id, expires_at)'] },
  { nombre: 'usuarios_email_lower_idx', tabla: 'usuarios', contiene: ['unique index', '(lower(email))'] },
  { nombre: 'lotes_favoritos_lote_idx', tabla: 'lotes_favoritos', contiene: ['(lote_id)'] },
  { nombre: 'lotes_establecimiento_idx', tabla: 'lotes', contiene: ['(establecimiento_id)'] },
  { nombre: 'mediciones_lote_fecha_idx', tabla: 'mediciones_satelitales', contiene: ['(lote_id, observed_at desc)'] },
  { nombre: 'consultas_clima_lote_fecha_idx', tabla: 'consultas_clima', contiene: ['(lote_id, consulted_at desc)'] },
  { nombre: 'consultas_clima_automatico_reciente_idx', tabla: 'consultas_clima', contiene: ['(lote_id, created_at desc)', "where (origen = 'automatico'::text)"] },
  { nombre: 'dias_clima_consulta_fecha_idx', tabla: 'dias_clima', contiene: ['(consulta_clima_id, fecha)'] },
  { nombre: 'notificaciones_usuario_fecha_idx', tabla: 'notificaciones', contiene: ['(user_id, created_at desc)'] },
  { nombre: 'notificaciones_usuario_establecimiento_fecha_idx', tabla: 'notificaciones', contiene: ['(user_id, establecimiento_id, created_at desc, id desc)'] },
  { nombre: 'notificaciones_usuario_establecimiento_visibles_fecha_idx', tabla: 'notificaciones', contiene: ['(user_id, establecimiento_id, created_at desc, id desc)', 'where (deleted_at is null)'] },
  { nombre: 'notificaciones_evento_destinatario_unique_idx', tabla: 'notificaciones', contiene: ['unique index', '(evento_id, user_id)', 'where (evento_id is not null)'] },
  { nombre: 'notificaciones_incidencia_destinatario_unique_idx', tabla: 'notificaciones', contiene: ['unique index', '(incidencia_id, user_id)', 'where (incidencia_id is not null)'] },
  { nombre: 'notificaciones_agrupacion_destinatario_unique_idx', tabla: 'notificaciones', contiene: ['unique index', '(user_id, agrupacion_clave)', 'where (agrupacion_clave is not null)'] },
  { nombre: 'eventos_establecimiento_fecha_idx', tabla: 'eventos_establecimiento', contiene: ['(establecimiento_id, ocurrido_en desc, id desc)'] },
  { nombre: 'entregas_eventos_notificacion_notificacion_idx', tabla: 'entregas_eventos_notificacion', contiene: ['(notificacion_id)', 'where (notificacion_id is not null)'] },
  { nombre: 'incidencias_activas_clave_unique_idx', tabla: 'incidencias_establecimiento', contiene: ['unique index', '(establecimiento_id, tipo, clave)', "where (estado = 'activa'::text)"] },
  { nombre: 'usos_lote_fecha_idx', tabla: 'usos_lote', contiene: ['(lote_id, fecha desc)'] },
];

function normalizar(sql: string): string {
  return sql.toLowerCase().replaceAll('"', '').replaceAll('public.', '').replace(/\bnull::text\b/g, 'null').replace(/\s+/g, ' ').trim();
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
  if (snapshot.constraints.some(c => c.table_name === 'establecimientos' && c.contype === 'u' && normalizar(c.definition) === 'unique (user_id)')) errores.push('Persiste la restriccion de un establecimiento por usuario.');
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
