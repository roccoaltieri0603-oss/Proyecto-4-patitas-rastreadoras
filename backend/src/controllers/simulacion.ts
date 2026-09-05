import type { Request, Response } from 'express';
import { pool } from '../base-datos/pool.js';
import { DIAS_VENTANA, FECHAS_TENDENCIA, analizadorSatelital } from '../copernicus/analizar.js';
import {
  MINIMO_PUNTOS,
  calcularProyeccionRecuperacion,
  pisoObservado,
  umbralRecuperadoDelLote,
} from '../copernicus/proyeccion.js';
import type { CondicionLote, LoteSatelital } from '../copernicus/types.js';
import { esPolygonFeature } from '../geometria.js';
import { ApiError } from '../http/errors.js';

/**
 * Simulación de pastoreo: herramienta de DEMO para la presentación.
 *
 * Responde "si este lote se pastoreara hoy, ¿en cuántos días volvería a estar
 * como suele estar?" usando únicamente observaciones reales ya persistidas del
 * propio lote: el piso del que parte, el nivel a recuperar y el ritmo salen de
 * su serie de Sentinel-2.
 *
 * Es un preview y **no escribe una sola fila**: no toca `mediciones_satelitales`
 * —esas tablas son sólo para observaciones reales de Copernicus— ni registra un
 * uso en `usos_lote`, que es el registro de campo de verdad. El resultado vive
 * en la respuesta y en la pantalla del navegador hasta que se recarga.
 *
 * Puede llegar a consultar Copernicus (cuando el historial persistido todavía
 * no tiene fechas suficientes), pero lo que vuelve se usa y se descarta:
 * guardar observaciones es trabajo de "Actualizar satélite".
 */

function userId(req: Request): string {
  if (!req.usuario) throw new ApiError(401, 'UNAUTHENTICATED', 'Necesitás iniciar sesión.');
  return req.usuario.id;
}

async function loteDelUsuario(req: Request): Promise<LoteSatelital> {
  const result = await pool.query<{ id: string; polygon: unknown }>(
    `SELECT l.id, l.polygon FROM lotes l JOIN establecimientos e ON e.id = l.establecimiento_id
     WHERE l.id = $1 AND e.user_id = $2 AND l.deleted_at IS NULL`,
    [req.params.id, userId(req)],
  );
  const fila = result.rows[0];
  if (!fila) throw new ApiError(404, 'LOT_NOT_FOUND', 'Lote inexistente.');
  if (!esPolygonFeature(fila.polygon)) {
    throw new ApiError(500, 'INVALID_STORED_POLYGON', 'El lote tiene una geometría almacenada inválida.');
  }
  return { id: fila.id, polygon: fila.polygon };
}

function indice(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/**
 * Serie real del lote, armada con los mismos campos y la misma cantidad de
 * fechas que la `tendencia` del análisis satelital, pero leída de PostgreSQL
 * en vez de pedirle una consulta nueva a Copernicus.
 */
async function tendenciaPersistida(loteId: string): Promise<CondicionLote['tendencia']> {
  const result = await pool.query(
    `SELECT observed_at, ndvi_mediana, ndmi_media, ndwi_media, evi_media
       FROM mediciones_satelitales
      WHERE lote_id = $1 AND fuente = 'sentinel-2'
        AND ndvi_mediana IS NOT NULL AND ndmi_media IS NOT NULL
        AND ndwi_media IS NOT NULL AND evi_media IS NOT NULL
      ORDER BY observed_at DESC, consulted_at DESC, id ASC
      LIMIT $2`,
    [loteId, FECHAS_TENDENCIA],
  );
  return result.rows
    .map((row) => ({
      fecha: row.observed_at as string,
      ndvi: indice(row.ndvi_mediana),
      ndmi: indice(row.ndmi_media),
      ndwi: indice(row.ndwi_media),
      evi: indice(row.evi_media),
    }))
    .filter((punto): punto is CondicionLote['tendencia'][number] =>
      punto.ndvi !== null && punto.ndmi !== null && punto.ndwi !== null && punto.evi !== null)
    .reverse();
}

/**
 * La misma serie que ve el análisis satelital, pedida a Copernicus y **sin
 * persistirla**: son observaciones reales de este lote, las mismas que dibuja
 * el gráfico del mapa, pero de las que la base sólo guarda la última de cada
 * pasada consultada. Persistirlas es trabajo de "Actualizar satélite", no de
 * una simulación.
 */
async function tendenciaDeCopernicus(lote: LoteSatelital): Promise<CondicionLote['tendencia']> {
  const [resultado] = await analizadorSatelital.analizarLotes([lote], new Date());
  if (resultado?.estado === 'ok') return resultado.condicion.tendencia;
  if (resultado?.estado === 'radar' && resultado.optico) return resultado.optico.tendencia;
  return [];
}

export async function simularPastoreo(req: Request, res: Response): Promise<void> {
  const lote = await loteDelUsuario(req);
  const persistida = await tendenciaPersistida(lote.id);

  // El historial persistido crece de a una fecha por pasada consultada, así que
  // un lote recién cargado tiene una o dos y la proyección no arranca. Cuando
  // pasa eso se le pide la serie a Copernicus, que tiene hasta seis fechas
  // reales de los últimos 45 días. Nada de lo que vuelve se guarda.
  let tendencia = persistida;
  let origen: 'persistido' | 'copernicus' = 'persistido';
  if (persistida.length < MINIMO_PUNTOS) {
    const consultada = await tendenciaDeCopernicus(lote);
    if (consultada.length > persistida.length) {
      tendencia = consultada;
      origen = 'copernicus';
    }
  }

  const piso = pisoObservado(tendencia);
  const umbral = umbralRecuperadoDelLote(tendencia);
  const recuperacion = piso && umbral !== null
    ? calcularProyeccionRecuperacion(tendencia, umbral, piso.puntaje)
    : null;

  // Sin estimación se dice por qué, en vez de completar con un número.
  let mensaje: string | null = null;
  if (!recuperacion) {
    mensaje = tendencia.length < MINIMO_PUNTOS
      ? `Este lote tiene ${tendencia.length} fecha${tendencia.length === 1 ? '' : 's'} óptica${tendencia.length === 1 ? '' : 's'} despejada${tendencia.length === 1 ? '' : 's'} en los últimos ${DIAS_VENTANA} días, y la proyección necesita al menos ${MINIMO_PUNTOS}. Es el mismo piso que usa la proyección real de la ficha.`
      : 'La serie real de este lote no viene subiendo lo suficiente como para estimar una recuperación, o el cruce cae fuera del horizonte de la proyección. No se inventa un número.';
  }

  res.json({
    simulacion: {
      loteId: lote.id,
      esSimulacion: true,
      generadoEn: new Date().toISOString(),
      puntosReales: tendencia.length,
      origen,
      piso,
      umbralRecuperado: umbral,
      recuperacion,
      mensaje,
    },
  });
}
