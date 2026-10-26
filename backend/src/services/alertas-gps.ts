import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { mantenerIncidenciaActiva, resolverIncidencia } from './notificaciones.js';
import { registrarNotificacionPersonal } from './notificaciones-personales.js';
import { UMBRALES_BATERIA_GPS } from './gps-simulados.js';

type TipoIncidenciaGps = 'gps_simulado_bateria_baja' | 'gps_simulado_bateria_critica' | 'gps_simulado_bateria_episodio'
  | 'gps_simulado_sin_senal' | 'gps_simulado_fuera_establecimiento'
  | 'gps_simulado_fuera_lote_asignado';
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

export function decidirTransicionBateria(porcentaje: number, nivelInformado: 'baja' | 'critica' | null) {
  const { baja, critica } = UMBRALES_BATERIA_GPS;
  if (porcentaje > baja) return { episodioActivo: false, nivelActual: 'normal' as const, nivelInformado: null, notificar: null };
  const nivelActual = porcentaje <= critica ? 'critica' as const : 'baja' as const;
  const notificar = !nivelInformado || (nivelActual === 'critica' && nivelInformado === 'baja') ? nivelActual : null;
  return { episodioActivo: true, nivelActual, nivelInformado: nivelActual === 'critica' || !nivelInformado ? nivelActual : nivelInformado, notificar };
}

async function abrir(db: PoolClient, gps: ContextoGps, tipo: TipoAlertaGps, motivo: string, detallesExtra: Record<string, unknown> = {}, avisarResponsable = false): Promise<void> {
  const incidenciaTipo = tipo as Parameters<typeof mantenerIncidenciaActiva>[1]['tipo'];
  const incidenciaClave = clave(gps);
  const activa = await db.query<{ id: string }>(
    `SELECT id FROM incidencias_establecimiento
      WHERE establecimiento_id=$1 AND tipo=$2 AND clave=$3 AND estado='activa' FOR UPDATE`,
    [gps.establecimientoId, incidenciaTipo, incidenciaClave],
  );
  const details = { origen: 'gps_personal', dispositivoId: gps.dispositivoId, numero: gps.numero, apodo: gps.apodo, ...detallesExtra };
  const incidenciaId = await mantenerIncidenciaActiva(db, {
    establecimientoId: gps.establecimientoId, tipo: incidenciaTipo, clave: incidenciaClave, detalles: details,
    titulo: `${rotulo(gps)} · ${motivo}`,
    mensaje: `${rotulo(gps)}: ${motivo}. Simulación de GPS · no es telemetría real.`,
    soloResponsableGps: avisarResponsable,
    enviarNotificacion: avisarResponsable,
  });
  if (!activa.rows[0]) {
    await registrarNotificacionPersonal(db, {
      userId: gps.userId, establecimientoId: gps.establecimientoId, sourceId: incidenciaId,
      tipo, titulo: `${rotulo(gps)} · ${motivo}`,
      mensaje: `${rotulo(gps)}: ${motivo}. Simulación de GPS · no es telemetría real.`,
      metadata: { ...details, simulacion: true },
    });
  }
}

export async function resolver(db: PoolClient, gps: ContextoGps, tipos: TipoIncidenciaGps[]): Promise<void> {
  for (const tipo of tipos) await resolverIncidencia(db, gps.establecimientoId, tipo, clave(gps));
}

export async function evaluarBateria(db: PoolClient, gps: ContextoGps, porcentaje: number): Promise<void> {
  const { baja, critica } = UMBRALES_BATERIA_GPS;
  if (porcentaje > baja) {
    await resolver(db, gps, ['gps_simulado_bateria_episodio', 'gps_simulado_bateria_baja', 'gps_simulado_bateria_critica']);
    return;
  }
  const episode = await db.query<{ id: string; detalles: Record<string, unknown> }>(
    `SELECT id,detalles FROM incidencias_establecimiento WHERE establecimiento_id=$1
      AND tipo='gps_simulado_bateria_episodio' AND clave=$2 AND estado='activa' FOR UPDATE`,
    [gps.establecimientoId, clave(gps)],
  );
  const informed = typeof episode.rows[0]?.detalles?.nivelInformado === 'string' ? episode.rows[0].detalles.nivelInformado : null;
  const previousLevel = informed === 'critica' || informed === 'baja' ? informed : null;
  const transition = decidirTransicionBateria(porcentaje, previousLevel);
  if (!episode.rows[0]) {
    await mantenerIncidenciaActiva(db, { establecimientoId: gps.establecimientoId,
      tipo: 'gps_simulado_bateria_episodio', clave: clave(gps),
      detalles: { origen: 'gps_personal', dispositivoId: gps.dispositivoId, numero: gps.numero,
        apodo: gps.apodo, porcentaje, nivelInformado: transition.nivelInformado },
      titulo: `${rotulo(gps)} con batería ${transition.nivelActual}`, mensaje: `Episodio de batería ${transition.nivelActual}.`, enviarNotificacion: false });
  }
  if (transition.notificar) {
    if (transition.notificar === 'critica') {
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
  if (transition.nivelActual === 'baja' && previousLevel === 'critica') await resolver(db, gps, ['gps_simulado_bateria_critica']);
}

export async function evaluarConexion(db: PoolClient, gps: ContextoGps, conexion: 'en-linea' | 'sin-senal'): Promise<void> {
  if (conexion === 'sin-senal') await abrir(db, gps, 'gps_simulado_sin_senal', 'perdió la señal simulada');
  else await resolver(db, gps, ['gps_simulado_sin_senal']);
}

export async function evaluarLimiteEstablecimiento(db: PoolClient, gps: ContextoGps, dentro: boolean): Promise<void> {
  if (dentro) await resolver(db, gps, ['gps_simulado_fuera_establecimiento']);
  else await abrir(db, gps, 'gps_simulado_fuera_establecimiento', 'está fuera del establecimiento', {}, true);
}

export async function evaluarLoteAsignado(db: PoolClient, gps: ContextoGps, lote: { id: string; numero: number; apodo: string | null } | null, dentro: boolean): Promise<void> {
  if (!lote || dentro) await resolver(db, gps, ['gps_simulado_fuera_lote_asignado']);
  else await abrir(db, gps, 'gps_simulado_fuera_lote_asignado', `está fuera de su lote asignado, Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ''}`, { loteAsignadoId: lote.id, numeroLoteAsignado: lote.numero });
}

export async function notificarCambioLote(db: PoolClient, gps: ContextoGps, anterior: { id: string; numero: number; apodo: string | null }, actual: { id: string; numero: number; apodo: string | null }): Promise<void> {
  const nombres = (lote: { numero: number; apodo: string | null }) => `Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ''}`;
  const source = `Cambio de lote del ${rotulo(gps)}: ${nombres(anterior)} → ${nombres(actual)}.`;
  await registrarNotificacionPersonal(db, {
    userId: gps.userId, establecimientoId: gps.establecimientoId, sourceId: randomUUID(),
    tipo: 'gps_simulado_cambio_lote', titulo: `${rotulo(gps)} cambió de lote`,
    mensaje: `${source} Simulación de GPS · no es telemetría real.`,
    metadata: { simulacion: true, dispositivoId: gps.dispositivoId, numero: gps.numero,
      loteAnterior: { id: anterior.id, numero: anterior.numero, apodo: anterior.apodo },
      loteActual: { id: actual.id, numero: actual.numero, apodo: actual.apodo } },
  });
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
