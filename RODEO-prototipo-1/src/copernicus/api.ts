import type { Lote } from "../types";
import { EVALSCRIPT_INDICES, EVALSCRIPT_RADAR } from "./evalscript";
import { calcularPuntaje, categorizar, generarAlertas } from "./scoring";
import type {
  CondicionRadar,
  EstadisticaIndice,
  IntervaloEstadisticas,
  RespuestaEstadisticas,
  ResultadoLote,
  StatsCrudas,
} from "./types";

const ENDPOINT_ESTADISTICAS = "/api/copernicus/statistics";
const ENDPOINT_ESTADO = "/api/copernicus/estado";

/**
 * Ventana hacia atrás donde buscamos la última pasada despejada.
 * Sentinel-2 pasa cada ~5 días, así que 45 días ≈ 9 pasadas. Hace falta ese
 * margen: en pruebas sobre la Pampa en invierno, 5 de cada 6 pasadas estaban
 * completamente tapadas por nubes.
 */
const DIAS_VENTANA = 45;
/**
 * Resolución de muestreo, EN GRADOS: la Statistical API interpreta resx/resy en
 * las unidades del CRS del `bounds`, y estamos mandando la geometría en CRS84.
 * 0.0002° ≈ 20 m, que es la resolución nativa de B11 (la banda del NDMI).
 */
const RESOLUCION_GRADOS = 0.0002;
/** Debajo de esta fracción de píxeles despejados descartamos la fecha. */
const COBERTURA_MINIMA = 0.35;
/** Cuántas fechas previas guardamos para dibujar la tendencia de NDVI. */
const FECHAS_TENDENCIA = 6;
/** Peticiones simultáneas: la Statistical API de CDSE limita fuerte por minuto. */
const CONCURRENCIA = 2;

/**
 * Ventana hacia atrás para el respaldo por radar. Sentinel-1 no lo tapan las
 * nubes, así que con ~6 días de revisita no hace falta una ventana tan ancha
 * como la óptica para encontrar una pasada.
 */
const DIAS_VENTANA_RADAR = 20;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Medianoche UTC del día de `d`.
 *
 * `aggregationInterval: P1D` no parte los días por medianoche: ancla los
 * intervalos en la hora exacta de `timeRange.from`. Si ahí mandamos
 * `new Date()`, los baldes quedan corridos a la hora del reloj, y cuando esa
 * hora cae cerca de la pasada del satélite (Sentinel-2 sobrevuela Argentina
 * ~13:47 UTC) el balde parte la pasada al medio: la Statistical API devuelve
 * el intervalo pero con CERO píxeles válidos, y encima fechado un día antes.
 * Verificado contra la API real: a las 13:09 UTC las 12 pasadas de la ventana
 * daban 0% de cobertura; alineadas a medianoche, las mismas 12 dan 100%.
 */
function medianocheUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ¿El dev-server tiene las credenciales cargadas? */
export async function credencialesListas(): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT_ESTADO);
    if (!res.ok) return false;
    const json = (await res.json()) as { configurado?: boolean };
    return json.configurado === true;
  } catch {
    return false;
  }
}

function cuerpoPeticion(lote: Lote, desde: Date, hasta: Date): string {
  return JSON.stringify({
    input: {
      bounds: {
        // Sólo mandamos el polígono del lote, nada de bounding boxes: la
        // Statistical API recorta y promedia exactamente sobre esta geometría.
        geometry: lote.polygon.geometry,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { mosaickingOrder: "leastCC" },
        },
      ],
    },
    aggregation: {
      timeRange: { from: desde.toISOString(), to: hasta.toISOString() },
      // Un intervalo por día: cada pasada del satélite queda separada y podemos
      // quedarnos con la más reciente que esté despejada.
      aggregationInterval: { of: "P1D" },
      resx: RESOLUCION_GRADOS,
      resy: RESOLUCION_GRADOS,
      evalscript: EVALSCRIPT_INDICES,
    },
    calculations: {
      default: { statistics: { default: { percentiles: { k: [50] } } } },
    },
  });
}

function cuerpoPeticionRadar(lote: Lote, desde: Date, hasta: Date): string {
  return JSON.stringify({
    input: {
      bounds: {
        geometry: lote.polygon.geometry,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
      },
      data: [{ type: "sentinel-1-grd" }],
    },
    aggregation: {
      timeRange: { from: desde.toISOString(), to: hasta.toISOString() },
      aggregationInterval: { of: "P1D" },
      resx: RESOLUCION_GRADOS,
      resy: RESOLUCION_GRADOS,
      evalscript: EVALSCRIPT_RADAR,
    },
    calculations: {
      default: { statistics: { default: { percentiles: { k: [50] } } } },
    },
  });
}

/** Sentinel Hub manda `"NaN"` como string cuando no quedó ningún píxel válido. */
function aNumero(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function leerPercentil(stats: StatsCrudas, k: number): number | null {
  const p = stats.percentiles;
  if (!p) return null;
  // Las claves vienen como "50.0", no como "50".
  const clave = Object.keys(p).find((c) => Number(c) === k);
  return clave === undefined ? null : aNumero(p[clave]);
}

function aEstadistica(stats: StatsCrudas): EstadisticaIndice | null {
  const media = aNumero(stats.mean);
  const desvio = aNumero(stats.stDev);
  const min = aNumero(stats.min);
  const max = aNumero(stats.max);
  if (media === null || desvio === null || min === null || max === null) return null;

  return { media, mediana: leerPercentil(stats, 50) ?? media, min, max, desvio };
}

function extraerSalida(
  intervalo: IntervaloEstadisticas,
  id: string,
): StatsCrudas | null {
  const bandas = intervalo.outputs?.[id]?.bands;
  if (!bandas) return null;
  const primera = Object.values(bandas)[0];
  return primera?.stats ?? null;
}

interface Observacion {
  fecha: string;
  coberturaValida: number;
  ndvi: EstadisticaIndice;
  ndmi: EstadisticaIndice;
  ndwi: EstadisticaIndice;
  evi: EstadisticaIndice;
}

/** Convierte un intervalo de la respuesta en una observación usable, o null. */
function aObservacion(intervalo: IntervaloEstadisticas): Observacion | null {
  if (intervalo.error) return null;

  const crudas = {
    ndvi: extraerSalida(intervalo, "ndvi"),
    ndmi: extraerSalida(intervalo, "ndmi"),
    ndwi: extraerSalida(intervalo, "ndwi"),
    evi: extraerSalida(intervalo, "evi"),
  };
  if (!crudas.ndvi || !crudas.ndmi || !crudas.ndwi || !crudas.evi) return null;

  // sampleCount incluye todos los píxeles del recorte; noDataCount son los que
  // el evalscript enmascaró por nube, sombra, cirrus o nieve.
  const total = crudas.ndvi.sampleCount;
  if (total <= 0) return null;
  const coberturaValida = (total - crudas.ndvi.noDataCount) / total;
  if (coberturaValida < COBERTURA_MINIMA) return null;

  const ndvi = aEstadistica(crudas.ndvi);
  const ndmi = aEstadistica(crudas.ndmi);
  const ndwi = aEstadistica(crudas.ndwi);
  const evi = aEstadistica(crudas.evi);
  // Si algún índice quedó en "NaN" descartamos la fecha entera: preferimos
  // decir "sin datos" antes que mostrar un número inventado.
  if (!ndvi || !ndmi || !ndwi || !evi) return null;

  return {
    fecha: intervalo.interval.from.slice(0, 10),
    coberturaValida,
    ndvi,
    ndmi,
    ndwi,
    evi,
  };
}

interface ObservacionRadar {
  fecha: string;
  coberturaValida: number;
  rvi: EstadisticaIndice;
}

/** Igual que `aObservacion`, pero para el único output ("rvi") del radar. */
function aObservacionRadar(intervalo: IntervaloEstadisticas): ObservacionRadar | null {
  if (intervalo.error) return null;

  const crudas = extraerSalida(intervalo, "rvi");
  if (!crudas) return null;

  const total = crudas.sampleCount;
  if (total <= 0) return null;
  const coberturaValida = (total - crudas.noDataCount) / total;
  if (coberturaValida < COBERTURA_MINIMA) return null;

  const rvi = aEstadistica(crudas);
  if (!rvi) return null;

  return { fecha: intervalo.interval.from.slice(0, 10), coberturaValida, rvi };
}

function mensajeDeError(estado: number, texto: string): string {
  try {
    const json = JSON.parse(texto) as {
      error?: string | { message?: string };
    };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    /* la respuesta no era JSON; caemos al mensaje genérico */
  }
  if (estado === 429) {
    return "Copernicus está limitando las consultas (429). Esperá un minuto y volvé a intentar.";
  }
  return `Copernicus respondió HTTP ${estado}.`;
}

/** Consulta la óptica (Sentinel-2). Puede devolver "ok", "sin-datos" o "error". */
async function consultarOptico(lote: Lote, ahora: Date): Promise<ResultadoLote> {
  const medianoche = medianocheUTC(ahora);
  // `hasta` llega al arranque de mañana para no perder la pasada de hoy.
  const hasta = new Date(medianoche.getTime() + MS_POR_DIA);
  const desde = new Date(medianoche.getTime() - DIAS_VENTANA * MS_POR_DIA);

  let res: Response;
  try {
    res = await fetch(ENDPOINT_ESTADISTICAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpoPeticion(lote, desde, hasta),
    });
  } catch {
    return {
      estado: "error",
      loteId: lote.id,
      mensaje: "No se pudo contactar al servidor. ¿Está corriendo `npm run dev`?",
    };
  }

  const texto = await res.text();
  if (!res.ok) {
    return { estado: "error", loteId: lote.id, mensaje: mensajeDeError(res.status, texto) };
  }

  let respuesta: RespuestaEstadisticas;
  try {
    respuesta = JSON.parse(texto) as RespuestaEstadisticas;
  } catch {
    return {
      estado: "error",
      loteId: lote.id,
      mensaje: "Copernicus devolvió una respuesta que no se pudo interpretar.",
    };
  }

  const observaciones = (respuesta.data ?? [])
    .map(aObservacion)
    .filter((o): o is Observacion => o !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (observaciones.length === 0) {
    return {
      estado: "sin-datos",
      loteId: lote.id,
      mensaje: `Sin imágenes despejadas en los últimos ${DIAS_VENTANA} días.`,
    };
  }

  const ultima = observaciones[observaciones.length - 1];
  const diasDesde = Math.max(
    0,
    Math.floor((ahora.getTime() - new Date(`${ultima.fecha}T12:00:00Z`).getTime()) / MS_POR_DIA),
  );
  const puntaje = calcularPuntaje(ultima.ndvi, ultima.ndmi, ultima.ndwi, ultima.evi);

  return {
    estado: "ok",
    loteId: lote.id,
    condicion: {
      fecha: ultima.fecha,
      diasDesde,
      coberturaValida: ultima.coberturaValida,
      ndvi: ultima.ndvi,
      ndmi: ultima.ndmi,
      ndwi: ultima.ndwi,
      evi: ultima.evi,
      puntaje,
      categoria: categorizar(puntaje),
      alertas: generarAlertas({
        diasDesde,
        coberturaValida: ultima.coberturaValida,
        ndvi: ultima.ndvi,
        ndmi: ultima.ndmi,
        ndwi: ultima.ndwi,
      }),
      tendencia: observaciones.slice(-FECHAS_TENDENCIA).map((o) => ({
        fecha: o.fecha,
        ndvi: o.ndvi.mediana,
        ndmi: o.ndmi.media,
        ndwi: o.ndwi.media,
        evi: o.evi.media,
      })),
    },
  };
}

/**
 * Consulta el respaldo por radar (Sentinel-1). A diferencia de la óptica,
 * `null` es la única forma de "no hay dato": no distinguimos error de red vs.
 * sin pasadas, porque esto ya es en sí mismo un plan B silencioso.
 */
async function consultarRadar(lote: Lote, ahora: Date): Promise<CondicionRadar | null> {
  const medianoche = medianocheUTC(ahora);
  const hasta = new Date(medianoche.getTime() + MS_POR_DIA);
  const desde = new Date(medianoche.getTime() - DIAS_VENTANA_RADAR * MS_POR_DIA);

  let res: Response;
  try {
    res = await fetch(ENDPOINT_ESTADISTICAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpoPeticionRadar(lote, desde, hasta),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let respuesta: RespuestaEstadisticas;
  try {
    respuesta = JSON.parse(await res.text()) as RespuestaEstadisticas;
  } catch {
    return null;
  }

  const observaciones = (respuesta.data ?? [])
    .map(aObservacionRadar)
    .filter((o): o is ObservacionRadar => o !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (observaciones.length === 0) return null;

  const ultima = observaciones[observaciones.length - 1];
  const diasDesde = Math.max(
    0,
    Math.floor((ahora.getTime() - new Date(`${ultima.fecha}T12:00:00Z`).getTime()) / MS_POR_DIA),
  );

  return { fecha: ultima.fecha, diasDesde, rvi: ultima.rvi };
}

/**
 * Consulta la condición de un lote: óptica y radar siempre en paralelo (el
 * costo real por lote es ínfimo frente a la cuota gratuita de CDSE — medido
 * contra la cuenta real, ~0.2 PU combinadas por lote contra 10.000 PU/mes),
 * y nos quedamos con lo que sea genuinamente más reciente. El radar
 * reemplaza el resultado sólo cuando gana en frescura; nunca pisa una óptica
 * que ya es igual o más nueva.
 */
async function consultarLote(lote: Lote, ahora: Date): Promise<ResultadoLote> {
  const [optico, radar] = await Promise.all([
    consultarOptico(lote, ahora),
    consultarRadar(lote, ahora),
  ]);

  if (!radar) return optico;
  if (optico.estado === "ok" && radar.diasDesde >= optico.condicion.diasDesde) return optico;

  return {
    estado: "radar",
    loteId: lote.id,
    condicion: radar,
    optico: optico.estado === "ok" ? optico.condicion : undefined,
    mensaje:
      optico.estado === "ok"
        ? `La última óptica despejada es de hace ${optico.condicion.diasDesde} días; se muestra radar Sentinel-1 (${radar.diasDesde === 0 ? "hoy" : `hace ${radar.diasDesde} días`}), no tapado por nubes.`
        : `Sin óptica despejada en ${DIAS_VENTANA} días; se muestra radar Sentinel-1 (${radar.diasDesde === 0 ? "hoy" : `hace ${radar.diasDesde} días`}), no tapado por nubes.`,
  };
}

/** Corre `tarea` sobre cada ítem con un tope de tareas simultáneas. */
async function conLimite<T, R>(
  items: T[],
  limite: number,
  tarea: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  let siguiente = 0;

  async function trabajador(): Promise<void> {
    while (siguiente < items.length) {
      const indice = siguiente++;
      resultados[indice] = await tarea(items[indice]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, () => trabajador()),
  );
  return resultados;
}

/**
 * Consulta la condición actual de los lotes indicados.
 * Se espera que quien llama ya haya filtrado por `activo`.
 */
export async function analizarLotes(lotes: Lote[]): Promise<ResultadoLote[]> {
  const ahora = new Date();
  return conLimite(lotes, CONCURRENCIA, (lote) => consultarLote(lote, ahora));
}

export { DIAS_VENTANA };
