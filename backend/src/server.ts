import { app } from './app.mjs';
import { env } from './configuracion/env.js';
import { pool } from './base-datos/pool.js';

const SHUTDOWN_TIMEOUT_MS = 75_000;

const server = app.listen(env.port, () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'server_started', port: env.port }));
});

// Copernicus puede tardar hasta 60 s; el servidor deja margen sin aceptar
// headers lentos indefinidamente ni mantener conexiones idle demasiado tiempo.
server.requestTimeout = 90_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

let apagando = false;
let finalizando = false;
let timeoutForzado: NodeJS.Timeout | undefined;

async function finalizar(codigo: number, error?: Error): Promise<void> {
  if (finalizando) return;
  finalizando = true;
  if (timeoutForzado) clearTimeout(timeoutForzado);
  try {
    await pool.end();
  } catch (poolError) {
    codigo = 1;
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'pool_close_failed', mensaje: poolError instanceof Error ? poolError.message : 'Error desconocido.' }));
  }
  if (error) console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'server_close_failed', mensaje: error.message }));
  process.exit(codigo);
}

function apagar(signal: NodeJS.Signals): void {
  if (apagando) return;
  apagando = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'shutdown_started', signal }));

  timeoutForzado = setTimeout(() => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'shutdown_timeout', timeoutMs: SHUTDOWN_TIMEOUT_MS }));
    server.closeAllConnections();
    void finalizar(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeoutForzado.unref();

  server.close((error) => { void finalizar(error ? 1 : 0, error); });
  server.closeIdleConnections();
}

process.once('SIGTERM', apagar);
process.once('SIGINT', apagar);
