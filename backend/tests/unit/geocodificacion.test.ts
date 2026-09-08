import { afterEach, describe, expect, test, vi } from 'vitest';
import { buscarLocalidades } from '../../src/services/geocodificacion.js';

/**
 * Lo que se está protegiendo acá es el orden de la caja: Nominatim la manda
 * como `[sur, norte, oeste, este]`, que no es el orden de nadie más. Invertirlo
 * no rompe nada visiblemente, sólo manda el mapa a otro lado.
 */

// Fila real de Nominatim para "Irala, Buenos Aires, Argentina", recortada.
const IRALA = {
  lat: '-34.7701893',
  lon: '-60.6910317',
  display_name: 'Irala, Cuartel Irala, Partido de Bragado, Buenos Aires, Argentina',
  boundingbox: ['-34.7754977', '-34.7645491', '-60.7000905', '-60.6854949'],
};

function responderCon(cuerpo: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('geocodificación de localidades', () => {
  test('traduce la fila de Nominatim sin cruzar los lados de la caja', async () => {
    responderCon([IRALA]);

    const [localidad] = await buscarLocalidades('Irala, Buenos Aires, Argentina');

    expect(localidad).toEqual({
      nombre: IRALA.display_name,
      lat: -34.7701893,
      lng: -60.6910317,
      sur: -34.7754977,
      norte: -34.7645491,
      oeste: -60.7000905,
      este: -60.6854949,
    });
    // Sanidad del encuadre: el sur queda debajo del norte y el oeste a la
    // izquierda del este. Si algún día se invierte el orden, esto lo caza.
    expect(localidad.sur).toBeLessThan(localidad.norte);
    expect(localidad.oeste).toBeLessThan(localidad.este);
  });

  test('descarta la fila incompleta en vez de rellenarla con ceros', async () => {
    responderCon([{ ...IRALA, boundingbox: ['-34.77', 'no-es-un-numero', '-60.70', '-60.68'] }, IRALA]);

    const localidades = await buscarLocalidades('Irala');

    expect(localidades).toHaveLength(1);
    expect(localidades[0]?.nombre).toBe(IRALA.display_name);
  });

  test('sin resultados devuelve lista vacía, no una posición por defecto', async () => {
    responderCon([]);

    await expect(buscarLocalidades('asdkjhaskdjh')).resolves.toEqual([]);
  });

  test('rechaza la consulta demasiado corta antes de salir a la red', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    await expect(buscarLocalidades('ir')).rejects.toMatchObject({ status: 400, code: 'QUERY_TOO_SHORT' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  test('un fallo del proveedor es un error explícito, no una lista vacía', async () => {
    responderCon(null, 503);

    await expect(buscarLocalidades('Irala')).rejects.toMatchObject({ status: 502, code: 'GEOCODING_UPSTREAM_ERROR' });
  });
});
