export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
let ultimaInteraccion = 0;
if (typeof window !== 'undefined') {
  for (const evento of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evento, () => { ultimaInteraccion = Date.now(); }, { passive: true });
  }
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

/**
 * Descarga un archivo de la API. Pasa por la misma base y las mismas cookies
 * que `pedir`, pero devuelve el cuerpo como Blob en vez de JSON; un error sigue
 * llegando como `ApiError` con el mensaje del backend.
 */
export async function pedirArchivo(path: string): Promise<{ blob: Blob; nombre: string | null }> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { credentials: "include" });
  } catch {
    throw new ApiError(0, "No hay conexión con RODEO. Revisá tu internet y volvé a intentar.");
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ErrorResponse | null;
    throw new ApiError(response.status, error?.error?.message ?? "No se pudo generar el archivo.", error?.error?.code);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await response.blob(), nombre };
}

export async function pedir<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json",
        ...(Date.now() - ultimaInteraccion < 5 * 60_000 ? { 'X-Rodeo-Actividad': '1' } : {}),
        ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "No hay conexión con RODEO. Revisá tu internet y volvé a intentar.");
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as T | ErrorResponse | null;
  if (!response.ok) {
    const error = body as ErrorResponse | null;
    if (error?.error?.code === 'OPERATION_SESSION_LOST' || error?.error?.code === 'OPERATION_SESSION_REQUIRED') {
      window.dispatchEvent(new Event('rodeo:sesion-operativa-perdida'));
    }
    throw new ApiError(response.status, error?.error?.message ?? "No se pudo completar la operación.", error?.error?.code);
  }
  if (body === null) {
    throw new ApiError(response.status, "RODEO respondió algo inesperado. Volvé a intentar en un momento.", "INVALID_RESPONSE");
  }
  return body as T;
}
