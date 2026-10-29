import { expect, test, type Page, type Route } from '@playwright/test';

const establecimientoId = '22222222-2222-4222-8222-222222222222';
const loteId = '33333333-3333-4333-8333-333333333333';
const ahora = '2026-10-29T12:00:00.000Z';

const poligono = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[[-58.02, -34.02], [-57.98, -34.02], [-57.98, -33.98], [-58.02, -33.98], [-58.02, -34.02]]],
  },
};

const establecimiento = {
  id: establecimientoId,
  nombre: 'Campo de prueba',
  polygon: poligono,
  createdAt: ahora,
  updatedAt: ahora,
  onboardingCompleted: true,
};

const lote = {
  id: loteId,
  numero: 1,
  apodo: 'Potrero norte',
  polygon: {
    ...poligono,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[-58.015, -34.015], [-57.995, -34.015], [-57.995, -33.995], [-58.015, -33.995], [-58.015, -34.015]]],
    },
  },
  activo: true,
  tipoPastura: null,
  fechaSiembra: null,
  favorito: false,
  createdAt: ahora,
  updatedAt: ahora,
};

const usuario = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'qa@example.test',
  username: 'qa_rodeo',
  onboardingCompleted: true,
};

const membresia = {
  establecimientoId,
  userId: usuario.id,
  puestoOperativoId: '44444444-4444-4444-8444-444444444444',
  nombreOperativo: 'Propietario principal',
  sesionOperativaId: '55555555-5555-4555-8555-555555555555',
  rol: 'PROPIETARIO',
  principal: true,
  permisos: [],
  capacidades: [],
};

async function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function prepararApi(page: Page, opciones: { errorLotes?: boolean; retenerEstablecimiento?: () => Promise<void> } = {}): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://server.arcgisonline.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://{s}.tile.openstreetmap.org/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/me' && request.method() === 'GET') {
      await fulfill(route, { user: usuario });
    } else if (path === `/api/establecimientos/${establecimientoId}` && request.method() === 'GET') {
      await opciones.retenerEstablecimiento?.();
      await fulfill(route, { establecimiento, membresia });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes` && request.method() === 'GET') {
      if (opciones.errorLotes) {
        await fulfill(route, { error: { code: 'TEST_LOAD_ERROR', message: 'No se pudieron cargar los lotes simulados.' } }, 503);
      } else {
        await fulfill(route, { lotes: [lote] });
      }
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/lecturas` && request.method() === 'GET') {
      await fulfill(route, { satelite: [], clima: {} });
    } else if (path === `/api/establecimientos/${establecimientoId}/actualizar-pendientes` && request.method() === 'POST') {
      await fulfill(route, { ejecutado: false, motivo: 'reciente' });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}` && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { apodo?: string };
      await fulfill(route, { lote: { ...lote, apodo: body.apodo ?? lote.apodo, updatedAt: ahora } });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}/estado` && request.method() === 'GET') {
      await fulfill(route, {
        lote: { id: loteId, numero: 1, apodo: lote.apodo, activo: true },
        satelite: { optico: null, radar: null },
        clima: null,
        uso: { ultimoUso: null, diasDescanso: null },
      });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}/mediciones-satelitales` && request.method() === 'GET') {
      await fulfill(route, { mediciones: [], paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}/clima` && request.method() === 'GET') {
      await fulfill(route, { consultas: [], paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}/usos` && request.method() === 'GET') {
      await fulfill(route, { usos: [], paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/${loteId}/estimacion` && request.method() === 'GET') {
      await fulfill(route, { error: { code: 'NOT_MOCKED', message: 'Estimación sin datos en esta prueba.' } }, 404);
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/orden-pastoreo` && request.method() === 'GET') {
      await fulfill(route, { hoy: '2026-10-29', leyenda: 'Orden según los datos disponibles. La decisión es tuya.', lotes: [] });
    } else {
      await fulfill(route, { error: { code: 'NOT_MOCKED', message: `Ruta sin mock: ${path}` } }, 404);
    }
  });
}

async function abrirListaDeLotes(page: Page): Promise<void> {
  await page.locator('details summary').filter({ hasText: 'Lotes' }).click();
}

test('carga el mapa, permite seleccionar un lote y abrir su ficha', async ({ page }) => {
  await prepararApi(page);
  await page.goto(`/establecimientos/${establecimientoId}`, { waitUntil: 'commit' });

  await expect(page.getByText('Campo de prueba')).toBeVisible();
  await abrirListaDeLotes(page);
  await page.getByRole('listitem').filter({ hasText: 'Potrero norte' }).click();
  await expect(page.getByText('Potrero norte')).toBeVisible();
  await page.getByRole('button', { name: 'Ver ficha' }).click();

  await expect(page.getByRole('heading', { name: 'Lote 1' })).toBeVisible();
  await expect(page.getByText('Sin datos').first()).toBeVisible();
});

test('muestra el estado de carga y un error recuperable al fallar la API de lotes', async ({ page }) => {
  let liberarCarga!: () => void;
  const cargaRetenida = new Promise<void>((resolve) => { liberarCarga = resolve; });
  let establecimientoSolicitado!: () => void;
  const solicitado = new Promise<void>((resolve) => { establecimientoSolicitado = resolve; });
  await prepararApi(page, { errorLotes: true, retenerEstablecimiento: async () => { establecimientoSolicitado(); await cargaRetenida; } });
  await page.goto(`/establecimientos/${establecimientoId}`, { waitUntil: 'commit' });

  await solicitado;
  await expect(page.getByText(/Cargando establecimiento/)).toBeVisible();
  liberarCarga();
  await expect(page.getByRole('alert')).toContainText('No se pudieron cargar los lotes simulados.');
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('edita el apodo desde las opciones del lote y refleja la respuesta de la API', async ({ page }) => {
  let cuerpoEnviado: unknown;
  await prepararApi(page);
  await page.route(`**/api/establecimientos/${establecimientoId}/lotes/${loteId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    cuerpoEnviado = route.request().postDataJSON();
    const apodo = (cuerpoEnviado as { apodo?: string }).apodo;
    await fulfill(route, { lote: { ...lote, apodo, updatedAt: ahora } });
  });
  await page.goto(`/establecimientos/${establecimientoId}`, { waitUntil: 'commit' });
  await expect(page.getByText('Campo de prueba')).toBeVisible();
  await abrirListaDeLotes(page);
  await page.getByRole('listitem').filter({ hasText: 'Potrero norte' }).click();
  await page.getByLabel('Más opciones: Lote 1').click();
  await page.getByRole('button', { name: 'Apodo' }).click();
  await page.getByLabel('Apodo').fill('Potrero renovado');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText('Potrero renovado', { exact: true })).toBeVisible();
  expect(cuerpoEnviado).toEqual({ apodo: 'Potrero renovado' });
});
