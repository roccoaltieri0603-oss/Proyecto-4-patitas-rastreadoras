import type { Feature, Polygon } from 'geojson';
import { climaHistoricoDisponible } from '../base-datos/clima-historico-disponible.js';
import { pool } from '../base-datos/pool.js';
import { diasEntreFechas, esFechaCalendario, hoyCalendario, sumarDias } from '../fechas.js';
import { esPolygonFeature } from '../geometria.js';
import { centroidOf, type LoteClima, type RespuestaOpenMeteo, type TransporteOpenMeteo } from './open-meteo.js';

/**
 * Clima diario histórico del centroide de cada lote.
 *
 * Cada consulta regular de Open-Meteo trae sólo 7 días pasados, así que el
 * clima guardado de un lote empieza el día que alguien lo consultó por primera
 * vez. La estimación de forraje necesita temperatura de todos los días desde el
 * último pastoreo —o desde el alta del lote si no hay ninguno— y de toda su
 * ventana. Esto completa sólo los días que faltan.
 *
 * Fuente: la API de pronóstico histórico de Open-Meteo con `best_match`. Son
 * los mismos modelos que la consulta regular, así que la serie no cambia de
 * fuente en la costura, y cada corrida se inicializa con mediciones reales. Se
 * guarda sólo lo que devuelve; un día ya guardado no se reescribe.
 *
 * No se usa el archivo ERA5 (/v1/archive) para los días viejos: la propia
 * documentación de Open-Meteo recomienda el pronóstico histórico "for the most
 * accurate representation of past conditions over the last few years", y ERA5
 * está pensado para consistencia de largo plazo, a 25 km y con 5 días de demora.
 * La estimación nunca mira más de 366 días atrás, todos dentro de esta API.
 */

const ENDPOINT = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
export const PROVEEDOR_HISTORICO = 'open-meteo-historical-forecast';
export const MODELO_HISTORICO = 'best_match';
/** Igual a la ventana por defecto del endpoint de estimación: el gráfico necesita radiación en toda ella. */
export const VENTANA_CRECIMIENTO_DIAS = 60;
/** Igual al máximo de `desde` del endpoint de estimación. */
export const MAXIMO_DIAS_HISTORICOS = 366;
/** La API de pronóstico histórico tiene datos desde 2021 o 2022 según el modelo. */
export const COBERTURA_HISTORICA_DESDE = '2022-01-01';
const TIMEOUT_MS = 30_000;

export interface DiaHistorico {
  fecha: string;
  tempMin: number | null;
  tempMax: number | null;
  radiacionMjM2: number | null;
}

export type ResultadoHistoricoLote =
  | { estado: 'ok'; loteId: string; latitud: number; longitud: number; dias: DiaHistorico[] }
  | { estado: 'error'; loteId: string; mensaje: string; limite?: boolean };

function aNumero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function aNoNegativo(valor: unknown): number | null {
  const numero = aNumero(valor);
  return numero !== null && numero >= 0 ? numero : null;
}

/** Días de la respuesta dentro del rango pedido que traen al menos un dato. */
export function aDiasHistoricos(registro: unknown, desde: string, hasta: string): DiaHistorico[] | null {
  if (!registro || typeof registro !== 'object') return null;
  const daily = (registro as Record<string, unknown>).daily;
  if (!daily || typeof daily !== 'object') return null;
  const campos = daily as Record<string, unknown>;
  const tiempos = campos.time;
  if (!Array.isArray(tiempos) || tiempos.some((fecha) => !esFechaCalendario(fecha)) || new Set(tiempos).size !== tiempos.length) return null;
  const maximas = Array.isArray(campos.temperature_2m_max) ? campos.temperature_2m_max : [];
  const minimas = Array.isArray(campos.temperature_2m_min) ? campos.temperature_2m_min : [];
  const radiaciones = Array.isArray(campos.shortwave_radiation_sum) ? campos.shortwave_radiation_sum : [];
  return (tiempos as string[])
    .map((fecha, i) => ({ fecha, tempMin: aNumero(minimas[i]), tempMax: aNumero(maximas[i]), radiacionMjM2: aNoNegativo(radiaciones[i]) }))
    .filter((dia) => dia.fecha >= desde && dia.fecha <= hasta)
    .filter((dia) => dia.tempMin !== null || dia.tempMax !== null || dia.radiacionMjM2 !== null);
}

const transporteFetch: TransporteOpenMeteo = async (url, signal) => fetch(url, { signal });

export class OpenMeteoHistoricoClient {
  constructor(private transportar: TransporteOpenMeteo = transporteFetch) {}

  reemplazarTransporte(transportar: TransporteOpenMeteo): TransporteOpenMeteo {
    const anterior = this.transportar;
    this.transportar = transportar;
    return anterior;
  }

  /** Una sola consulta multi-coordenada para todos los lotes, con el mismo rango de fechas. */
  async consultar(lotes: LoteClima[], desde: string, hasta: string): Promise<Record<string, ResultadoHistoricoLote>> {
    if (lotes.length === 0) return {};
    const centros = lotes.map((lote) => centroidOf(lote.polygon));
    const params = new URLSearchParams({
      latitude: centros.map(([lat]) => lat.toFixed(4)).join(','),
      longitude: centros.map(([, lng]) => lng.toFixed(4)).join(','),
      start_date: desde,
      end_date: hasta,
      daily: 'temperature_2m_max,temperature_2m_min,shortwave_radiation_sum',
      // Igual que la consulta regular: los días se cortan en la hora local del lote.
      timezone: 'auto',
    });
    const errorParaTodos = (mensaje: string, limite = false) => Object.fromEntries(lotes.map((lote) => [lote.id, { estado: 'error', loteId: lote.id, mensaje, limite } as const]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let respuesta: RespuestaOpenMeteo;
    try {
      respuesta = await this.transportar(`${ENDPOINT}?${params.toString()}`, controller.signal);
    } catch {
      clearTimeout(timeout);
      return errorParaTodos('No se pudo contactar al servicio meteorológico histórico (Open-Meteo).');
    }
    clearTimeout(timeout);
    if (respuesta.status === 429) return errorParaTodos('Open-Meteo alcanzó el límite de consultas.', true);
    if (!respuesta.ok) return errorParaTodos(`Open-Meteo respondió HTTP ${respuesta.status}.`);
    let json: unknown;
    try { json = await respuesta.json(); } catch { return errorParaTodos('Open-Meteo devolvió una respuesta que no se pudo interpretar.'); }
    const registros: unknown[] = Array.isArray(json) ? json : [json];
    const resultados: Record<string, ResultadoHistoricoLote> = {};
    lotes.forEach((lote, i) => {
      const dias = aDiasHistoricos(registros[i], desde, hasta);
      const [latitud, longitud] = centros[i];
      resultados[lote.id] = dias
        ? { estado: 'ok', loteId: lote.id, latitud, longitud, dias }
        : { estado: 'error', loteId: lote.id, mensaje: 'Sin datos históricos de Open-Meteo para este lote.' };
    });
    return resultados;
  }
}

export const openMeteoHistorico = new OpenMeteoHistoricoClient();

export interface LoteConFaltantes extends LoteClima {
  /** Fechas sin temperatura y radiación observadas ni histórico guardado, en orden. */
  faltantes: string[];
}

/**
 * Lotes activos con días sin clima completo entre su inicio y ayer. El inicio
 * es lo más viejo entre el día siguiente al último uso (o el alta del lote, si
 * no tiene usos), la ventana de la estimación y `desde`, sin pasar el máximo
 * histórico. Un día cuenta como cubierto si una consulta regular lo trajo
 * observado con temperatura y radiación, o si ya está en el histórico.
 */
export async function lotesConClimaFaltante(hoy: string, limite: number, ids?: string[], desde?: string): Promise<LoteConFaltantes[]> {
  const piso = [sumarDias(hoy, -MAXIMO_DIAS_HISTORICOS), COBERTURA_HISTORICA_DESDE].sort().at(-1) as string;
  const resultado = await pool.query<{ id: string; polygon: unknown; faltantes: string[] }>(
    `WITH objetivo AS (
       SELECT l.id, l.polygon,
              GREATEST(
                LEAST(COALESCE(u.ultimo + 1, (l.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date), $1::date, COALESCE($6::date, $1::date)),
                $2::date
              ) AS inicio
         FROM lotes l
         LEFT JOIN LATERAL (
           SELECT MAX(COALESCE((salida_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, fecha)) AS ultimo
             FROM usos_lote WHERE lote_id = l.id
         ) u ON TRUE
        WHERE l.deleted_at IS NULL AND l.activo = TRUE
          AND ($4::uuid[] IS NULL OR l.id = ANY($4::uuid[]))
     ), cubiertos AS (
       SELECT c.lote_id, d.fecha
         FROM dias_clima d JOIN consultas_clima c ON c.id = d.consulta_clima_id
        WHERE c.lote_id IN (SELECT id FROM objetivo)
          AND NOT d.es_pronostico AND d.temp_min IS NOT NULL AND d.temp_max IS NOT NULL AND d.radiacion_mj_m2 IS NOT NULL
       UNION
       SELECT h.lote_id, h.fecha FROM clima_historico_lote h WHERE h.lote_id IN (SELECT id FROM objetivo)
     )
     SELECT o.id, o.polygon, array_agg(g.dia::date::text ORDER BY g.dia) AS faltantes
       FROM objetivo o
       CROSS JOIN LATERAL generate_series(o.inicio, $3::date, INTERVAL '1 day') AS g(dia)
      WHERE NOT EXISTS (SELECT 1 FROM cubiertos k WHERE k.lote_id = o.id AND k.fecha = g.dia::date)
      GROUP BY o.id, o.polygon
      ORDER BY MIN(g.dia), o.id
      LIMIT $5`,
    [sumarDias(hoy, -VENTANA_CRECIMIENTO_DIAS), piso, sumarDias(hoy, -1), ids ?? null, limite, desde ?? null],
  );
  return resultado.rows
    .filter((fila): fila is { id: string; polygon: Feature<Polygon>; faltantes: string[] } => esPolygonFeature(fila.polygon))
    .map((fila) => ({ id: fila.id, polygon: fila.polygon, faltantes: fila.faltantes }));
}

/** Guarda sólo los días faltantes; un día que ya estaba no se reescribe. Devuelve cuántos guardó. */
export async function guardarDiasHistoricos(
  resultado: Extract<ResultadoHistoricoLote, { estado: 'ok' }>,
  faltantes: Set<string>,
  referencia: Date,
): Promise<number> {
  const dias = resultado.dias.filter((dia) => faltantes.has(dia.fecha));
  if (dias.length === 0) return 0;
  const insertados = await pool.query(
    `INSERT INTO clima_historico_lote (lote_id, fecha, temp_min, temp_max, radiacion_mj_m2, latitud, longitud, proveedor, modelo, consulted_at)
     SELECT $1, d.fecha, d.temp_min, d.temp_max, d.radiacion_mj_m2, $2, $3, $4, $5, $6
       FROM UNNEST($7::date[], $8::double precision[], $9::double precision[], $10::double precision[])
            AS d(fecha, temp_min, temp_max, radiacion_mj_m2)
      WHERE EXISTS (SELECT 1 FROM lotes WHERE id = $1 AND deleted_at IS NULL)
     ON CONFLICT (lote_id, fecha) DO NOTHING`,
    [
      resultado.loteId, resultado.latitud, resultado.longitud, PROVEEDOR_HISTORICO, MODELO_HISTORICO, referencia,
      dias.map((dia) => dia.fecha), dias.map((dia) => dia.tempMin), dias.map((dia) => dia.tempMax), dias.map((dia) => dia.radiacionMjM2),
    ],
  );
  return insertados.rowCount ?? 0;
}

export interface OpcionesClimaHistorico {
  /** Sólo estos lotes; sin esto, cualquier lote activo con faltantes. */
  ids?: string[];
  /** Completa también desde esta fecha, aunque la estimación todavía no la necesite. */
  desde?: string;
  maxLotes?: number;
  tamanoTanda?: number;
  pausaMs?: number;
  /** Deja de empezar tandas nuevas pasado este tiempo, para no alargar una request. */
  presupuestoMs?: number;
  hoy?: string;
  referencia?: Date;
}

export interface ResumenClimaHistorico {
  disponible: boolean;
  pendientes: number;
  consultados: number;
  lotesCompletados: number;
  diasGuardados: number;
  errores: number;
  cortado: boolean;
}

export interface DependenciasClimaHistorico {
  disponible(): Promise<boolean>;
  lotesConFaltantes: typeof lotesConClimaFaltante;
  consultar(lotes: LoteClima[], desde: string, hasta: string): Promise<Record<string, ResultadoHistoricoLote>>;
  guardar: typeof guardarDiasHistoricos;
  dormir(ms: number): Promise<void>;
  ahoraMs(): number;
  registrar(evento: Record<string, unknown>): void;
}

const dependenciasReales: DependenciasClimaHistorico = {
  disponible: () => climaHistoricoDisponible(),
  lotesConFaltantes: lotesConClimaFaltante,
  consultar: (lotes, desde, hasta) => openMeteoHistorico.consultar(lotes, desde, hasta),
  guardar: guardarDiasHistoricos,
  dormir: (ms) => new Promise((listo) => { setTimeout(listo, ms); }),
  ahoraMs: () => Date.now(),
  registrar: (evento) => { console.log(JSON.stringify(evento)); },
};

export const MAX_LOTES_HISTORICO = 40;
export const TAMANO_TANDA_HISTORICO = 5;
export const PAUSA_HISTORICO_MS = 2_000;
/** Tandas seguidas fallando entero antes de cortar, como en la actualización programada. */
const TANDAS_FALLIDAS_PARA_CORTAR = 2;

/**
 * Open-Meteo cuenta como varias llamadas un pedido de más de 2 semanas
 * (https://open-meteo.com/en/pricing). Se estima por lote, de más, para que el
 * plan no prometa entrar en el límite diario y después se pase.
 */
const DIAS_POR_LLAMADA = 14;

interface Tanda {
  lotes: LoteConFaltantes[];
  desde: string;
  hasta: string;
}

/** Ordenados por su primer faltante, para que cada tanda pida rangos parecidos. */
function armarTandas(lotes: LoteConFaltantes[], tamano: number): Tanda[] {
  const salida: Tanda[] = [];
  for (let i = 0; i < lotes.length; i += Math.max(1, tamano)) {
    const grupo = lotes.slice(i, i + Math.max(1, tamano));
    salida.push({
      lotes: grupo,
      desde: grupo.map((lote) => lote.faltantes[0]).sort()[0],
      hasta: grupo.map((lote) => lote.faltantes.at(-1) as string).sort().at(-1) as string,
    });
  }
  return salida;
}

function pesoEstimado(tanda: Tanda): number {
  const dias = diasEntreFechas(tanda.desde, tanda.hasta) + 1;
  return tanda.lotes.length * Math.max(1, dias / DIAS_POR_LLAMADA);
}

export interface PlanClimaHistorico {
  disponible: boolean;
  lotes: Array<{ loteId: string; diasFaltantes: number; desde: string; hasta: string }>;
  tandas: Array<{ loteIds: string[]; desde: string; hasta: string; llamadasEstimadas: number }>;
  diasFaltantes: number;
  llamadasEstimadas: number;
}

/** Lo que haría completarClimaHistorico, sin consultar a Open-Meteo ni escribir nada. */
export async function planificarClimaHistorico(
  opciones: OpcionesClimaHistorico = {},
  deps: Pick<DependenciasClimaHistorico, 'disponible' | 'lotesConFaltantes'> = dependenciasReales,
): Promise<PlanClimaHistorico> {
  const plan: PlanClimaHistorico = { disponible: false, lotes: [], tandas: [], diasFaltantes: 0, llamadasEstimadas: 0 };
  if (!(await deps.disponible())) return plan;
  const lotes = await deps.lotesConFaltantes(opciones.hoy ?? hoyCalendario(), opciones.maxLotes ?? MAX_LOTES_HISTORICO, opciones.ids, opciones.desde);
  const grupos = armarTandas(lotes, opciones.tamanoTanda ?? TAMANO_TANDA_HISTORICO);
  return {
    disponible: true,
    lotes: lotes.map((lote) => ({ loteId: lote.id, diasFaltantes: lote.faltantes.length, desde: lote.faltantes[0], hasta: lote.faltantes.at(-1) as string })),
    tandas: grupos.map((tanda) => ({ loteIds: tanda.lotes.map((lote) => lote.id), desde: tanda.desde, hasta: tanda.hasta, llamadasEstimadas: Math.round(pesoEstimado(tanda) * 10) / 10 })),
    diasFaltantes: lotes.reduce((total, lote) => total + lote.faltantes.length, 0),
    llamadasEstimadas: Math.round(grupos.reduce((total, tanda) => total + pesoEstimado(tanda), 0) * 10) / 10,
  };
}

export async function completarClimaHistorico(
  opciones: OpcionesClimaHistorico = {},
  deps: DependenciasClimaHistorico = dependenciasReales,
): Promise<ResumenClimaHistorico> {
  const resumen: ResumenClimaHistorico = { disponible: false, pendientes: 0, consultados: 0, lotesCompletados: 0, diasGuardados: 0, errores: 0, cortado: false };
  if (!(await deps.disponible())) return resumen;
  resumen.disponible = true;

  const hoy = opciones.hoy ?? hoyCalendario();
  const lotes = await deps.lotesConFaltantes(hoy, opciones.maxLotes ?? MAX_LOTES_HISTORICO, opciones.ids, opciones.desde);
  resumen.pendientes = lotes.length;
  const inicio = deps.ahoraMs();
  let fallidasSeguidas = 0;
  const grupos = armarTandas(lotes, opciones.tamanoTanda ?? TAMANO_TANDA_HISTORICO);

  for (const [indice, { lotes: tanda, desde, hasta }] of grupos.entries()) {
    if (opciones.presupuestoMs !== undefined && deps.ahoraMs() - inicio > opciones.presupuestoMs) { resumen.cortado = true; break; }
    const resultados = await deps.consultar(tanda, desde, hasta);
    let erroresTanda = 0;
    let limite = false;
    for (const lote of tanda) {
      resumen.consultados += 1;
      const resultado = resultados[lote.id];
      if (!resultado || resultado.estado === 'error') {
        resumen.errores += 1;
        erroresTanda += 1;
        if (resultado?.estado === 'error' && resultado.limite) limite = true;
        continue;
      }
      try {
        resumen.diasGuardados += await deps.guardar(resultado, new Set(lote.faltantes), opciones.referencia ?? new Date());
        resumen.lotesCompletados += 1;
      } catch (error) {
        resumen.errores += 1;
        deps.registrar({ evento: 'clima_historico_no_persistido', loteId: lote.id, detalle: String(error) });
      }
    }
    if (limite) {
      resumen.cortado = true;
      deps.registrar({ evento: 'clima_historico_cortado', motivo: 'límite de consultas de Open-Meteo' });
      break;
    }
    fallidasSeguidas = erroresTanda === tanda.length ? fallidasSeguidas + 1 : 0;
    if (fallidasSeguidas >= TANDAS_FALLIDAS_PARA_CORTAR) {
      resumen.cortado = true;
      deps.registrar({ evento: 'clima_historico_cortado', motivo: 'tandas seguidas con error' });
      break;
    }
    if (indice < grupos.length - 1) await deps.dormir(opciones.pausaMs ?? PAUSA_HISTORICO_MS);
  }
  return resumen;
}
