export interface DestinoPostgres {
  host: string;
  port: number;
  database: string;
}

export interface IdentidadBaseTest {
  database_name: string;
  database_comment: string | null;
  owns_database: boolean;
  is_superuser: boolean;
  can_create_database: boolean;
  can_create_schema: boolean;
}

export const prefijoMarcaBaseDescartable = 'RODEO_DISPOSABLE_TEST:';

export function destinoPostgres(url: string): DestinoPostgres {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('La URL PostgreSQL no es válida.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('La URL debe usar postgres:// o postgresql://.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database) throw new Error('La URL PostgreSQL debe identificar host y base de datos.');
  return {
    host: parsed.hostname.toLowerCase().replace(/\.$/, ''),
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
  };
}

export function validarDestinoTest(testUrl: string | undefined, databaseUrl: string | undefined): DestinoPostgres {
  if (!testUrl) throw new Error('Falta TEST_DATABASE_URL; las pruebas destructivas se cancelan.');
  if (!databaseUrl) throw new Error('Falta DATABASE_URL; no se puede confirmar que el destino de tests sea distinto.');
  const destinoTest = destinoPostgres(testUrl);
  const destinoPrincipal = destinoPostgres(databaseUrl);
  if (destinoTest.host === destinoPrincipal.host
    && destinoTest.port === destinoPrincipal.port
    && destinoTest.database === destinoPrincipal.database) {
    throw new Error('TEST_DATABASE_URL apunta al mismo host y base que DATABASE_URL.');
  }
  return destinoTest;
}

export function validarMarcaDescartable(marker: string | undefined): string {
  if (!marker || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker)) {
    throw new Error('Falta TEST_DATABASE_DISPOSABLE_MARKER con un UUID v4 de la base descartable.');
  }
  return `${prefijoMarcaBaseDescartable}${marker}`;
}

export function validarIdentidadBaseTest(
  identidad: IdentidadBaseTest,
  destino: DestinoPostgres,
  marcaEsperada: string,
): void {
  if (identidad.database_name !== destino.database) throw new Error('La base conectada no coincide con la base indicada en TEST_DATABASE_URL.');
  if (identidad.database_comment !== marcaEsperada) throw new Error('La base no tiene la marca explícita de base descartable esperada.');
  if (!identidad.owns_database) throw new Error('El rol de tests debe ser propietario de la base descartable.');
  if (identidad.is_superuser || identidad.can_create_database) throw new Error('El rol de tests no puede ser superusuario ni tener CREATEDB.');
  if (!identidad.can_create_schema) throw new Error('El rol de tests necesita CREATE sobre la base y el esquema public.');
}
