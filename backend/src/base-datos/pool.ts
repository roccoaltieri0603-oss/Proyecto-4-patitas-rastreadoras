import { Pool, types } from 'pg';
import { env } from '../configuracion/env.js';

// PostgreSQL DATE es una fecha de calendario, no un instante UTC.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
});
