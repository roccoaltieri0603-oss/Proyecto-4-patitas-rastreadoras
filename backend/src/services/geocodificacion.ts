import { ApiError } from '../http/errors.js';

/**
 * Traduce el nombre de una localidad a coordenadas, contra Nominatim (OSM).
 *
 * Vive en Express y no en el navegador por el mismo criterio que Copernicus y
 * Open-Meteo: el frontend manda intención (un texto) y recibe el resultado ya
 * validado. Acá hay además un motivo concreto: la política de uso de Nominatim
 * exige un User-Agent que identifique a la aplicación, y el navegador no puede
 * setear esa cabecera.
 *
 * Nunca inventa una coordenada. Si Nominatim no encuentra nada, la lista vuelve
 * vacía y la interfaz dice que no encontró la localidad; si responde algo que no
 * son números válidos, esa fila se descarta en vez de completarse con ceros.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 10_000;
const MAXIMO_RESULTADOS = 5;
const LARGO_MINIMO = 3;

// Nominatim rechaza clientes sin User-Agent identificatorio. Mismo formato que
// usa el microservicio de IA para pedir tiles.
const USER_AGENT = 'RODEO/0.1 (proyecto academico)';

export interface Localidad {
  /** Nombre completo tal como lo devuelve Nominatim, para que el usuario verifique. */
  nombre: string;
  lat: number;
  lng: number;
  /**
   * Caja que cubre la localidad. Se expone con nombres en vez de un array
   * porque Nominatim la entrega como `[sur, norte, oeste, este]` y ese orden es
   * fácil de invertir sin que nada falle visiblemente.
   */
  sur: number;
  norte: number;
  oeste: number;
  este: number;
}

function aNumero(valor: unknown): number | null {
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  return typeof numero === 'number' && Number.isFinite(numero) ? numero : null;
}

function aLocalidad(fila: unknown): Localidad | null {
  if (!fila || typeof fila !== 'object') return null;
  const registro = fila as Record<string, unknown>;

  const lat = aNumero(registro.lat);
  const lng = aNumero(registro.lon);
  const nombre = typeof registro.display_name === 'string' ? registro.display_name : null;
  if (lat === null || lng === null || !nombre) return null;

  // Nominatim manda la caja como cuatro strings: [sur, norte, oeste, este].
  const caja = Array.isArray(registro.boundingbox) ? registro.boundingbox.map(aNumero) : [];
  if (caja.length !== 4 || caja.some((valor) => valor === null)) return null;
  const [sur, norte, oeste, este] = caja as [number, number, number, number];

  return { nombre, lat, lng, sur, norte, oeste, este };
}

export async function buscarLocalidades(consulta: string): Promise<Localidad[]> {
  const texto = consulta.trim();
  if (texto.length < LARGO_MINIMO) {
    throw new ApiError(400, 'QUERY_TOO_SHORT', `Escribí al menos ${LARGO_MINIMO} caracteres para buscar una localidad.`);
  }

  const parametros = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    limit: String(MAXIMO_RESULTADOS),
  });

  let respuesta: Response;
  try {
    respuesta = await fetch(`${ENDPOINT}?${parametros.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es', Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, 'GEOCODING_UNREACHABLE', 'No se pudo contactar al buscador de localidades.');
  }

  if (!respuesta.ok) {
    throw new ApiError(502, 'GEOCODING_UPSTREAM_ERROR', `El buscador de localidades respondió ${respuesta.status}.`);
  }

  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!Array.isArray(cuerpo)) {
    throw new ApiError(502, 'GEOCODING_INVALID_RESPONSE', 'El buscador de localidades devolvió una respuesta ilegible.');
  }

  return cuerpo
    .map(aLocalidad)
    .filter((localidad): localidad is Localidad => localidad !== null);
}
