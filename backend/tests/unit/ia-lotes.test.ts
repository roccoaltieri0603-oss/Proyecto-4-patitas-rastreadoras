import { describe, expect, test } from 'vitest';
import { ClienteIaLotes, type TransporteIa } from '../../src/services/ia-lotes.js';
import { establecimiento, lote } from '../helpers/fixtures.js';

const CONFIGURADO = { url: 'http://localhost:8001', token: 'token-de-prueba', timeoutMs: 5000 };

function cliente(respuestas: Array<{ status: number; texto: string } | Error>) {
  const llamadas: Array<{ url: string; cuerpo: string; cabeceras: Record<string, string> }> = [];
  const transporte: TransporteIa = async (url, cuerpo, cabeceras) => {
    llamadas.push({ url, cuerpo, cabeceras });
    const respuesta = respuestas.shift();
    if (!respuesta) throw new Error('respuesta de prueba agotada');
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  };
  return { client: new ClienteIaLotes(() => CONFIGURADO, transporte), llamadas };
}

function timeout(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

describe('puente backend hacia el microservicio de IA', () => {
  test('sin URL configurada la función queda apagada, no rota', async () => {
    const apagado = new ClienteIaLotes(() => ({ url: '', token: '', timeoutMs: 5000 }));

    expect(apagado.configurado()).toBe(false);
    await expect(apagado.segmentar(establecimiento)).rejects.toMatchObject({ status: 503, code: 'IA_NOT_CONFIGURED' });
  });

  test('manda el polígono con el token y devuelve los polígonos detectados', async () => {
    const { client, llamadas } = cliente([{
      status: 200,
      texto: JSON.stringify({ poligonos: [lote(1, 2)], meta: { modelo: 'DelineateAnything-S.pt', zoom: 17, segundos: 4.2 } }),
    }]);

    const respuesta = await client.segmentar(establecimiento);

    expect(llamadas[0].url).toBe('http://localhost:8001/segmentar');
    expect(llamadas[0].cabeceras['X-IA-Token']).toBe('token-de-prueba');
    expect(JSON.parse(llamadas[0].cuerpo)).toEqual({ polygon: establecimiento });
    expect(respuesta.poligonos).toHaveLength(1);
    expect(respuesta.meta).toMatchObject({ modelo: 'DelineateAnything-S.pt', zoom: 17, segundos: 4.2 });
  });

  test('descarta lo que no sea una geometría válida en vez de arreglarlo', async () => {
    const { client } = cliente([{
      status: 200,
      texto: JSON.stringify({ poligonos: [lote(1, 2), { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }, null] }),
    }]);

    const respuesta = await client.segmentar(establecimiento);

    expect(respuesta.poligonos).toHaveLength(1);
    expect(respuesta.meta.detectadas).toBe(1);
  });

  test('traduce el timeout, la caída del servicio y el error upstream', async () => {
    const conTimeout = cliente([timeout()]);
    await expect(conTimeout.client.segmentar(establecimiento)).rejects.toMatchObject({ status: 504, code: 'IA_TIMEOUT' });

    const caido = cliente([new Error('connect ECONNREFUSED')]);
    await expect(caido.client.segmentar(establecimiento)).rejects.toMatchObject({ status: 502, code: 'IA_UNREACHABLE' });

    const upstream = cliente([{ status: 503, texto: JSON.stringify({ detail: 'Faltan los pesos del modelo.' }) }]);
    await expect(upstream.client.segmentar(establecimiento)).rejects.toMatchObject({
      status: 502,
      code: 'IA_UPSTREAM_ERROR',
      message: 'Faltan los pesos del modelo.',
    });
  });

  test('una respuesta sin polígonos es un error, no una lista vacía inventada', async () => {
    const { client } = cliente([{ status: 200, texto: JSON.stringify({ meta: {} }) }]);

    await expect(client.segmentar(establecimiento)).rejects.toMatchObject({ status: 502, code: 'IA_INVALID_RESPONSE' });
  });
});
