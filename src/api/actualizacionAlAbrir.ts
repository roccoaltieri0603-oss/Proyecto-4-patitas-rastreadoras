import type { ResultadoAlAbrir } from '../../backend/src/services/actualizacion-al-abrir.js';
import type { ResultadoClimaLote } from '../clima/types.js';

export interface AvisoActualizacionAlAbrir {
  kind: 'error' | 'warning' | 'success';
  text: string;
}

export interface DependenciasActualizacionAlAbrir {
  actualizar(establecimientoId: string): Promise<ResultadoAlAbrir>;
  obtenerLecturas(establecimientoId: string): Promise<{ clima: Record<string, ResultadoClimaLote> }>;
}

export type EstadoActualizacionAlAbrir = 'completo' | 'parcial' | 'fallido' | 'omitido' | 'obsoleto';

export interface ResultadoActualizacionAlAbrir {
  estado: EstadoActualizacionAlAbrir;
  clima?: Record<string, ResultadoClimaLote>;
  aviso?: AvisoActualizacionAlAbrir;
  claveAviso?: string;
}

function resumenParcial(respuesta: ResultadoAlAbrir): string[] {
  const clima = respuesta.resumen?.clima;
  if (!clima) return ['el backend no devolvió el resumen climático'];
  const motivos: string[] = [];
  if (clima.errores) motivos.push(`${clima.errores} lote(s) con error`);
  if (clima.sinDatos) motivos.push(`${clima.sinDatos} lote(s) sin una lectura nueva`);
  if (clima.cortado) motivos.push('se alcanzó el límite de tiempo');
  if (clima.consultados < clima.pendientes) motivos.push('quedaron lotes sin consultar');

  const historico = respuesta.resumen?.climaHistorico;
  if (historico && (historico.errores > 0 || (historico.cortado && historico.consultados < historico.pendientes))) {
    motivos.push('el clima histórico para la estimación quedó incompleto');
  }
  return motivos;
}

/** Ejecuta la actualización ambiental al abrir y devuelve solo lecturas climáticas guardadas. */
export async function actualizarClimaAlAbrir(
  establecimientoId: string,
  sigueVigente: () => boolean,
  dependencias: DependenciasActualizacionAlAbrir,
): Promise<ResultadoActualizacionAlAbrir> {
  try {
    const respuesta = await dependencias.actualizar(establecimientoId);
    if (!sigueVigente()) return { estado: 'obsoleto' };
    if (!respuesta.ejecutado && respuesta.motivo === 'reciente') return { estado: 'omitido' };
    if (!respuesta.ejecutado || !respuesta.resumen) {
      return {
        estado: 'fallido',
        aviso: { kind: 'error', text: 'No se pudo actualizar el clima al abrir. Se mantienen las últimas lecturas guardadas; podés reintentar desde Clima.' },
        claveAviso: `fallido:${establecimientoId}`,
      };
    }

    const lecturas = await dependencias.obtenerLecturas(establecimientoId);
    if (!sigueVigente()) return { estado: 'obsoleto' };

    const motivos = resumenParcial(respuesta);
    if (motivos.length) {
      return {
        estado: 'parcial',
        clima: lecturas.clima,
        aviso: {
          kind: 'warning',
          text: `La actualización del clima quedó parcial: ${motivos.join('; ')}. Se conservan las lecturas guardadas.`,
        },
        claveAviso: `parcial:${establecimientoId}:${respuesta.resumen.terminoEn}`,
      };
    }

    return {
      estado: 'completo',
      clima: lecturas.clima,
      ...(respuesta.resumen.clima.persistidos > 0 ? {
        aviso: { kind: 'success' as const, text: `Clima actualizado para ${respuesta.resumen.clima.persistidos} lote(s).` },
        claveAviso: `completo:${establecimientoId}:${respuesta.resumen.terminoEn}`,
      } : {}),
    };
  } catch {
    if (!sigueVigente()) return { estado: 'obsoleto' };
    return {
      estado: 'fallido',
      aviso: { kind: 'error', text: 'No se pudo actualizar o recargar el clima. Se mantienen las últimas lecturas guardadas; podés reintentar desde Clima.' },
      claveAviso: `fallido:${establecimientoId}`,
    };
  }
}
