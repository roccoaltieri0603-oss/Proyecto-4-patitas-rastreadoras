import { pedir } from "./client";

/**
 * Buscador de localidades del onboarding.
 *
 * El navegador no habla con Nominatim: le pide a Express, que es quien manda el
 * User-Agent que exige la política de uso. Mismo patrón que el resto de las
 * APIs, todo por `client.ts` para respetar `VITE_API_BASE_URL`.
 */
export interface Localidad {
  nombre: string;
  lat: number;
  lng: number;
  sur: number;
  norte: number;
  oeste: number;
  este: number;
}

export async function buscarLocalidades(consulta: string): Promise<Localidad[]> {
  const { localidades } = await pedir<{ localidades: Localidad[] }>(
    `/api/geo/localidades?q=${encodeURIComponent(consulta)}`,
  );
  return localidades;
}
