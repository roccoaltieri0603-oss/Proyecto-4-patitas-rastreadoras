import {
  actualizarLotesPendientes,
  type DependenciasActualizacion,
  type ResumenActualizacion,
} from './actualizacion-programada.js';

/**
 * Actualización que se dispara cuando alguien abre su establecimiento.
 *
 * El productor entra a decidir a qué lote manda los animales, no a administrar
 * consultas a un servicio satelital. Esto reusa exactamente la misma rutina que
 * corre la tarea diaria (`actualizarLotesPendientes`), acotada a un solo
 * establecimiento: mismos umbrales de antigüedad, mismas tandas, mismas pausas y
 * la misma regla de no persistir nada que no haya devuelto el proveedor.
 *
 * Dos frenos, porque esto corre dentro de un request y no en un planificador:
 *
 * - una sola corrida por establecimiento a la vez, compartida: si tres personas
 *   del mismo campo entran juntas, las tres esperan la misma promesa en vez de
 *   consultar tres veces lo mismo;
 * - un enfriamiento, para que recargar la página no gaste cuota. Reemplaza al
 *   freno por antigüedad que vivía en `persistirConsultaClima`, que ahora decide
 *   por contenido y ya no protege la cuota por sí solo.
 *
 * Los topes son chicos a propósito: esto corre con un usuario esperando y el
 * servidor corta el request a los 90 s. El volumen grande lo sigue haciendo la
 * tarea diaria.
 */

/**
 * El satélite **no** entra en la corrida en vivo (0 lotes).
 *
 * Una sola tanda de Copernicus puede tardar hasta 60 s y el límite de tiempo
 * sólo se puede chequear entre tandas, así que una tanda lenta se comía el
 * request entero y dejaba al clima sin consultar. Además Sentinel-2 vuelve a
 * pasar por el mismo lugar cada varios días: no hay nada que ganar
 * consultándolo cada vez que alguien abre la aplicación.
 *
 * Lo sigue actualizando la rutina diaria, y el botón "Actualizar satélite"
 * sigue estando para quien lo quiera forzar.
 */
export const MAX_LOTES_SATELITE_AL_ABRIR = 0;
/** Clima por corrida en vivo. Open-Meteo responde rápido y acepta varios lotes por consulta. */
export const MAX_LOTES_CLIMA_AL_ABRIR = 40;
/**
 * Techo de tiempo de la corrida. El servidor corta el request a los 90 s, así
 * que esto tiene que terminar bastante antes: lo que no entra queda para la
 * próxima vez que entren o para la rutina diaria, y lo ya consultado quedó
 * guardado igual.
 */
export const LIMITE_MS = 20_000;
/** Pausa entre tandas, más corta que la de la rutina diaria porque hay alguien esperando. */
export const PAUSA_MS_AL_ABRIR = 300;
/** Recargar la página no vuelve a consultar antes de esto. */
export const MINUTOS_ENFRIAMIENTO = 15;

export interface ResultadoAlAbrir {
  ejecutado: boolean;
  /** Por qué no se ejecutó, cuando `ejecutado` es false. */
  motivo?: 'reciente';
  resumen?: ResumenActualizacion;
}

const enCurso = new Map<string, Promise<ResumenActualizacion>>();
const ultimaCorrida = new Map<string, number>();

/** Para los tests: ninguna de las dos guardas debe filtrarse entre casos. */
export function reiniciarEstadoAlAbrir(): void {
  enCurso.clear();
  ultimaCorrida.clear();
}

export async function actualizarAlAbrir(
  establecimientoId: string,
  deps?: DependenciasActualizacion,
  ahora: Date = new Date(),
): Promise<ResultadoAlAbrir> {
  const corriendo = enCurso.get(establecimientoId);
  if (corriendo) return { ejecutado: true, resumen: await corriendo };

  const ultima = ultimaCorrida.get(establecimientoId);
  if (ultima !== undefined && ahora.getTime() - ultima < MINUTOS_ENFRIAMIENTO * 60_000) {
    return { ejecutado: false, motivo: 'reciente' };
  }

  const corrida = actualizarLotesPendientes({
    establecimientoId,
    maxLotes: MAX_LOTES_SATELITE_AL_ABRIR,
    maxLotesClima: MAX_LOTES_CLIMA_AL_ABRIR,
    pausaMs: PAUSA_MS_AL_ABRIR,
    limiteMs: LIMITE_MS,
    ahora,
  }, deps);

  enCurso.set(establecimientoId, corrida);
  try {
    const resumen = await corrida;
    // Sólo cuenta como corrida hecha si terminó: un fallo no debe dejar el
    // establecimiento en enfriamiento sin haber consultado nada.
    ultimaCorrida.set(establecimientoId, ahora.getTime());
    return { ejecutado: true, resumen };
  } finally {
    enCurso.delete(establecimientoId);
  }
}
