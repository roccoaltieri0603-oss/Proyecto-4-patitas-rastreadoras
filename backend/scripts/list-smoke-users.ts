import { pool } from '../src/base-datos/pool.js';

const result = await pool.query<{ username: string }>("SELECT username FROM usuarios WHERE username ~ '^rodeo_smoke_[0-9]{13}$' ORDER BY username");
console.log(result.rows.map((row) => row.username).join('\n'));
await pool.end();
