import { pool } from '../src/base-datos/pool.js';
import { hoyCalendario } from '../src/fechas.js';
import { eliminarUsuarioSmoke } from './smoke-cleanup.js';

const baseUrl = `http://localhost:${process.env.PORT ?? 3001}`;
const username = `rodeo_smoke_${Date.now()}`;
const password = 'smoke-password-2026';
const establecimiento = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};
const loteValido = (min: number, max: number) => ({
  type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]] },
});

let cookie = '';

async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let body: unknown = null;
  if (response.status !== 204) body = await response.json();
  return { status: response.status, body };
}

function expect(status: number, actual: number, label: string): void {
  if (status !== actual) throw new Error(`${label}: esperado ${status}, recibido ${actual}`);
  console.log(`OK ${label} (${actual})`);
}

function fechaManana(): string {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  return hoyCalendario(manana);
}

try {
  expect(200, (await request('/api/health')).status, 'health');
  cookie = '';
  expect(401, (await request('/api/auth/me')).status, 'me sin sesión');
  expect(201, (await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })).status, 'registro');
  expect(409, (await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })).status, 'username duplicado');
  expect(200, (await request('/api/auth/me')).status, 'me autenticado');
  expect(204, (await request('/api/auth/logout', { method: 'POST' })).status, 'logout');
  cookie = '';
  expect(401, (await request('/api/auth/me')).status, 'me después de logout');
  expect(200, (await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).status, 'login');
  expect(401, (await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'incorrecta-2026' }) })).status, 'login incorrecto');
  expect(201, (await request('/api/establecimiento', { method: 'POST', body: JSON.stringify({ nombre: 'Smoke', polygon: establecimiento }) })).status, 'crear establecimiento');
  expect(409, (await request('/api/establecimiento', { method: 'POST', body: JSON.stringify({ nombre: 'Segundo', polygon: establecimiento }) })).status, 'segundo establecimiento');
  expect(200, (await request('/api/establecimiento')).status, 'obtener establecimiento');
  expect(400, (await request('/api/lotes', { method: 'POST', body: JSON.stringify({ polygon: loteValido(20, 21) }) })).status, 'lote fuera');
  expect(201, (await request('/api/lotes', { method: 'POST', body: JSON.stringify({ apodo: 'Primero', polygon: loteValido(1, 2) }) })).status, 'primer lote');
  expect(400, (await request('/api/lotes', { method: 'POST', body: JSON.stringify({ polygon: loteValido(1.5, 2.5) }) })).status, 'lote superpuesto');
  const list = await request('/api/lotes');
  expect(200, list.status, 'listar lotes');
  const firstLot = (list.body as { lotes: Array<{ id: string; numero: number }> }).lotes[0];
  expect(200, (await request(`/api/lotes/${firstLot.id}`, { method: 'PATCH', body: JSON.stringify({ activo: false }) })).status, 'editar lote');
  expect(204, (await request(`/api/lotes/${firstLot.id}`, { method: 'DELETE' })).status, 'soft delete');
  expect(201, (await request('/api/lotes', { method: 'POST', body: JSON.stringify({ polygon: loteValido(3, 4) }) })).status, 'nuevo lote sin reutilizar número');
  const lotes = await request('/api/lotes');
  const loteActivo = (lotes.body as { lotes: Array<{ id: string }> }).lotes[0];
  const clima = await request(`/api/lotes/${loteActivo.id}/clima/actualizar`, {
    method: 'POST',
    body: JSON.stringify({ origen: 'manual' }),
  });
  expect(200, clima.status, 'actualizar clima y persistir');
  if ((clima.body as { resultado: { estado: string } }).resultado.estado !== 'ok') throw new Error('Open-Meteo no devolvió datos válidos durante el smoke.');
  expect(201, (await request(`/api/lotes/${loteActivo.id}/usos`, { method: 'POST', body: JSON.stringify({ fecha: hoyCalendario() }) })).status, 'registrar uso válido');
  const futuro = await request(`/api/lotes/${loteActivo.id}/usos`, { method: 'POST', body: JSON.stringify({ fecha: fechaManana() }) });
  expect(400, futuro.status, 'rechazar uso futuro');
  if ((futuro.body as { error: { code: string } }).error.code !== 'FUTURE_USE_DATE') throw new Error('El rechazo de uso futuro devolvió un código inesperado.');
  const conteos = await pool.query<{ consultas: number; dias: number; usos: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM consultas_clima WHERE lote_id = $1) AS consultas,
       (SELECT COUNT(*)::int FROM dias_clima d JOIN consultas_clima c ON c.id = d.consulta_clima_id WHERE c.lote_id = $1) AS dias,
       (SELECT COUNT(*)::int FROM usos_lote WHERE lote_id = $1) AS usos`,
    [loteActivo.id],
  );
  if (conteos.rows[0].consultas !== 1 || conteos.rows[0].dias < 1 || conteos.rows[0].usos !== 1) throw new Error('Los conteos persistidos del smoke no coinciden con lo esperado.');
  if (process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET) {
    const satelite = await request(`/api/lotes/${loteActivo.id}/satelite/actualizar`, { method: 'POST' });
    expect(200, satelite.status, 'actualizar satélite');
    const estado = (satelite.body as { resultado: { estado: string } }).resultado.estado;
    if (estado === 'ok' || estado === 'radar') {
      const mediciones = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM mediciones_satelitales WHERE lote_id = $1', [loteActivo.id]);
      if (mediciones.rows[0].count < 1) throw new Error('La actualización satelital no persistió mediciones.');
    } else {
      console.log(`Copernicus respondió con estado ${estado}; el smoke de persistencia satelital quedó sin datos válidos.`);
    }
  }
  expect(200, (await request(`/api/lotes/${loteActivo.id}/estado`)).status, 'estado consolidado');
  expect(400, (await request('/api/establecimiento', { method: 'PATCH', body: JSON.stringify({ polygon: loteValido(0, 2) }) })).status, 'establecimiento deja lote afuera');
  const me = await request('/api/auth/me');
  expect(200, me.status, 'onboarding no se revierte');
  console.log('Smoke test completo.');
} finally {
  await eliminarUsuarioSmoke(pool, username);
  const restante = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM usuarios WHERE username = $1', [username]);
  if (restante.rows[0].count !== 0) throw new Error('El cleanup no eliminó completamente el usuario smoke.');
  await pool.end();
}
