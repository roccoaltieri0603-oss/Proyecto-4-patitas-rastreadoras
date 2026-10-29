import { expect, test, type Page, type Route } from '@playwright/test';

const establecimientoId = '22222222-2222-4222-8222-222222222222';
const usuarioId = '11111111-1111-4111-8111-111111111111';
const loteId = '33333333-3333-4333-8333-333333333333';
const gpsUnoId = '44444444-4444-4444-8444-444444444444';
const gpsDosId = '55555555-5555-4555-8555-555555555555';
const puestoId = '66666666-6666-4666-8666-666666666666';

const poligono = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-58.01, -34.01], [-57.99, -34.01], [-57.99, -33.99], [-58.01, -33.99], [-58.01, -34.01]]],
  },
};

const lote = {
  id: loteId,
  numero: 1,
  apodo: 'Norte',
  polygon: poligono,
  activo: true,
  tipoPastura: null,
  fechaSiembra: null,
  favorito: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

function dispositivo(numero: 1 | 2) {
  const id = numero === 1 ? gpsUnoId : gpsDosId;
  return {
    id,
    numero,
    identificadorEquipo: id,
    apodo: `GPS simulado ${numero}`,
    actualizadaEn: '2026-10-28T12:00:00.000Z',
    conexion: 'en-linea',
    bateriaPorcentaje: 85,
    latitud: -34,
    longitud: -58,
    ultimaSenal: null,
    ubicacion: { latitud: -34, longitud: -58, precisionMetros: null },
    loteId,
    numeroLote: 1,
    animalId: null,
    condicionBateria: 'normal',
    dentroEstablecimiento: true,
    loteActual: { id: loteId, numero: 1, apodo: 'Norte' },
    loteAsignado: { id: loteId, numero: 1, apodo: 'Norte' },
    incidenciasActivas: [],
  };
}

interface OpcionesMock {
  rol?: 'PROPIETARIO' | 'ADMINISTRADOR' | 'VISOR';
  permisos?: string[];
  errorAlGuardar?: boolean;
}

async function responder(route: Route, status: number, cuerpo: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(cuerpo),
  });
}

async function simularApi(page: Page, opciones: OpcionesMock = {}): Promise<void> {
  const rol = opciones.rol ?? 'PROPIETARIO';
  const permisos = opciones.permisos ?? [];
  const gps = [dispositivo(1), dispositivo(2)];
  const establecimiento = {
    id: establecimientoId,
    nombre: 'Campo de demostración',
    polygon: poligono,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    onboardingCompleted: true,
  };
  const membresia = {
    establecimientoId,
    userId: usuarioId,
    puestoOperativoId: puestoId,
    nombreOperativo: rol === 'PROPIETARIO' ? 'Propietario principal' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor',
    rol,
    principal: rol === 'PROPIETARIO',
    permisos,
    capacidades: [],
  };

  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://server.arcgisonline.com/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/me' && method === 'GET') {
      await responder(route, 200, { user: { id: usuarioId, email: 'qa@example.test', username: 'qa_rodeo', onboardingCompleted: true } });
    } else if (path === `/api/establecimientos/${establecimientoId}` && method === 'GET') {
      await responder(route, 200, { establecimiento, membresia });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes` && method === 'GET') {
      await responder(route, 200, { lotes: [lote] });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/lecturas` && method === 'GET') {
      await responder(route, 200, { satelite: [], clima: {} });
    } else if (path === `/api/establecimientos/${establecimientoId}/lotes/orden-pastoreo` && method === 'GET') {
      await responder(route, 200, { hoy: '2026-10-29', leyenda: 'Orden según los datos disponibles. La decisión es tuya.', lotes: [] });
    } else if (path === `/api/establecimientos/${establecimientoId}/actualizar-pendientes` && method === 'POST') {
      await responder(route, 200, { ejecutado: false, motivo: 'reciente' });
    } else if (path === `/api/establecimientos/${establecimientoId}/ia/estado` && method === 'GET') {
      await responder(route, 200, { configurado: false });
    } else if (path === '/api/copernicus/estado' && method === 'GET') {
      await responder(route, 200, { configurado: false });
    } else if (path === `/api/establecimientos/${establecimientoId}/dispositivos-simulados` && method === 'GET') {
      // Esta ruta provisiona GPS en el backend; el mock impide que la solicitud llegue a persistencia.
      await responder(route, 200, { dispositivos: gps });
    } else if (path === `/api/establecimientos/${establecimientoId}/dispositivos-simulados/responsables` && method === 'GET') {
      await responder(route, 200, { dispositivos: [], administradores: [] });
    } else if (path.startsWith(`/api/establecimientos/${establecimientoId}/dispositivos-simulados/`) && method === 'PATCH') {
      if (opciones.errorAlGuardar) {
        await responder(route, 400, { error: { code: 'INVALID_GPS_NICKNAME', message: 'No se pudieron guardar los cambios del GPS.' } });
        return;
      }
      const id = path.split('/').at(-1);
      const index = gps.findIndex((item) => item.id === id);
      if (index < 0) {
        await responder(route, 404, { error: { code: 'GPS_SIMULATED_NOT_FOUND', message: 'Dispositivo no disponible.' } });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      const asignadoId = body.loteAsignadoId === null ? null : body.loteAsignadoId ?? gps[index].loteAsignado?.id;
      gps[index] = {
        ...gps[index],
        ...body,
        loteAsignado: asignadoId ? { id: loteId, numero: 1, apodo: 'Norte' } : null,
        condicionBateria: typeof body.bateriaPorcentaje === 'number' && body.bateriaPorcentaje <= 20 ? 'critica' : 'normal',
      } as typeof gps[number];
      await responder(route, 200, { dispositivo: gps[index] });
    } else if (path === `/api/establecimientos/${establecimientoId}/notificaciones` && method === 'GET') {
      await responder(route, 200, { notificaciones: [], noLeidas: 0, paginacion: { limit: 20, offset: 0, total: 0, hayMas: false } });
    } else {
      // Ninguna petición no prevista debe escapar del navegador hacia un servicio real.
      await responder(route, 404, { error: { code: 'NOT_MOCKED', message: 'Ruta no simulada en esta prueba.' } });
    }
  });
}

test('muestra los dos GPS y guarda apodo, batería, conexión y lote', async ({ page }) => {
  await simularApi(page);
  await page.goto(`/establecimientos/${establecimientoId}/dispositivos`, { waitUntil: 'commit' });

  await expect(page.getByRole('heading', { name: 'Mis dispositivos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /GPS simulado 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /GPS simulado 2/ })).toBeVisible();

  await page.getByLabel('Apodo').fill('GPS potrero norte');
  await page.locator('input[type="number"][min="0"][max="100"]').fill('64');
  await page.getByLabel('Conexión simulada').selectOption('sin-senal');
  await page.getByLabel('Lote asignado').selectOption(loteId);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByRole('status')).toHaveText('Cambios guardados.');
  await expect(page.getByRole('button', { name: /GPS potrero norte/ })).toContainText('64%');
  await expect(page.getByRole('button', { name: /GPS potrero norte/ })).toContainText('Sin señal');
  await expect(page.getByText('Lote asignado', { exact: true })).toBeVisible();
  await expect(page.getByText('Lote 1 · Norte', { exact: true }).first()).toBeVisible();
});

test('muestra el error devuelto al fallar el guardado de un GPS', async ({ page }) => {
  await simularApi(page, { errorAlGuardar: true });
  await page.goto(`/establecimientos/${establecimientoId}/dispositivos`, { waitUntil: 'commit' });

  await expect(page.getByRole('heading', { name: 'Mis dispositivos' })).toBeVisible();
  await page.getByLabel('Apodo').fill('Cambio que falla');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByRole('alert')).toHaveText('No se pudieron guardar los cambios del GPS.');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('un administrador con permiso de lectura ve los GPS pero no los controles de edición', async ({ page }) => {
  await simularApi(page, { rol: 'ADMINISTRADOR', permisos: ['ver_dispositivos_gps'] });
  await page.goto(`/establecimientos/${establecimientoId}/dispositivos`, { waitUntil: 'commit' });

  await expect(page.getByRole('heading', { name: 'Mis dispositivos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /GPS simulado 2/ })).toBeVisible();
  await expect(page.getByText('Tenés permiso de lectura. Para editar este GPS, el propietario debe habilitar «Modificar dispositivos GPS» en Equipo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
});

test('muestra la bandeja de notificaciones vacía y oculta GPS y bandeja a un Visor', async ({ page }) => {
  await simularApi(page, { rol: 'PROPIETARIO' });
  await page.goto(`/establecimientos/${establecimientoId}`, { waitUntil: 'commit' });
  await page.getByRole('tab', { name: 'Notificaciones' }).click();
  await expect(page.getByText('No tenés notificaciones.')).toBeVisible();

  const visorPage = await page.context().newPage();
  await simularApi(visorPage, { rol: 'VISOR' });
  await visorPage.goto(`/establecimientos/${establecimientoId}`, { waitUntil: 'commit' });
  await expect(visorPage.getByRole('tablist', { name: 'Secciones' })).toBeVisible();
  await expect(visorPage.getByRole('tab', { name: 'Notificaciones' })).toHaveCount(0);
  await expect(visorPage.getByRole('link', { name: 'Mis dispositivos' })).toHaveCount(0);
});
