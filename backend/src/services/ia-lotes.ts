import { iaLotesTimeoutMs, iaLotesUrl } from '../configuracion/parse-env.js';
import { esPolygonFeature, type PolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';

/**
 * Puente hacia el microservicio Python que corre Delineate Anything.
 *
 * Mismo patrón que Copernicus y Open-Meteo: el navegador nunca habla con el
 * servicio externo, sólo manda intención. Acá se resuelve el transporte y se
 * valida que lo que vuelve sean polígonos de verdad; el recorte contra el
 * establecimiento vive en `sugerencias-lotes.ts`.
 */

export interface MetaSegmentacion {
  modelo: string;
  dispositivo: string | null;
  zoom: number;
  tiles: number;
  metrosPorPixel: number;
  detectadas: number;
  segundos: number;
}

export interface RespuestaSegmentacion {
  poligonos: PolygonFeature[];
  meta: MetaSegmentacion;
}

export interface TransporteIa {
  (url: string, cuerpo: string, cabeceras: Record<string, string>, timeoutMs: number): Promise<{ status: number; texto: string }>;
}

const transporteFetch: TransporteIa = async (url, cuerpo, cabeceras, timeoutMs) => {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: cabeceras,
    body: cuerpo,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: respuesta.status, texto: await respuesta.text() };
};

function numero(valor: unknown, defecto = 0): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : defecto;
}

export class ClienteIaLotes {
  constructor(
    // Se lee del entorno en cada llamada, igual que el cliente de Copernicus:
    // así el servicio se puede importar suelto sin arrastrar todo el arranque.
    // El formato ya quedó validado al bootear, con estas mismas funciones.
    private readonly configuracion: () => { url: string; token: string; timeoutMs: number } = () => ({
      url: iaLotesUrl(process.env.IA_LOTES_URL),
      token: process.env.IA_LOTES_TOKEN?.trim() ?? '',
      timeoutMs: iaLotesTimeoutMs(process.env.IA_LOTES_TIMEOUT_MS),
    }),
    private readonly transportar: TransporteIa = transporteFetch,
  ) {}

  configurado(): boolean {
    return Boolean(this.configuracion().url);
  }

  async segmentar(polygon: PolygonFeature): Promise<RespuestaSegmentacion> {
    const { url, token, timeoutMs } = this.configuracion();
    if (!url) throw new ApiError(503, 'IA_NOT_CONFIGURED', 'La sugerencia con IA no está configurada en el backend.');

    const cabeceras: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) cabeceras['X-IA-Token'] = token;

    let respuesta: { status: number; texto: string };
    try {
      respuesta = await this.transportar(`${url}/segmentar`, JSON.stringify({ polygon }), cabeceras, timeoutMs);
    } catch (error) {
      const esTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      if (esTimeout) {
        throw new ApiError(504, 'IA_TIMEOUT', `El servicio de IA no respondió en ${Math.round(timeoutMs / 1000)} s. Probá con un establecimiento más chico o usá GPU.`);
      }
      throw new ApiError(502, 'IA_UNREACHABLE', 'No se pudo contactar al servicio de IA. Verificá que el microservicio esté levantado.');
    }

    let cuerpo: unknown;
    try { cuerpo = JSON.parse(respuesta.texto) as unknown; }
    catch { throw new ApiError(502, 'IA_INVALID_RESPONSE', 'El servicio de IA devolvió una respuesta ilegible.'); }

    if (respuesta.status !== 200) {
      const detalle = (cuerpo as { detail?: unknown } | null)?.detail;
      throw new ApiError(502, 'IA_UPSTREAM_ERROR', typeof detalle === 'string' && detalle ? detalle : `El servicio de IA respondió ${respuesta.status}.`);
    }

    const datos = cuerpo as { poligonos?: unknown; meta?: Record<string, unknown> } | null;
    if (!datos || !Array.isArray(datos.poligonos)) {
      throw new ApiError(502, 'IA_INVALID_RESPONSE', 'El servicio de IA no devolvió polígonos.');
    }
    // Un polígono mal formado se descarta en silencio, no se "arregla": lo que
    // no vino como geometría válida simplemente no existe como sugerencia.
    const poligonos = datos.poligonos.filter((item): item is PolygonFeature => esPolygonFeature(item));
    const meta = datos.meta ?? {};

    return {
      poligonos,
      meta: {
        modelo: typeof meta.modelo === 'string' ? meta.modelo : 'desconocido',
        dispositivo: typeof meta.dispositivo === 'string' ? meta.dispositivo : null,
        zoom: numero(meta.zoom),
        tiles: numero(meta.tiles),
        metrosPorPixel: numero(meta.metrosPorPixel),
        detectadas: numero(meta.detectadas, poligonos.length),
        segundos: numero(meta.segundos),
      },
    };
  }
}

export const iaLotes = new ClienteIaLotes();
