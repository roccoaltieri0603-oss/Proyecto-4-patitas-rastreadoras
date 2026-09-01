import * as turf from '@turf/turf';
import { pool } from '../src/base-datos/pool.js';
import { estaContenido, esPolygonFeature, seSuperpone, type PolygonFeature } from '../src/geometria.js';
import { eliminarUsuarioSmoke } from './smoke-cleanup.js';

/**
 * Smoke de la sugerencia de lotes con IA, contra el backend levantado.
 *
 * Necesita el microservicio Python corriendo y `IA_LOTES_URL` configurada. Se
 * ejecuta con un usuario smoke descartable, que se borra siempre al final.
 *
 *   npm run test:smoke:ia
 */

const baseUrl = `http://localhost:${process.env.PORT ?? 3001}`;
const username = `rodeo_smoke_${Date.now()}`;
const password = 'smoke-password-2026';

// Campo agrícola real de la pampa húmeda (zona de Lincoln, Buenos Aires): tiene
// la división en cuadros visible desde la imagen satelital.
const establecimiento: PolygonFeature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-61.5000, -34.6000],
      [-61.4700, -34.6000],
      [-61.4700, -34.6250],
      [-61.5000, -34.6250],
      [-61.5000, -34.6000],
    ]],
  },
};

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

function expect(esperado: number, recibido: number, label: string): void {
  if (esperado !== recibido) throw new Error(`${label}: esperado ${esperado}, recibido ${recibido}`);
  console.log(`OK ${label} (${recibido})`);
}

interface Sugerencia { id: string; polygon: PolygonFeature; hectareas: number; confianza: number | null }

expect(200, (await request('/api/health')).status, 'health');
expect(401, (await request('/api/ia/estado')).status, 'estado de IA exige sesión');
expect(401, (await request('/api/ia/sugerir-lotes', { method: 'POST' })).status, 'sugerir exige sesión');

try {
  cookie = '';
  expect(201, (await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })).status, 'registro');

  const configurado = (await request('/api/ia/estado')).body as { configurado: boolean };
  if (!configurado.configurado) {
    throw new Error('IA_LOTES_URL no está configurada en el backend: no hay nada que probar.');
  }
  console.log('OK microservicio configurado');

  const sinEstablecimiento = await request('/api/ia/sugerir-lotes', { method: 'POST' });
  expect(409, sinEstablecimiento.status, 'sin establecimiento no hay subdivisión');

  expect(201, (await request('/api/establecimiento', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Campo smoke IA', polygon: establecimiento }),
  })).status, 'establecimiento creado');

  const inicio = Date.now();
  const respuesta = await request('/api/ia/sugerir-lotes', { method: 'POST' });
  expect(200, respuesta.status, 'sugerencia generada');
  const { sugerencias, meta } = respuesta.body as { sugerencias: Sugerencia[]; meta: Record<string, unknown> };
  console.log(`   ${sugerencias.length} sugerencias en ${Math.round((Date.now() - inicio) / 1000)} s`, meta);

  if (sugerencias.length === 0) throw new Error('El modelo no detectó nada sobre un campo con cuadros visibles.');

  // Cuánto del establecimiento queda efectivamente cubierto por la propuesta:
  // lo que falta es trabajo manual que le queda al usuario.
  const hectareasCampo = turf.area(establecimiento) / 10_000;
  const hectareasPropuestas = sugerencias.reduce((total, sugerencia) => total + sugerencia.hectareas, 0);
  const cobertura = (100 * hectareasPropuestas) / hectareasCampo;
  console.log(`   cobertura: ${hectareasPropuestas.toFixed(0)} de ${hectareasCampo.toFixed(0)} ha (${cobertura.toFixed(1)}%)`);

  // Cada sugerencia tiene que ser guardable tal cual: dentro del límite y sin
  // pisar a las otras. Si esto falla, el recorte de Express tiene un agujero.
  for (const sugerencia of sugerencias) {
    if (!esPolygonFeature(sugerencia.polygon)) throw new Error(`${sugerencia.id} no es un Polygon válido.`);
    if (!estaContenido(sugerencia.polygon, establecimiento)) throw new Error(`${sugerencia.id} se sale del establecimiento.`);
    if (!(sugerencia.hectareas > 0)) throw new Error(`${sugerencia.id} no informa superficie.`);
  }
  for (let i = 0; i < sugerencias.length; i += 1) {
    for (let j = i + 1; j < sugerencias.length; j += 1) {
      if (seSuperpone(sugerencias[i].polygon, sugerencias[j].polygon)) {
        throw new Error(`${sugerencias[i].id} se superpone con ${sugerencias[j].id}.`);
      }
    }
  }
  console.log('OK todas contenidas, con superficie y sin superponerse');

  // La sugerencia no persiste nada por sí sola.
  const antes = (await request('/api/lotes')).body as { lotes: unknown[] };
  if (antes.lotes.length !== 0) throw new Error('La sugerencia persistió lotes sin confirmación.');
  console.log('OK la sugerencia no guardó nada');

  // Y confirmada entra por el endpoint de siempre, sin retoques.
  for (const sugerencia of sugerencias) {
    const creado = await request('/api/lotes', { method: 'POST', body: JSON.stringify({ polygon: sugerencia.polygon }) });
    if (creado.status !== 201) {
      throw new Error(`${sugerencia.id} fue rechazada por POST /api/lotes (${creado.status}): ${JSON.stringify(creado.body)}`);
    }
  }
  const despues = (await request('/api/lotes')).body as { lotes: unknown[] };
  if (despues.lotes.length !== sugerencias.length) throw new Error('No se crearon todos los lotes confirmados.');
  console.log(`OK las ${sugerencias.length} sugerencias se confirmaron contra POST /api/lotes`);

  console.log('\nSmoke de sugerencia con IA completo.');
} finally {
  await eliminarUsuarioSmoke(pool, username);
  const restante = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM usuarios WHERE username = $1', [username]);
  if (restante.rows[0].count !== 0) throw new Error('El cleanup no eliminó completamente el usuario smoke.');
  console.log('Usuario smoke eliminado.');
  await pool.end();
}
