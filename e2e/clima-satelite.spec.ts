import { expect, test, type Page, type Route } from '@playwright/test';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  establecimiento: '22222222-2222-4222-8222-222222222222',
  puesto: '33333333-3333-4333-8333-333333333333',
  lote1: '44444444-4444-4444-8444-444444444444',
  lote2: '55555555-5555-4555-8555-555555555555',
};

const poligono = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-58.5, -34.5], [-58.49, -34.5], [-58.49, -34.49], [-58.5, -34.49], [-58.5, -34.5]]],
  },
} as const;

const lotes = [
  { id: ids.lote1, numero: 1, apodo: 'Norte', polygon: poligono, activo: true, tipoPastura: null, fechaSiembra: null, favorito: false, createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z' },
  { id: ids.lote2, numero: 2, apodo: 'Sur', polygon: poligono, activo: true, tipoPastura: null, fechaSiembra: null, favorito: false, createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z' },
];

const climaAnterior = {
  estado: 'ok',
  loteId: ids.lote1,
  categoria: 'normal',
  clima: {
    consultadoEn: Date.parse('2026-10-29T12:00:00.000Z'),
    dias: [{ fecha: '2026-10-29', lluviaMm: 2, tempMin: 10, tempMax: 20, radiacionMjM2: 15, evapotranspiracionMm: 2, esPronostico: true }],
    lluviaUltimos7Dias: 14,
    lluviaProximosDias: 8,
    hoy: { fecha: '2026-10-29', lluviaMm: 2, tempMin: 10, tempMax: 20, radiacionMjM2: 15, evapotranspiracionMm: 2, esPronostico: true },
  },
} as const;

const radarAnterior = {
  estado: 'radar',
  loteId: ids.lote1,
  mensaje: 'Sentinel-1 es más reciente que la última observación óptica.',
  condicion: { fecha: '2026-10-27', diasDesde: 2, rvi: { media: 0.42, mediana: 0.41, min: 0.3, max: 0.5, desvio: 0.04 } },
} as const;

async function responder(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function resumenClima(opciones: { errores?: number; persistidos?: number; pendientes?: number; consultados?: number; cortado?: boolean } = {}) {
  const { errores = 0, persistidos = 0, pendientes = 2, consultados = pendientes, cortado = false } = opciones;
  return {
    ejecutado: true,
    resumen: {
      comenzoEn: '2026-10-29T12:00:00.000Z',
      terminoEn: '2026-10-29T12:00:05.000Z',
      satelite: { pendientes: 0, consultados: 0, persistidos: 0, sinDatos: 0, errores: 0, fallosProveedor: 0, erroresPersistencia: 0, cortado: false },
      clima: { pendientes, consultados, persistidos, sinDatos: 0, errores, fallosProveedor: errores, erroresPersistencia: 0, cortado },
    },
  };
}

async function prepararCampo(page: Page, opciones: {
  actualizaciones?: Array<{ status: number; body?: unknown }>;
  lecturas?: Array<{ clima: Record<string, unknown>; satelite?: unknown[] }>;
  climaManual?: { status: number; body?: unknown };
} = {}): Promise<void> {
  let lecturasIndex = 0;
  let actualizacionesIndex = 0;
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://server.arcgisonline.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === '/api/auth/me' && method === 'GET') {
      await responder(route, 401, { error: { code: 'UNAUTHENTICATED', message: 'No hay sesión.' } });
    } else if (pathname === '/api/auth/login' && method === 'POST') {
      await responder(route, 200, { user: { id: ids.user, email: 'qa@example.test', username: 'qa_rodeo', onboardingCompleted: true } });
    } else if (pathname === '/api/establecimientos' && method === 'GET') {
      await responder(route, 200, { establecimientos: [{ id: ids.establecimiento, nombre: 'Campo QA', onboardingCompleted: true, membresia: { establecimientoId: ids.establecimiento, userId: ids.user, puestoOperativoId: ids.puesto, nombreOperativo: 'Propietario principal', rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] } }] });
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/puestos/${ids.puesto}/entrar` && method === 'POST') {
      await responder(route, 200, { sesion: { puestoOperativoId: ids.puesto, establecimientoId: ids.establecimiento, nombreOperativo: 'Propietario principal', rol: 'PROPIETARIO', venceEn: '2026-10-29T18:00:00.000Z' } });
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}` && method === 'GET') {
      await responder(route, 200, { establecimiento: { id: ids.establecimiento, nombre: 'Campo QA', polygon: poligono, createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z', onboardingCompleted: true }, membresia: { establecimientoId: ids.establecimiento, userId: ids.user, puestoOperativoId: ids.puesto, nombreOperativo: 'Propietario principal', rol: 'PROPIETARIO', principal: true, permisos: [], capacidades: [] } });
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/lotes` && method === 'GET') {
      await responder(route, 200, { lotes });
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/lotes/lecturas` && method === 'GET') {
      const lectura = opciones.lecturas?.[Math.min(lecturasIndex++, (opciones.lecturas?.length ?? 1) - 1)]
        ?? { clima: {}, satelite: [] };
      await responder(route, 200, { clima: lectura.clima, satelite: lectura.satelite ?? [] });
    } else if (pathname === '/api/copernicus/estado' && method === 'GET') {
      await responder(route, 200, { configurado: true });
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/actualizar-pendientes` && method === 'POST') {
      const respuesta = opciones.actualizaciones?.[Math.min(actualizacionesIndex++, (opciones.actualizaciones?.length ?? 1) - 1)]
        ?? { status: 200, body: { ejecutado: false, motivo: 'reciente' } };
      await responder(route, respuesta.status, respuesta.body ?? {});
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/lotes/clima/actualizar` && method === 'POST') {
      const respuesta = opciones.climaManual ?? { status: 200, body: { resultados: {} } };
      await responder(route, respuesta.status, respuesta.body ?? {});
    } else if (pathname === `/api/establecimientos/${ids.establecimiento}/lotes/orden-pastoreo` && method === 'GET') {
      await responder(route, 200, { desde: '2026-10-29', hasta: '2026-11-05', lotes: [] });
    } else {
      await responder(route, 404, { error: { code: 'NOT_MOCKED', message: `Ruta no simulada: ${method} ${pathname}` } });
    }
  });

  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Ingresá tu e-mail').fill('qa@example.test');
  await page.getByLabel('Ingresá tu contraseña').fill('correcta123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Mis establecimientos' })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Campo QA' })).toBeVisible();
}

test('muestra lecturas climáticas disponibles y faltantes con sus datos satelitales separados', async ({ page }) => {
  await prepararCampo(page, {
    lecturas: [{ clima: { [ids.lote1]: climaAnterior, [ids.lote2]: { estado: 'error', loteId: ids.lote2, mensaje: 'Sin lectura climática guardada.' } }, satelite: [radarAnterior] }],
  });

  await page.getByRole('tab', { name: 'Clima' }).click();
  await expect(page.getByText('14 mm', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin lectura climática guardada.')).toBeVisible();
  await page.getByRole('tab', { name: 'Condición' }).click();
  await expect(page.getByText('Radar (respaldo)')).toBeVisible();
  await expect(page.getByText(/Satélite consultado/)).toHaveCount(0);
});

test('muestra aviso de actualización climática parcial y conserva lecturas persistidas', async ({ page }) => {
  await prepararCampo(page, {
    actualizaciones: [{ status: 200, body: resumenClima({ errores: 1, persistidos: 1, pendientes: 2, consultados: 2 }) }],
    lecturas: [
      { clima: { [ids.lote1]: climaAnterior }, satelite: [] },
      { clima: { [ids.lote1]: climaAnterior, [ids.lote2]: { estado: 'error', loteId: ids.lote2, mensaje: 'No se obtuvo una lectura nueva.' } }, satelite: [] },
    ],
  });

  await expect(page.getByRole('status')).toContainText(/actualización del clima quedó parcial/i);
  await page.getByRole('tab', { name: 'Clima' }).click();
  await expect(page.getByText('14 mm', { exact: true })).toBeVisible();
  await expect(page.getByText('No se obtuvo una lectura nueva.')).toBeVisible();
});

test('ante error del proveedor mantiene lecturas anteriores y avisa sin bloquear el mapa', async ({ page }) => {
  await prepararCampo(page, {
    actualizaciones: [{ status: 503, body: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Servicio temporalmente no disponible.' } } }],
    lecturas: [{ clima: { [ids.lote1]: climaAnterior }, satelite: [radarAnterior] }],
  });

  await expect(page.getByRole('status')).toContainText(/No se pudo actualizar o recargar el clima/i);
  await page.getByRole('tab', { name: 'Clima' }).click();
  await expect(page.getByText('14 mm', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Campo QA' })).toBeVisible();
  await page.getByRole('tab', { name: 'Condición' }).click();
  await expect(page.getByText('Radar (respaldo)')).toBeVisible();
  await expect(page.getByText(/Satélite consultado/)).toHaveCount(0);
});

test('la actualización manual completa informa éxito y guarda la respuesta climática mockeada', async ({ page }) => {
  const climaNuevo = {
    ...climaAnterior,
    clima: { ...climaAnterior.clima, consultadoEn: Date.parse('2026-10-29T13:00:00.000Z'), lluviaUltimos7Dias: 25 },
  };
  const climaNuevoSur = { ...climaNuevo, loteId: ids.lote2 };
  await prepararCampo(page, {
    lecturas: [{ clima: {}, satelite: [] }],
    climaManual: { status: 200, body: { resultados: { [ids.lote1]: climaNuevo, [ids.lote2]: climaNuevoSur } } },
  });

  await page.getByRole('tab', { name: 'Clima' }).click();
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Clima consultado para 2 lotes.')).toBeVisible();
  await expect(page.getByText('25 mm', { exact: true })).toHaveCount(2);
});
