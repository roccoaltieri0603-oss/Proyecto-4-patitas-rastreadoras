const { pool } = await import('../src/base-datos/pool.ts');
const client = await pool.connect();

try {
  await client.query('BEGIN READ ONLY');

  const identity = (await client.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           current_setting('transaction_read_only') AS read_only,
           current_setting('server_version') AS server_version
  `)).rows[0];
  const relations = (await client.query(`
    SELECT c.relname AS name, c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     ORDER BY c.relkind, c.relname
  `)).rows;
  const columns = (await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
           is_generated, generation_expression
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position
  `)).rows;
  const constraints = (await client.query(`
    SELECT rel.relname AS table_name, con.conname AS name, con.contype AS type,
           con.convalidated AS validated, con.condeferrable AS deferrable,
           con.condeferred AS initially_deferred, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY rel.relname, con.conname
  `)).rows;
  const indexes = (await client.query(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes WHERE schemaname = 'public'
     ORDER BY tablename, indexname
  `)).rows;
  const triggers = (await client.query(`
    SELECT rel.relname AS table_name, t.tgname AS name, t.tgenabled,
           p.proname AS function_name, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class rel ON rel.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY rel.relname, t.tgname
  `)).rows;
  const fingerprint = (await client.query(`
    SELECT md5(
      coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s', c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity), E'\\n' ORDER BY c.relname, c.relkind)
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')), '')
      || E'\\n--columns--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', table_name, column_name, udt_name, is_nullable,
                         coalesce(column_default, ''), is_generated, coalesce(generation_expression, ''), ordinal_position), E'\\n' ORDER BY table_name, ordinal_position)
                    FROM information_schema.columns WHERE table_schema = 'public'), '')
      || E'\\n--constraints--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', rel.relname, con.conname, con.contype, con.convalidated,
                         con.condeferrable, con.condeferred) || '|' || pg_get_constraintdef(con.oid, true), E'\\n' ORDER BY rel.relname, con.conname)
                    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
                    JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = 'public'), '')
      || E'\\n--indexes--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s', tablename, indexname, indexdef), E'\\n' ORDER BY tablename, indexname)
                    FROM pg_indexes WHERE schemaname = 'public'), '')
      || E'\\n--index-health--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s', nt.nspname, ct.relname, ci.relname, ix.indisvalid, ix.indisready)
                     || '|' || pg_get_indexdef(ix.indexrelid), E'\\n' ORDER BY ct.relname, ci.relname)
                    FROM pg_index ix JOIN pg_class ct ON ct.oid = ix.indrelid
                    JOIN pg_namespace nt ON nt.oid = ct.relnamespace
                    JOIN pg_class ci ON ci.oid = ix.indexrelid
                    JOIN pg_namespace ni ON ni.oid = ci.relnamespace
                   WHERE nt.nspname = 'public' AND ni.nspname = 'public'), '')
      || E'\\n--triggers--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', rel.relname, t.tgname, t.tgenabled,
                         t.tgdeferrable, t.tginitdeferred, p.proname) || '|' || pg_get_triggerdef(t.oid) || '|' || p.prosrc,
                         E'\\n' ORDER BY rel.relname, t.tgname)
                    FROM pg_trigger t JOIN pg_class rel ON rel.oid = t.tgrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
                    JOIN pg_proc p ON p.oid = t.tgfoid WHERE n.nspname = 'public' AND NOT t.tgisinternal), '')
      || E'\\n--policies--\\n'
      || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s', schemaname, tablename, policyname, permissive,
                         roles, cmd, coalesce(qual, '')) || '|' || coalesce(with_check, ''), E'\\n' ORDER BY schemaname, tablename, policyname)
                    FROM pg_policies WHERE schemaname = 'public'), '')
    ) AS fingerprint
  `)).rows[0].fingerprint;

  const relationNames = new Set(relations.map(({ name }) => name));
  const columnNames = new Set(columns.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  const constraintNames = new Set(constraints.map(({ name }) => name));
  const indexNames = new Set(indexes.map(({ indexname }) => indexname));
  const extensions = (await client.query(`SELECT extname FROM pg_extension ORDER BY extname`)).rows.map(({ extname }) => extname);
  let ledger = null;
  if (relationNames.has('rodeo_schema_migrations')) {
    ledger = (await client.query(`
      SELECT nombre, checksum, aplicada_en
        FROM public.rodeo_schema_migrations ORDER BY nombre
    `)).rows;
  }

  const counts = {};
  const countableTables = [
    'usuarios', 'establecimientos', 'lotes', 'mediciones_satelitales', 'consultas_clima',
    'dias_clima', 'notificaciones', 'membresias', 'invitaciones', 'gps_simulado_posicion',
    'eventos_establecimiento', 'incidencias_establecimiento', 'entregas_eventos_notificacion',
    'responsable_gps_notificaciones', 'estado_fallos_actualizacion',
    'ejecuciones_actualizacion_proveedor',
  ];
  for (const table of countableTables) {
    if (relationNames.has(table)) {
      counts[table] = Number((await client.query(`SELECT count(*)::bigint AS n FROM public.${table}`)).rows[0].n);
    }
  }

  const preconditions = {};
  if (columnNames.has('usuarios.email')) {
    preconditions.usuarios_sin_email = Number((await client.query(
      'SELECT count(*)::bigint AS n FROM public.usuarios WHERE email IS NULL',
    )).rows[0].n);
    preconditions.grupos_email_duplicado_sin_distinguir_mayusculas = Number((await client.query(`
      SELECT count(*)::bigint AS n FROM (
        SELECT lower(email) FROM public.usuarios GROUP BY lower(email) HAVING count(*) > 1
      ) duplicados
    `)).rows[0].n);
  }
  if (relationNames.has('establecimientos') && relationNames.has('membresias') && columnNames.has('establecimientos.principal_user_id')) {
    preconditions.establecimientos_sin_principal = Number((await client.query(
      'SELECT count(*)::bigint AS n FROM public.establecimientos WHERE principal_user_id IS NULL',
    )).rows[0].n);
    preconditions.establecimientos_sin_membresia_principal_propietaria = Number((await client.query(`
      SELECT count(*)::bigint AS n
        FROM public.establecimientos e
        LEFT JOIN public.membresias m
          ON m.establecimiento_id = e.id AND m.user_id = e.principal_user_id AND m.rol = 'PROPIETARIO'
       WHERE m.user_id IS NULL
    `)).rows[0].n);
  }
  if (relationNames.has('entregas_eventos_notificacion')) {
    preconditions.entregas_sin_notificacion = Number((await client.query(
      'SELECT count(*)::bigint AS n FROM public.entregas_eventos_notificacion WHERE notificacion_id IS NULL',
    )).rows[0].n);
  }

  const verifier = await import('../src/base-datos/schema-verifier.ts');
  const snapshot = {
    tablas: relations.filter(({ kind }) => kind === 'r').map(({ name }) => name),
    columnas: columns.map(({ table_name, column_name, udt_name, is_nullable }) => ({ table_name, column_name, udt_name, is_nullable })),
    constraints: constraints.map(({ table_name, type, definition }) => ({ table_name, contype: type, definition })),
    indices: indexes.map(({ tablename, indexname, indexdef }) => ({ tablename, indexname, indexdef })),
  };
  const baseTables = new Set([
    'usuarios', 'establecimientos', 'lotes', 'mediciones_satelitales', 'consultas_clima',
    'dias_clima', 'notificaciones', 'usos_lote', 'lotes_favoritos', 'membresias', 'invitaciones',
  ]);
  const expectedTables = [...baseTables].sort();
  const actualBaseTables = snapshot.tablas.filter((name) => baseTables.has(name)).sort();
  const normalize = (value) => value.toLowerCase().replaceAll('"', '').replaceAll('public.', '').replace(/\bnull::text\b/g, 'null').replace(/\s+/g, ' ').trim();
  const expectedColumns = verifier.columnasEsperadas.filter(({ tabla, nombre }) => baseTables.has(tabla)
    && !(tabla === 'notificaciones' && ['establecimiento_id', 'evento_id', 'incidencia_id', 'agrupacion_clave'].includes(nombre)));
  const expectedColumnKeys = new Set(expectedColumns.map(({ tabla, nombre }) => `${tabla}.${nombre}`));
  const columnDifferences = [];
  for (const expected of expectedColumns) {
    const actual = snapshot.columnas.find((column) => column.table_name === expected.tabla && column.column_name === expected.nombre);
    if (!actual || actual.udt_name !== expected.tipo || (actual.is_nullable === 'YES') !== expected.nullable) {
      columnDifferences.push(`${expected.tabla}.${expected.nombre}`);
    }
  }
  for (const actual of snapshot.columnas) {
    const key = `${actual.table_name}.${actual.column_name}`;
    if (baseTables.has(actual.table_name) && !expectedColumnKeys.has(key)) columnDifferences.push(`${key} (inesperada)`);
  }
  const expectedConstraints = verifier.constraintsEsperados.filter((expected) => baseTables.has(expected.tabla)
    && !(expected.tabla === 'notificaciones' && /establecimiento|evento|incidencia|destinatario/i.test(expected.descripcion))
    && !(expected.tabla === 'lotes' && /clave compuesta/i.test(expected.descripcion)));
  const missingConstraints = expectedConstraints.filter((expected) => !snapshot.constraints.some((actual) =>
    actual.table_name === expected.tabla && actual.contype === expected.tipo
    && expected.contiene.every((fragment) => normalize(actual.definition).includes(normalize(fragment))))).map(({ descripcion }) => descripcion);
  const expectedIndexes = verifier.indicesEsperados.filter((expected) => baseTables.has(expected.tabla)
    && !(expected.tabla === 'notificaciones' && /establecimiento|evento|incidencia|agrupacion/i.test(expected.nombre)));
  const missingIndexes = expectedIndexes.filter((expected) => {
    const actual = snapshot.indices.find((index) => index.indexname === expected.nombre && index.tablename === expected.tabla);
    return !actual || !expected.contiene.every((fragment) => normalize(actual.indexdef).includes(normalize(fragment)));
  }).map(({ nombre }) => nombre);
  const missingTables = expectedTables.filter((name) => !actualBaseTables.includes(name));
  const extraBaseTables = snapshot.tablas.filter((name) => !baseTables.has(name) && name !== 'rodeo_schema_migrations');
  const principalRol = columns.find(({ table_name, column_name }) => table_name === 'establecimientos' && column_name === 'principal_rol');
  const principalRolGeneratedCorrectly = principalRol?.is_generated === 'ALWAYS'
    && normalize(principalRol.generation_expression ?? '').includes("'propietario'::text");
  const unvalidatedConstraints = constraints.filter(({ validated }) => !validated).map(({ table_name, name }) => `${table_name}.${name}`);
  const catalogSchemaCheck = {
    missingTables,
    extraPublicTables: extraBaseTables,
    columnDifferences: [...new Set(columnDifferences)].sort(),
    missingConstraints,
    missingIndexes,
    unvalidatedConstraints,
    principalRoleGeneratedCorrectly: principalRolGeneratedCorrectly,
    passed: missingTables.length === 0 && extraBaseTables.length === 0 && columnDifferences.length === 0
      && missingConstraints.length === 0 && missingIndexes.length === 0 && unvalidatedConstraints.length === 0
      && principalRolGeneratedCorrectly,
  };

  await client.query('ROLLBACK');
  const migrations = {
    '001–007_verificados': catalogSchemaCheck.passed && extensions.includes('pgcrypto'),
    '008': relationNames.has('gps_simulado_posicion'),
    '009': ['eventos_establecimiento', 'incidencias_establecimiento', 'entregas_eventos_notificacion', 'responsable_gps_notificaciones', 'estado_fallos_actualizacion', 'ejecuciones_actualizacion_proveedor'].every((name) => relationNames.has(name)) && ['notificaciones.evento_id', 'notificaciones.incidencia_id', 'notificaciones.agrupacion_clave'].every((name) => columnNames.has(name)),
    '010': triggers.some(({ name }) => name === 'entregas_eventos_notificacion_completas') && triggers.some(({ function_name }) => function_name === 'exigir_entrega_con_notificacion'),
  };
  console.log(JSON.stringify({
    identity,
    fingerprint,
    extensions,
    migration_markers: migrations,
    complete_schema_check_001_007: catalogSchemaCheck,
    ledger,
    counts,
    preconditions,
  }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* Se informa sólo el error de lectura. */ }
  const safe = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: String(error?.message ?? 'Fallo desconocido').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-url]'),
  };
  console.error('Auditoría read-only fallida:', JSON.stringify(safe));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
