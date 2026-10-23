/**
 * Elige, para cada día, qué dato climático usar entre todas las consultas
 * guardadas. Cada consulta de Open-Meteo repite días ya consultados, así que
 * una misma fecha puede tener varias filas: observadas y pronosticadas.
 *
 * Regla, en este orden: el valor observado (`es_pronostico = false`) de la
 * consulta regular más reciente; si no hay, el del clima histórico
 * (`clima_historico_lote`, que sólo completa días faltantes); si tampoco, el
 * pronóstico más reciente. Se elige variable por variable porque las filas
 * anteriores a la migración 014 tienen temperatura pero no radiación: tirar la
 * temperatura observada de esos días por falta de radiación sería descartar un
 * dato real.
 */

export type OrigenClima = 'observado' | 'historico' | 'pronostico';

export interface RegistroClimaDia {
  fecha: string;
  /** Instante de la consulta que trajo la fila. */
  consultadoEn: string;
  esPronostico: boolean;
  /** Viene de clima_historico_lote y no de una consulta regular. */
  esHistorico?: boolean;
  tempMin: number | null;
  tempMax: number | null;
  radiacionMjM2: number | null;
}

export interface ValorClima {
  valor: number;
  origen: OrigenClima;
}

export interface ClimaDelDia {
  temperaturaMedia: ValorClima | null;
  radiacionMjM2: ValorClima | null;
}

function masReciente(a: RegistroClimaDia, b: RegistroClimaDia): number {
  return Date.parse(b.consultadoEn) - Date.parse(a.consultadoEn);
}

function origenDe(registro: RegistroClimaDia): OrigenClima {
  if (registro.esPronostico) return 'pronostico';
  return registro.esHistorico ? 'historico' : 'observado';
}

function elegir(registros: RegistroClimaDia[], valor: (registro: RegistroClimaDia) => number | null): ValorClima | null {
  for (const origen of ['observado', 'historico', 'pronostico'] as const) {
    const candidato = registros
      .filter((registro) => origenDe(registro) === origen && valor(registro) !== null)
      .sort(masReciente)[0];
    if (candidato) return { valor: valor(candidato) as number, origen };
  }
  return null;
}

/** Media diaria como (mínima + máxima) / 2, la convención de los grados-día. */
function temperaturaMedia(registro: RegistroClimaDia): number | null {
  return registro.tempMin === null || registro.tempMax === null ? null : (registro.tempMin + registro.tempMax) / 2;
}

export function agruparClimaPorDia(registros: RegistroClimaDia[]): Map<string, ClimaDelDia> {
  const porFecha = new Map<string, RegistroClimaDia[]>();
  for (const registro of registros) porFecha.set(registro.fecha, [...(porFecha.get(registro.fecha) ?? []), registro]);
  const resultado = new Map<string, ClimaDelDia>();
  for (const [fecha, delDia] of porFecha) {
    resultado.set(fecha, {
      temperaturaMedia: elegir(delDia, temperaturaMedia),
      radiacionMjM2: elegir(delDia, (registro) => registro.radiacionMjM2),
    });
  }
  return resultado;
}
