import { describe, expect, test } from 'vitest';
import { lote } from '../helpers/fixtures.js';
import { OpenMeteoClient, type RespuestaOpenMeteo } from '../../src/services/open-meteo.js';

function respuesta(json: unknown, ok = true, status = 200): RespuestaOpenMeteo {
  return { ok, status, json: async () => json };
}

const dias = Array.from({ length: 12 }, (_, i) => ({ fecha: `2026-08-${String(i + 10).padStart(2, '0')}`, lluvia: i === 7 ? 8 : 1, max: 20 + i, min: 5 + i }));
const registro = (offset = 0) => ({ daily: { time: dias.map((dia) => dia.fecha), precipitation_sum: dias.map((dia) => dia.lluvia + offset), temperature_2m_max: dias.map((dia) => dia.max), temperature_2m_min: dias.map((dia) => dia.min) } });

describe('cliente backend de Open-Meteo', () => {
  test('consulta un lote y conserva hoy en el índice 7', async () => {
    const client = new OpenMeteoClient(async () => respuesta(registro()));
    const referencia = new Date('2026-08-21T12:34:56.000Z');
    const resultado = await client.consultar([{ id: 'lote-1', polygon: lote(1, 2) }], referencia);
    expect(resultado['lote-1'].estado).toBe('ok');
    if (resultado['lote-1'].estado === 'ok') {
      expect(resultado['lote-1'].clima.hoy?.fecha).toBe('2026-08-17');
      expect(resultado['lote-1'].clima.dias[7].esPronostico).toBe(true);
      expect(resultado['lote-1'].clima.consultadoEn).toBe(referencia.getTime());
    }
  });

  test('asocia respuestas array a cada lote y conserva sumas de 7 y 5 días', async () => {
    const client = new OpenMeteoClient(async (url) => {
      expect(new URL(url).searchParams.get('latitude')?.split(',')).toHaveLength(2);
      return respuesta([registro(), registro(2)]);
    });
    const resultados = await client.consultar([{ id: 'lote-1', polygon: lote(1, 2) }, { id: 'lote-2', polygon: lote(3, 4) }]);
    expect(resultados['lote-1'].estado).toBe('ok');
    expect(resultados['lote-2'].estado).toBe('ok');
    if (resultados['lote-1'].estado === 'ok') expect(resultados['lote-1'].clima.lluviaUltimos7Dias).toBe(7);
    if (resultados['lote-2'].estado === 'ok') expect(resultados['lote-2'].clima.lluviaProximosDias).toBe(22);
  });

  test('preserva datos faltantes sin convertirlos en cero y controla respuestas inválidas', async () => {
    const lluvias: Array<number | null> = dias.map((dia) => dia.lluvia);
    lluvias[2] = null;
    const nullClient = new OpenMeteoClient(async () => respuesta({ daily: {
      time: dias.map((dia) => dia.fecha),
      precipitation_sum: lluvias,
      temperature_2m_max: dias.map((dia) => dia.max),
      temperature_2m_min: dias.map((dia) => dia.min),
    } }));
    const nullResult = await nullClient.consultar([{ id: 'lote-1', polygon: lote(1, 2) }]);
    expect(nullResult['lote-1'].estado).toBe('ok');
    if (nullResult['lote-1'].estado === 'ok') {
      expect(nullResult['lote-1'].clima.dias[2].lluviaMm).toBeNull();
      expect(nullResult['lote-1'].clima.lluviaUltimos7Dias).toBeNull();
      expect(nullResult['lote-1'].categoria).toBeNull();
    }
    const sinDatos = await new OpenMeteoClient(async () => respuesta({ daily: {
      time: dias.map((dia) => dia.fecha),
      precipitation_sum: dias.map(() => null),
    } })).consultar([{ id: 'lote-1', polygon: lote(1, 2) }]);
    expect(sinDatos['lote-1']).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('Sin datos') });
    const httpResult = await new OpenMeteoClient(async () => respuesta({}, false, 500)).consultar([{ id: 'lote-1', polygon: lote(1, 2) }]);
    expect(httpResult['lote-1']).toMatchObject({ estado: 'error', mensaje: 'Open-Meteo respondió HTTP 500.' });
    const jsonResult = await new OpenMeteoClient(async () => ({ ok: true, status: 200, json: async () => { throw new Error('json'); } })).consultar([{ id: 'lote-1', polygon: lote(1, 2) }]);
    expect(jsonResult['lote-1']).toMatchObject({ estado: 'error' });
    const nullJson = await new OpenMeteoClient(async () => respuesta(null)).consultar([{ id: 'lote-1', polygon: lote(1, 2) }]);
    expect(nullJson['lote-1']).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('Sin datos') });
  });
});
