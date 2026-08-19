import { centroidOf } from "../geo";
import type { Lote } from "../types";
import { categorizarLluvia } from "./interpretacion";
import type { Clima, DiaClima, ResultadoClimaLote } from "./types";

/**
 * Open-Meteo: sin API key, CORS habilitado (`access-control-allow-origin: *`,
 * verificado contra el endpoint real), y sin costo por cuota — a diferencia
 * de Copernicus no hace falta pasar por un proxy de Node ni guardar secretos.
 */
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Cuántos días hacia atrás mostramos como lluvia ya caída. */
const DIAS_PASADOS = 7;
/** Cuántos días de pronóstico mostramos hacia adelante (incluye hoy). */
const DIAS_PRONOSTICO = 5;

interface RegistroOpenMeteo {
  daily?: {
    time: string[];
    precipitation_sum?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
}

function aNumero(valor: number | null | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function aClima(registro: RegistroOpenMeteo): Clima | null {
  const tiempos = registro.daily?.time ?? [];
  if (tiempos.length === 0) return null;

  const lluvias = registro.daily?.precipitation_sum ?? [];
  const tempsMax = registro.daily?.temperature_2m_max ?? [];
  const tempsMin = registro.daily?.temperature_2m_min ?? [];

  // Posicional, no por fecha: pedimos past_days/forecast_days explícitos, así
  // que Open-Meteo ya nos devuelve el arreglo ordenado con "hoy" en el índice
  // DIAS_PASADOS. Comparar contra el reloj del navegador sería más frágil acá
  // (Argentina es UTC-3: cerca de la medianoche UTC, la fecha local todavía
  // no cambió y un slice() de ISO en UTC correría el corte un día).
  const dias: DiaClima[] = tiempos.map((fecha, i) => ({
    fecha,
    lluviaMm: aNumero(lluvias[i]),
    tempMax: aNumero(tempsMax[i]),
    tempMin: aNumero(tempsMin[i]),
    esPronostico: i >= DIAS_PASADOS,
  }));

  return {
    consultadoEn: Date.now(),
    dias,
    lluviaUltimos7Dias: dias.slice(0, DIAS_PASADOS).reduce((acc, d) => acc + d.lluviaMm, 0),
    lluviaProximosDias: dias.slice(DIAS_PASADOS).reduce((acc, d) => acc + d.lluviaMm, 0),
    hoy: dias[DIAS_PASADOS] ?? null,
  };
}

/**
 * Consulta la lluvia/temperatura del centroide de cada lote, en una sola
 * petición HTTP (Open-Meteo acepta listas de lat/lng separadas por coma).
 * Lotes cercanos entre sí suelen caer en la misma celda del modelo y salir
 * con el mismo número — es lo esperable, no un error: igual conviene pedirlo
 * por lote porque un establecimiento grande sí puede cruzar celdas distintas.
 */
export async function consultarClimaLotes(
  lotes: Lote[],
): Promise<Record<string, ResultadoClimaLote>> {
  if (lotes.length === 0) return {};

  const centros = lotes.map((lote) => centroidOf(lote.polygon));
  const params = new URLSearchParams({
    latitude: centros.map(([lat]) => lat.toFixed(4)).join(","),
    longitude: centros.map(([, lng]) => lng.toFixed(4)).join(","),
    daily: "precipitation_sum,temperature_2m_max,temperature_2m_min",
    past_days: String(DIAS_PASADOS),
    forecast_days: String(DIAS_PRONOSTICO),
    timezone: "auto",
  });

  function errorParaTodos(mensaje: string): Record<string, ResultadoClimaLote> {
    return Object.fromEntries(
      lotes.map((lote) => [lote.id, { estado: "error", loteId: lote.id, mensaje } as const]),
    );
  }

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params.toString()}`);
  } catch {
    return errorParaTodos("No se pudo contactar al servicio meteorológico (Open-Meteo).");
  }
  if (!res.ok) {
    return errorParaTodos(`Open-Meteo respondió HTTP ${res.status}.`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return errorParaTodos("Open-Meteo devolvió una respuesta que no se pudo interpretar.");
  }

  // Con una sola coordenada devuelve un objeto suelto; con varias, un arreglo.
  const registros: RegistroOpenMeteo[] = Array.isArray(json) ? json : [json as RegistroOpenMeteo];

  const resultados: Record<string, ResultadoClimaLote> = {};
  lotes.forEach((lote, i) => {
    const clima = aClima(registros[i] ?? {});
    resultados[lote.id] = clima
      ? { estado: "ok", loteId: lote.id, clima, categoria: categorizarLluvia(clima) }
      : { estado: "error", loteId: lote.id, mensaje: "Sin datos de Open-Meteo para este lote." };
  });
  return resultados;
}
