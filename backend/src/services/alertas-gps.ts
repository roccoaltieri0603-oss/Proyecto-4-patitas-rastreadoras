import type { PoolClient } from 'pg';
import { mantenerIncidenciaActiva, resolverIncidencia } from './notificaciones.js';
import { UMBRALES_BATERIA_GPS } from './gps-simulados.js';

type TipoIncidenciaGps = 'gps_simulado_bateria_baja' | 'gps_simulado_bateria_critica' | 'gps_simulado_bateria_episodio'
  | 'gps_simulado_sin_senal' | 'gps_simulado_fuera_establecimiento'
  | 'gps_simulado_fuera_lote_asignado' | 'gps_simulado_bateria_agotada' | 'gps_simulado_cambio_lote';
type TipoAlertaGps = Exclude<TipoIncidenciaGps, 'gps_simulado_bateria_episodio'>;

interface ContextoGps {
  establecimientoId: string;
  userId: string;
  dispositivoId: string;
  numero: 1 | 2;
  apodo: string;
}

const clave = (gps: ContextoGps) => `gps:${gps.userId}:${gps.dispositivoId}`;
const rotulo = (gps: ContextoGps) => `GPS simulado ${gps.numero}${gps.apodo ? ` · ${gps.apodo}` : ''}`;

export function decidirTransicionBateria(porcentaje: number, nivelInformado: 'baja' | 'critica' | 'agotada' | null) {
  const { baja, critica } = UMBRALES_BATERIA_GPS;
  if (porcentaje > baja) return { episodioActivo: false, nivelActual: 'normal' as const, nivelInformado: null, notificar: null };
  const nivelActual = porcentaje === 0 ? 'agotada' as const : porcentaje <= critica ? 'critica' as const : 'baja' as const;
  const notificar = !nivelInformado || (nivelActual === 'agotada' && nivelInformado !== 'agotada')
    || (nivelActual === 'critica' && nivelInformado === 'baja') ? nivelActual : null;
  const orden = { baja: 1, critica: 2, agotada: 3 } as const;
  return { episodioActivo: true, nivelActual, nivelInformado: !nivelInformado || orden[nivelActual] > orden[nivelInformado] ? nivelActual : nivelInformado, notificar };
}

async function abrir(db: PoolClient, gps: ContextoGps, tipo: TipoAlertaGps, motivo: string, detallesExtra: Record<string, unknown> = {}): Promise<void> {
  const incidenciaTipo = tipo as Parameters<typeof mantenerIncidenciaActiva>[1]['tipo'];
  const incidenciaClave = clave(gps);
  const titulo = `${rotulo(gps)} · ${motivo}`;
  const mensaje = `${rotulo(gps)}: ${motivo}. Simulación de GPS · no es telemetría real.`;
  const details = { origen: 'gps_personal', dispositivoId: gps.dispositivoId, numero: gps.numero, apodo: gps.apodo, titulo, mensaje, simulacion: true, ...detallesExtra };
  await mantenerIncidenciaActiva(db, {
    establecimientoId: gps.establecimientoId, tipo: incidenciaTipo, clave: incidenciaClave, detalles: details,
    titulo, mensaje, enviarNotificacion: true,
  });
}

export async function resolver(db: PoolClient, gps: ContextoGps, tipos: TipoIncidenciaGps[]): Promise<void> {
  for (const tipo of tipos) await resolverIncidencia(db, gps.establecimientoId, tipo, clave(gps));
}

export async function evaluarBateria(db: PoolClient, gps: ContextoGps, porcentaje: number): Promise<void> {
  const { baja, critica } = UMBRALES_BATERIA_GPS;
  if (porcentaje > baja) {
    await resolver(db, gps, ['gps_simulado_bateria_episodio', 'gps_simulado_bateria_baja', 'gps_simulado_bateria_critica', 'gps_simulado_bateria_agotada']);
    return;
  }
  const episode = await db.query<{ id: string; detalles: Record<string, unknown> }>(
    `SELECT id,detalles FROM incidencias_establecimiento WHERE establecimiento_id=$1
      AND tipo='gps_simulado_bateria_episodio' AND clave=$2 AND estado='activa' FOR UPDATE`,
    [gps.establecimientoId, clave(gps)],
  );
  const informed = typeof episode.rows[0]?.detalles?.nivelInformado === 'string' ? episode.rows[0].detalles.nivelInformado : null;
  const previousLevel = informed === 'critica' || informed === 'baja' || informed === 'agotada' ? informed : null;
  const transition = decidirTransicionBateria(porcentaje, previousLevel);
  if (!episode.rows[0]) {
    await mantenerIncidenciaActiva(db, { establecimientoId: gps.establecimientoId,
      tipo: 'gps_simulado_bateria_episodio', clave: clave(gps),
      detalles: { origen: 'gps_personal', dispositivoId: gps.dispositivoId, numero: gps.numero,
        apodo: gps.apodo, porcentaje, nivelInformado: transition.nivelInformado },
      titulo: `${rotulo(gps)} con batería ${transition.nivelActual}`, mensaje: `Episodio de batería ${transition.nivelActual}.`, enviarNotificacion: false });
  }
  if (transition.notificar) {
    if (transition.notificar === 'agotada') {
      await resolver(db, gps, ['gps_simulado_bateria_baja', 'gps_simulado_bateria_critica']);
      await abrir(db, gps, 'gps_simulado_bateria_agotada', 'tiene la batería simulada agotada (0 %)');
    } else if (transition.notificar === 'critica') {
      await resolver(db, gps, ['gps_simulado_bateria_baja']);
      await abrir(db, gps, 'gps_simulado_bateria_critica', `batería crítica (${porcentaje} %)`);
    } else {
      await abrir(db, gps, 'gps_simulado_bateria_baja', `batería baja (${porcentaje} %)`);
    }
  }
  if (episode.rows[0]) {
    if (transition.nivelInformado !== previousLevel) {
      await db.query(`UPDATE incidencias_establecimiento SET detalles=jsonb_set(detalles,'{nivelInformado}',$2::jsonb),
        ultima_deteccion=NOW() WHERE id=$1`, [episode.rows[0].id, JSON.stringify(transition.nivelInformado)]);
    } else {
      await db.query('UPDATE incidencias_establecimiento SET ultima_deteccion=NOW() WHERE id=$1', [episode.rows[0].id]);
    }
  }
  if (transition.nivelActual === 'baja' && (previousLevel === 'critica' || previousLevel === 'agotada')) await resolver(db, gps, ['gps_simulado_bateria_critica', 'gps_simulado_bateria_agotada']);
  if (transition.nivelActual === 'critica' && previousLevel === 'agotada') await resolver(db, gps, ['gps_simulado_bateria_agotada']);
}

export async function evaluarConexion(db: PoolClient, gps: ContextoGps, conexion: 'en-linea' | 'sin-senal'): Promise<void> {
  if (conexion === 'sin-senal') await abrir(db, gps, 'gps_simulado_sin_senal', 'perdió la señal simulada');
  else await resolver(db, gps, ['gps_simulado_sin_senal']);
}

export async function evaluarLimiteEstablecimiento(db: PoolClient, gps: ContextoGps, dentro: boolean): Promise<void> {
  if (dentro) await resolver(db, gps, ['gps_simulado_fuera_establecimiento']);
  else await abrir(db, gps, 'gps_simulado_fuera_establecimiento', 'está fuera del establecimiento');
}

export async function evaluarLoteAsignado(db: PoolClient, gps: ContextoGps, lote: { id: string; numero: number; apodo: string | null } | null, dentro: boolean): Promise<void> {
  if (!lote || dentro) await resolver(db, gps, ['gps_simulado_fuera_lote_asignado']);
  else await abrir(db, gps, 'gps_simulado_fuera_lote_asignado', `está fuera de su lote asignado, Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ''}`, { loteAsignadoId: lote.id, numeroLoteAsignado: lote.numero });
}

export async function notificarCambioLote(db: PoolClient, gps: ContextoGps, anterior: { id: string; numero: number; apodo: string | null }, actual: { id: string; numero: number; apodo: string | null }): Promise<void> {
  const nombres = (lote: { numero: number; apodo: string | null }) => `Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ''}`;
  const source = `${rotulo(gps)} pasó de ${nombres(anterior)} a ${nombres(actual)}. Simulación de GPS · no es telemetría real.`;
  await resolver(db, gps, ['gps_simulado_cambio_lote']);
  const details = { origen: 'gps_personal', dispositivoId: gps.dispositivoId, numero: gps.numero, apodo: gps.apodo,
    simulacion: true, loteAnteriorId: anterior.id, loteActualId: actual.id, titulo: `${rotulo(gps)} · Cambio de lote`, mensaje: source };
  await mantenerIncidenciaActiva(db, { establecimientoId: gps.establecimientoId, tipo: 'gps_simulado_cambio_lote',
    clave: clave(gps), detalles: details, titulo: details.titulo, mensaje: source });
  await resolver(db, gps, ['gps_simulado_cambio_lote']);
}

export async function desasignarLoteInactivo(db: PoolClient, establecimientoId: string, loteId: string): Promise<void> {
  const rows = await db.query<{ user_id: string; dispositivo_id: string; numero: 1 | 2; apodo: string }>(
    `UPDATE gps_simulados SET lote_asignado_id=NULL, updated_at=NOW()
      WHERE establecimiento_id=$1 AND lote_asignado_id=$2
      RETURNING user_id, id AS dispositivo_id, numero, apodo`, [establecimientoId, loteId],
  );
  for (const row of rows.rows) await resolver(db, { establecimientoId, userId: row.user_id,
    dispositivoId: row.dispositivo_id, numero: row.numero, apodo: row.apodo }, ['gps_simulado_fuera_lote_asignado']);
}
