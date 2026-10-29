import { expect, test, type Page, type Route } from '@playwright/test';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  establishment: '22222222-2222-4222-8222-222222222222',
  ownerPost: '33333333-3333-4333-8333-333333333333',
  adminPost: '44444444-4444-4444-8444-444444444444',
  viewerPost: '55555555-5555-4555-8555-555555555555',
};

type Role = 'PROPIETARIO' | 'ADMINISTRADOR' | 'VISOR';

const polygon = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-58.5, -34.5], [-58.49, -34.5], [-58.49, -34.49], [-58.5, -34.49], [-58.5, -34.5]]],
  },
} as const;

const lote = {
  id: '66666666-6666-4666-8666-666666666666',
  numero: 1,
  apodo: 'Norte',
  polygon,
  activo: true,
  tipoPastura: null,
  fechaSiembra: null,
  favorito: false,
  createdAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

function membresia(rol: Role) {
  const permisos = rol === 'ADMINISTRADOR'
    ? ['crear_lotes', 'ver_dispositivos_gps']
    : [];
  return {
    establecimientoId: ids.establishment,
    userId: ids.user,
    puestoOperativoId: rol === 'PROPIETARIO' ? ids.ownerPost : rol === 'ADMINISTRADOR' ? ids.adminPost : ids.viewerPost,
    nombreOperativo: rol === 'PROPIETARIO' ? 'Propietario principal' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor',
    rol,
    principal: rol === 'PROPIETARIO',
    permisos,
    capacidades: [],
  };
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, role: Role): Promise<void> {
  const membership = membresia(role);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://server.arcgisonline.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === '/api/auth/me' && method === 'GET') {
      await json(route, 401, { error: { code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' } });
    } else if (path === '/api/auth/login' && method === 'POST') {
      await json(route, 200, { user: { id: ids.user, email: 'qa@example.test', username: 'qa_rodeo', onboardingCompleted: true } });
    } else if (path === '/api/auth/logout' && method === 'POST') {
      await route.fulfill({ status: 204, body: '' });
    } else if (path === '/api/establecimientos' && method === 'GET') {
      await json(route, 200, { establecimientos: [{ id: ids.establishment, nombre: 'Campo de prueba', onboardingCompleted: true, membresia: membership }] });
    } else if (path === `/api/establecimientos/${ids.establishment}/puestos/${membership.puestoOperativoId}/entrar` && method === 'POST') {
      await json(route, 200, { sesion: { puestoOperativoId: membership.puestoOperativoId, establecimientoId: ids.establishment, nombreOperativo: membership.nombreOperativo, rol: role, venceEn: '2026-10-29T18:00:00.000Z' } });
    } else if (path === `/api/establecimientos/${ids.establishment}` && method === 'GET') {
      await json(route, 200, {
        establecimiento: { id: ids.establishment, nombre: 'Campo de prueba', polygon, createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z', onboardingCompleted: true },
        membresia: membership,
      });
    } else if (path === `/api/establecimientos/${ids.establishment}/lotes` && method === 'GET') {
      await json(route, 200, { lotes: [lote] });
    } else if (path === `/api/establecimientos/${ids.establishment}/lotes/lecturas` && method === 'GET') {
      await json(route, 200, { satelite: [], clima: {} });
    } else if (path === '/api/copernicus/estado' && method === 'GET') {
      await json(route, 200, { configurado: false });
    } else if (path === `/api/establecimientos/${ids.establishment}/actualizar-pendientes` && method === 'POST') {
      await json(route, 200, { ejecutado: false, motivo: 'reciente' });
    } else if (path === `/api/establecimientos/${ids.establishment}/lotes/orden-pastoreo` && method === 'GET') {
      await json(route, 200, { desde: '2026-10-29', hasta: '2026-11-05', lotes: [] });
    } else if (path === '/api/notificaciones-personales' && method === 'GET') {
      await json(route, 200, { notificaciones: [], noLeidas: 0, paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else {
      await json(route, 404, { error: { code: 'NOT_MOCKED', message: `Ruta no simulada: ${method} ${path}` } });
    }
  });
}

async function iniciarSesion(page: Page, role: Role): Promise<void> {
  await mockApi(page, role);
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Ingresá tu e-mail').fill('qa@example.test');
  await page.getByLabel('Ingresá tu contraseña').fill('correcta123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Mis establecimientos' })).toBeVisible();
}

async function entrarAlCampo(page: Page, role: Role): Promise<void> {
  await iniciarSesion(page, role);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Campo de prueba' })).toBeVisible();
}

test('Propietario inicia sesión, navega al campo y puede cerrar sesión', async ({ page }) => {
  await entrarAlCampo(page, 'PROPIETARIO');
  await expect(page.getByRole('button', { name: 'Agregar lote' })).toBeVisible();
  await page.getByRole('button', { name: 'Configuración' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

test('Administrador ve operaciones habilitadas por sus permisos', async ({ page }) => {
  await entrarAlCampo(page, 'ADMINISTRADOR');
  await expect(page.getByRole('button', { name: 'Agregar lote' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mis dispositivos' })).toBeVisible();
});

test('Visor no ve acciones de creación ni navegación a GPS', async ({ page }) => {
  await entrarAlCampo(page, 'VISOR');
  await expect(page.getByRole('button', { name: 'Agregar lote' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Mis dispositivos' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Campo de prueba' })).toBeVisible();
});
