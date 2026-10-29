import { expect, test, type Page, type Route } from '@playwright/test';

const usuario = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'qa@example.test',
  username: 'qa_rodeo',
  onboardingCompleted: true,
};

async function responder(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function simularApi(page: Page, loginStatus = 401): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/auth/me' && request.method() === 'GET') {
      await responder(route, 401, { error: { code: 'UNAUTHENTICATED', message: 'No hay sesión.' } });
    } else if (url.pathname === '/api/auth/login' && request.method() === 'POST') {
      await responder(route, loginStatus, loginStatus === 200
        ? { user: usuario }
        : { error: { code: 'INVALID_CREDENTIALS', message: 'El email o la contraseña no son correctos.' } });
    } else if (url.pathname === '/api/auth/register' && request.method() === 'POST') {
      await responder(route, 400, { error: { code: 'INVALID_PASSWORD', message: 'La contraseña no puede superar los 72 bytes en UTF-8.' } });
    } else if (url.pathname === '/api/establecimientos' && request.method() === 'GET') {
      await responder(route, 200, { establecimientos: [] });
    } else if (url.pathname === '/api/notificaciones-personales' && request.method() === 'GET') {
      await responder(route, 200, { notificaciones: [], noLeidas: 0, paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else {
      await responder(route, 404, { error: { code: 'NOT_MOCKED', message: 'Ruta no simulada en esta prueba.' } });
    }
  });
}

test('muestra el error de login del API y no aparenta autenticar', async ({ page }) => {
  await simularApi(page);
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Ingresá tu e-mail').fill('qa@example.test');
  await page.getByLabel('Ingresá tu contraseña').fill('incorrecta123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('alert')).toHaveText('El email o la contraseña no son correctos.');
  await expect(page.getByRole('heading', { name: 'Mis establecimientos' })).toHaveCount(0);
});

test('login exitoso lleva al listado vacío de establecimientos', async ({ page }) => {
  await simularApi(page, 200);
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Ingresá tu e-mail').fill(usuario.email);
  await page.getByLabel('Ingresá tu contraseña').fill('correcta123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('heading', { name: 'Mis establecimientos' })).toBeVisible();
  await expect(page.getByText(/activa:/)).toContainText(usuario.username);
  await expect(page.getByText('Creá un establecimiento o unite con un código de invitación.')).toBeVisible();
});

test('muestra errores de validación del backend durante el registro', async ({ page }) => {
  await simularApi(page);
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Ingresá tu e-mail').fill(usuario.email);
  await page.getByLabel('Usuario').fill(usuario.username);
  await page.getByLabel('Ingresá tu contraseña').fill('a'.repeat(73));
  await page.getByLabel('Confirmar contraseña').fill('a'.repeat(73));
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByRole('alert')).toHaveText('La contraseña no puede superar los 72 bytes en UTF-8.');
  await expect(page.getByRole('heading', { name: 'Mis establecimientos' })).toHaveCount(0);
});
