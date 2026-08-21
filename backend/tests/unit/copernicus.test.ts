import { describe, expect, test } from 'vitest';
import { ApiError } from '../../src/http/errors.js';
import { CopernicusClient, type RespuestaCopernicus } from '../../src/services/copernicus.js';

function cliente(contenido: RespuestaCopernicus[], credenciales = { clientId: 'id-de-prueba', clientSecret: 'secret-de-prueba' }) {
  const llamadas: Array<{ url: string; cuerpo: string; autorizacion?: string }> = [];
  const client = new CopernicusClient(() => credenciales, async (url, cuerpo, headers) => {
    llamadas.push({ url, cuerpo, autorizacion: headers.Authorization });
    const respuesta = contenido.shift();
    if (!respuesta) throw new Error('respuesta de prueba agotada');
    return respuesta;
  });
  return { client, llamadas };
}

describe('gateway backend de Copernicus', () => {
  test('detecta credenciales ausentes sin impedir importar el servicio', () => {
    const { client } = cliente([], { clientId: '', clientSecret: '' });
    expect(client.credencialesConfiguradas()).toBe(false);
  });

  test('devuelve 503 si statistics se solicita sin configurar Copernicus', async () => {
    const { client } = cliente([], { clientId: '', clientSecret: '' });
    await expect(client.obtenerEstadisticas('{}')).rejects.toMatchObject({
      status: 503,
      code: 'COPERNICUS_NOT_CONFIGURED',
      message: 'Copernicus no está configurado en el backend.',
    });
  });

  test('obtiene token, reenvía la respuesta y conserva un 429 del upstream', async () => {
    const { client, llamadas } = cliente([
      { status: 200, texto: JSON.stringify({ access_token: 'token-de-prueba', expires_in: 3600 }) },
      { status: 429, texto: JSON.stringify({ error: 'rate_limit' }) },
    ]);
    const respuesta = await client.obtenerEstadisticas('{"input":{}}');
    expect(respuesta).toEqual({ status: 429, texto: JSON.stringify({ error: 'rate_limit' }) });
    expect(llamadas[1].autorizacion).toBe('Bearer token-de-prueba');
    expect(llamadas.map((llamada) => llamada.cuerpo)).toContain('{"input":{}}');
  });

  test('renueva el token una sola vez cuando statistics responde 401', async () => {
    const { client, llamadas } = cliente([
      { status: 200, texto: JSON.stringify({ access_token: 'token-uno', expires_in: 3600 }) },
      { status: 401, texto: '{}' },
      { status: 200, texto: JSON.stringify({ access_token: 'token-dos', expires_in: 3600 }) },
      { status: 200, texto: '{"ok":true}' },
    ]);
    const respuesta = await client.obtenerEstadisticas('{}');
    expect(respuesta).toEqual({ status: 200, texto: '{"ok":true}' });
    expect(llamadas.filter((llamada) => llamada.autorizacion).map((llamada) => llamada.autorizacion)).toEqual(['Bearer token-uno', 'Bearer token-dos']);
  });

  test('no filtra el secreto si la autenticación del upstream falla', async () => {
    const { client } = cliente([{ status: 401, texto: 'secreto-no-debe-aparecer' }]);
    try { await client.obtenerEstadisticas('{}'); } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as Error).message).not.toContain('secret-de-prueba');
    }
  });
});
