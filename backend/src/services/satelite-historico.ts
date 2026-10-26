import type { PoolClient } from 'pg';
import { pool } from '../base-datos/pool.js';
import { CONCURRENCIA, RESOLUCION_GRADOS, aObservacion, cuerpoPeticion } from '../copernicus/analizar.js';
import { calcularPuntaje, categorizar, generarAlertas } from '../copernicus/scoring.js';
import type { LoteSatelital, RespuestaEstadisticas } from '../copernicus/types.js';
import { diasEntreFechas, hoyCalendario, sumarDias } from '../fechas.js';
import { esPolygonFeature } from '../geometria.js';
import { copernicus, type RespuestaCopernicus } from './copernicus.js';
import { guardarMedicionSatelital, type MedicionSatelitalPersistible } from './mediciones-satelitales.js';

/**
 * Historia de Sentinel-2 de cada lote, para el historial satelital. Desde el
 * 25/10/2026 la estimación de forraje ya no usa estas imágenes.
 *
 * La actualización regular guarda una sola imagen por consulta, la más nueva,
 * así que la serie de un lote crece de a una fecha. Esto baja las imágenes
 * despejadas de los últimos días con el mismo pedido, la misma lectura y el
 * mismo scoring que la actualización regular, y las guarda con el mismo
 * `guardarMedicionSatelital`. Sólo Sentinel-2. Una fecha ya guardada se
 * saltea: no se pisa nada.
 */

export const DIAS_HISTORIA_POR_DEFECTO = 365;
/** Decisión de diseño: ventanas cortas para que cada respuesta llegue antes del timeout de 60 s. */
export const DIAS_POR_VENTANA = 90;
export const PAUSA_ENTRE_PEDIDOS_MS = 1_000;
/** Por defecto no se gasta más del 20 % de la cuota mensual gratuita de CDSE (10.000 PU) en una corrida. */
export const MAXIMO_PU_POR_DEFECTO = 2_000;

// Fórmula de unidades de procesamiento de la documentación de CDSE
// (APIs/SentinelHub/Overview/ProcessingUnit): área sobre 512 × 512 píxeles con
// mínimo 0,01; bandas de entrada sobre 3 (dataMask no cuenta); FLOAT32 × 2; y
// × cada pasada con datos.
const PIXELES_POR_PU = 512 * 512;
const AREA_MINIMA = 0.01;
const BANDAS_ENTRADA = 6;
const FACTOR_FLOAT32 = 2;
/** Supuesto de cota superior, no un dato: una pasada útil cada 2 días entre Sentinel-2A, B y C. */
const DIAS_POR_PASADA = 2;

export interface Ventana {
  desde: string;
  hasta: string;
}

/** Ventanas consecutivas e inclusivas que cubren de `desde` a `hasta`. */
export function ventanasDeConsulta(desde: string, hasta: string, dias = DIAS_POR_VENTANA): Ventana[] {
  const ventanas: Ventana[] = [];
  for (let inicio = desde; inicio <= hasta; inicio = sumarDias(inicio, dias)) {
    const fin = sumarDias(inicio, dias - 1);
    ventanas.push({ desde: inicio, hasta: fin < hasta ? fin : hasta });
  }
  return ventanas;
}

/** Cota superior de PU para bajar `dias` de historia de un lote. */
export function puEstimadas(lote: LoteSatelital, dias: number): number {
  const puntos = lote.polygon.geometry.coordinates.flat();
  const longitudes = puntos.map(([longitud]) => longitud);
  const latitudes = puntos.map(([, latitud]) => latitud);
  const pixeles = ((Math.max(...longitudes) - Math.min(...longitudes)) / RESOLUCION_GRADOS) * ((Math.max(...latitudes) - Math.min(...latitudes)) / RESOLUCION_GRADOS);
  const area = Math.max(AREA_MINIMA, pixeles / PIXELES_POR_PU);
  return area * (BANDAS_ENTRADA / 3) * FACTOR_FLOAT32 * Math.ceil(dias / DIAS_POR_PASADA);
}

type Observacion = NonNullable<ReturnType<typeof aObservacion>>;

export function medicionDesdeObservacion(observacion: Observacion, consultedAt: Date, ventana: Ventana): MedicionSatelitalPersistible {
  const puntaje = calcularPuntaje(observacion.ndvi, observacion.ndmi, observacion.ndwi, observacion.evi);
  return {
    fuente: 'sentinel-2',
    observedAt: observacion.fecha,
    consultedAt,
    coberturaValida: observacion.coberturaValida,
    ndvi: observacion.ndvi,
    ndmi: observacion.ndmi,
    ndwi: observacion.ndwi,
    evi: observacion.evi,
    puntaje,
    categoria: categorizar(puntaje),
    // La alerta de "imagen vieja" describe una consulta del momento; una pasada
    // histórica se evalúa en su propia fecha, cuando tenía 0 días.
    alertas: generarAlertas({ diasDesde: 0, coberturaValida: observacion.coberturaValida, ndvi: observacion.ndvi, ndmi: observacion.ndmi, ndwi: observacion.ndwi }),
    rawMetadata: { origen: 'satelite-historico', ventana },
  };
}

/** Pasadas despejadas de una respuesta, dentro de la ventana, en orden. Sin respuesta legible, null. */
export function observacionesDeRespuesta(texto: string, ventana: Ventana): Observacion[] | null {
  let respuesta: RespuestaEstadisticas;
  try { respuesta = JSON.parse(texto) as RespuestaEstadisticas; } catch { return null; }
  return (respuesta.data ?? [])
    .map(aObservacion)
    .filter((item): item is Observacion => item !== null && item.fecha >= ventana.desde && item.fecha <= ventana.hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export interface OpcionesSateliteHistorico {
  ids?: string[];
  dias?: number;
  maxLotes?: number;
  maxPu?: number;
  escribir?: boolean;
  pausaMs?: number;
  hoy?: string;
  referencia?: Date;
}

export interface PlanLoteSatelital {
  loteId: string;
  ventanas: number;
  fechasYaGuardadas: number;
  puEstimadas: number;
}

export interface ResumenSateliteHistorico {
  desde: string;
  hasta: string;
  lotes: PlanLoteSatelital[];
  puEstimadas: number;
  escrito: boolean;
  /** Motivo por el que no se consultó nada, si lo hubo. */
  detenido: string | null;
  pedidos: number;
  imagenesNuevas: number;
  imagenesYaGuardadas: number;
  errores: Array<{ loteId: string; mensaje: string }>;
  cortado: boolean;
}

export interface DependenciasSateliteHistorico {
  lotes(ids: string[] | undefined, limite: number): Promise<LoteSatelital[]>;
  fechasGuardadas(loteIds: string[], desde: string, hasta: string): Promise<Map<string, Set<string>>>;
  consultar(cuerpo: string): Promise<RespuestaCopernicus>;
  guardar(loteId: string, mediciones: MedicionSatelitalPersistible[]): Promise<void>;
  dormir(ms: number): Promise<void>;
}

async function lotesActivos(ids: string[] | undefined, limite: number): Promise<LoteSatelital[]> {
  const resultado = await pool.query<{ id: string; polygon: unknown; establecimiento_id: string }>(
    `SELECT id, polygon, establecimiento_id FROM lotes
      WHERE deleted_at IS NULL AND activo = TRUE AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
      ORDER BY establecimiento_id, numero LIMIT $2`,
    [ids ?? null, limite],
  );
  return resultado.rows
    .filter((fila): fila is { id: string; polygon: LoteSatelital['polygon']; establecimiento_id: string } => esPolygonFeature(fila.polygon))
    .map((fila) => ({ id: fila.id, polygon: fila.polygon, establecimientoId: fila.establecimiento_id }));
}

async function fechasSentinel2Guardadas(loteIds: string[], desde: string, hasta: string): Promise<Map<string, Set<string>>> {
  const porLote = new Map<string, Set<string>>(loteIds.map((id) => [id, new Set<string>()]));
  if (loteIds.length === 0) return porLote;
  const resultado = await pool.query<{ lote_id: string; observed_at: string }>(
    `SELECT lote_id, observed_at FROM mediciones_satelitales
      WHERE lote_id = ANY($1::uuid[]) AND fuente = 'sentinel-2' AND observed_at BETWEEN $2::date AND $3::date`,
    [loteIds, desde, hasta],
  );
  for (const fila of resultado.rows) porLote.get(fila.lote_id)?.add(fila.observed_at);
  return porLote;
}

/** Todas las imágenes nuevas de un lote en una transacción: o entran todas o ninguna. */
async function guardarEnTransaccion(loteId: string, mediciones: MedicionSatelitalPersistible[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const medicion of mediciones) await guardarMedicionSatelital(client, loteId, medicion);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const dependenciasReales: DependenciasSateliteHistorico = {
  lotes: lotesActivos,
  fechasGuardadas: fechasSentinel2Guardadas,
  consultar: (cuerpo) => copernicus.obtenerEstadisticas(cuerpo),
  guardar: guardarEnTransaccion,
  dormir: (ms) => new Promise((listo) => { setTimeout(listo, ms); }),
};

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo contactar a Copernicus.';
}

/**
 * Sin `escribir`, sólo arma el plan: qué lotes, cuántas ventanas y cuántas PU,
 * sin consultar a Copernicus. Con `escribir`, igual frena antes de consultar si
 * las PU estimadas pasan `maxPu`.
 */
export async function completarSateliteHistorico(
  opciones: OpcionesSateliteHistorico = {},
  deps: DependenciasSateliteHistorico = dependenciasReales,
): Promise<ResumenSateliteHistorico> {
  const hoy = opciones.hoy ?? hoyCalendario();
  const dias = opciones.dias ?? DIAS_HISTORIA_POR_DEFECTO;
  const desde = sumarDias(hoy, -(dias - 1));
  const ventanas = ventanasDeConsulta(desde, hoy);
  const lotes = await deps.lotes(opciones.ids, opciones.maxLotes ?? 200);
  const guardadas = await deps.fechasGuardadas(lotes.map((lote) => lote.id), desde, hoy);
  const plan = lotes.map((lote) => ({
    loteId: lote.id,
    ventanas: ventanas.length,
    fechasYaGuardadas: guardadas.get(lote.id)?.size ?? 0,
    puEstimadas: Math.round(puEstimadas(lote, diasEntreFechas(desde, hoy) + 1) * 100) / 100,
  }));
  const resumen: ResumenSateliteHistorico = {
    desde, hasta: hoy, lotes: plan,
    puEstimadas: Math.round(plan.reduce((total, lote) => total + lote.puEstimadas, 0) * 100) / 100,
    escrito: false, detenido: null, pedidos: 0, imagenesNuevas: 0, imagenesYaGuardadas: 0, errores: [], cortado: false,
  };
  if (!opciones.escribir) return resumen;
  const maximo = opciones.maxPu ?? MAXIMO_PU_POR_DEFECTO;
  if (resumen.puEstimadas > maximo) {
    return { ...resumen, detenido: `Las PU estimadas (${resumen.puEstimadas}) pasan el máximo de ${maximo}. Acotá con --lote, --dias o --max-lotes, o subí --max-pu.` };
  }

  const referencia = opciones.referencia ?? new Date();
  let siguiente = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < lotes.length && !resumen.cortado) {
      const lote = lotes[siguiente++];
      const yaGuardadas = guardadas.get(lote.id) ?? new Set<string>();
      const nuevas: MedicionSatelitalPersistible[] = [];
      let fallo: string | null = null;
      for (const ventana of ventanas) {
        if (resumen.cortado) return;
        let respuesta: RespuestaCopernicus;
        try {
          respuesta = await deps.consultar(cuerpoPeticion(lote, new Date(`${ventana.desde}T00:00:00Z`), new Date(`${sumarDias(ventana.hasta, 1)}T00:00:00Z`)));
        } catch (error) { fallo = mensajeDe(error); break; }
        resumen.pedidos += 1;
        if (respuesta.status === 429) { resumen.cortado = true; fallo = 'Copernicus limitó las consultas (429).'; break; }
        if (respuesta.status < 200 || respuesta.status >= 300) { fallo = `Copernicus respondió HTTP ${respuesta.status}.`; break; }
        const observaciones = observacionesDeRespuesta(respuesta.texto, ventana);
        if (!observaciones) { fallo = 'Copernicus devolvió una respuesta que no se pudo interpretar.'; break; }
        for (const observacion of observaciones) {
          if (yaGuardadas.has(observacion.fecha)) { resumen.imagenesYaGuardadas += 1; continue; }
          nuevas.push(medicionDesdeObservacion(observacion, referencia, ventana));
        }
        await deps.dormir(opciones.pausaMs ?? PAUSA_ENTRE_PEDIDOS_MS);
      }
      // Un lote a medias no se guarda: la serie quedaría con huecos que parecen nubes.
      if (fallo) { resumen.errores.push({ loteId: lote.id, mensaje: fallo }); continue; }
      try {
        if (nuevas.length > 0) await deps.guardar(lote.id, nuevas);
        resumen.imagenesNuevas += nuevas.length;
      } catch (error) {
        resumen.errores.push({ loteId: lote.id, mensaje: `No se pudo guardar: ${mensajeDe(error)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, lotes.length) }, () => trabajador()));
  return { ...resumen, escrito: true };
}
