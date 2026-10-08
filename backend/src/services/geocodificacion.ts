import { ApiError } from '../http/errors.js';

/**
 * Búsqueda de lugares por nombre (Nominatim / OpenStreetMap).
 *
 * Mismo patrón que Copernicus y Open-Meteo: el navegador sólo manda el texto y
 * Express resuelve el transporte. Sirve únicamente para mover el mapa al
 * empezar; no se guarda nada ni se usa como dato del establecimiento.
 */

export interface LugarEncontrado {
  nombre: string;
  latitud: number;
  longitud: number;
  /** [sur, oeste, norte, este] */
  limites: [number, number, number, number];
}

export interface TransporteGeocodificacion {
  (url: string, cabeceras: Record<string, string>, timeoutMs: number): Promise<{ status: number; texto: string }>;
}

const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 8000;
// La política de Nominatim exige identificar la aplicación.
const USER_AGENT = 'RODEO-ganaderia/1.0';

const transporteFetch: TransporteGeocodificacion = async (url, cabeceras, timeoutMs) => {
  const respuesta = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(timeoutMs) });
  return { status: respuesta.status, texto: await respuesta.text() };
};

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function aLugar(crudo: unknown): LugarEncontrado | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const fila = crudo as Record<string, unknown>;
  const latitud = Number(fila.lat);
  const longitud = Number(fila.lon);
  const caja = Array.isArray(fila.boundingbox) ? fila.boundingbox.map(Number) : [];
  if (typeof fila.display_name !== 'string' || !esNumeroFinito(latitud) || !esNumeroFinito(longitud)) return null;
  if (caja.length !== 4 || !caja.every(esNumeroFinito)) return null;
  // Nominatim entrega [sur, norte, oeste, este].
  const [sur, norte, oeste, este] = caja;
  return { nombre: fila.display_name, latitud, longitud, limites: [sur, oeste, norte, este] };
}

export class ClienteGeocodificacion {
  constructor(private readonly transportar: TransporteGeocodificacion = transporteFetch) {}

  async buscar(texto: string): Promise<LugarEncontrado[]> {
    const url = `${URL_NOMINATIM}?${new URLSearchParams({
      q: texto,
      format: 'jsonv2',
      limit: '5',
      countrycodes: 'ar',
      'accept-language': 'es',
    })}`;

    let respuesta: { status: number; texto: string };
    try {
      respuesta = await this.transportar(url, { 'User-Agent': USER_AGENT, Accept: 'application/json' }, TIMEOUT_MS);
    } catch {
      throw new ApiError(502, 'No se pudo consultar el buscador de lugares. Probá de nuevo en unos segundos.', 'GEOCODING_UNAVAILABLE');
    }
    if (respuesta.status !== 200) {
      throw new ApiError(502, 'El buscador de lugares no respondió correctamente.', 'GEOCODING_UNAVAILABLE');
    }

    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(respuesta.texto);
    } catch {
      throw new ApiError(502, 'El buscador de lugares devolvió una respuesta inválida.', 'GEOCODING_INVALID_RESPONSE');
    }
    if (!Array.isArray(cuerpo)) {
      throw new ApiError(502, 'El buscador de lugares devolvió una respuesta inválida.', 'GEOCODING_INVALID_RESPONSE');
    }
    return cuerpo.flatMap((fila) => {
      const lugar = aLugar(fila);
      return lugar ? [lugar] : [];
    });
  }
}

export const geocodificacion = new ClienteGeocodificacion();
