import { diasEntreFechas, sumarDias } from '../fechas.js';
import {
  biomasaPorDia,
  consumibleDelDia,
  convertirMedicion,
  type BiomasaDelDia,
  type ConsumibleDelDia,
  type Confianza,
  type MedicionAltura,
  type MedicionConvertida,
} from './biomasa.js';
import { agruparClimaPorDia, type ClimaDelDia, type OrigenClima, type RegistroClimaDia } from './clima.js';
import { cicloEstadoFoliar, type CicloEstadoFoliar, type CondicionPastoreo } from './estado-foliar.js';
import {
  INSTRUMENTOS,
  PARAMETROS_PASTURA,
  type ConversionAltura,
  type CriterioReingreso,
  type Instrumento,
  type Parametro,
  type TipoPastura,
} from './parametros.js';

/**
 * Estimación diaria de la etapa del pasto y de la fecha estimada de reingreso,
 * más el pasto en pie de los días con medición de altura.
 *
 * Funciones puras: reciben lo persistido y devuelven un cálculo derivado que
 * no se guarda, igual que copernicus/proyeccion.ts. No es ML ni un modelo
 * entrenado. No usa el satélite: la etapa sale de los grados-día.
 */

/**
 * 2: condición por día. 3: sin pastoreos cuenta desde el alta del lote y usa el clima histórico.
 * 4: interpola los días pasados entre dos imágenes y separa el error de reinicio por tipo.
 * 5: rebrote modelado después de cada pastoreo, relleno retroactivo, etapa, progreso y confianza por día.
 * 6: pasto en pie desde las mediciones de altura, con su error contra la medición siguiente.
 * 7: pasto para comer sobre el remanente objetivo (hoy sin fuente para ninguna pastura).
 * 8: sin crecimiento diario por EUR ni NDVI (25/10/2026): el pasto en pie vale sólo el día de la medición.
 */
export const VERSION_MODELO = 'forraje-8';

export type { CondicionPastoreo, Confianza, MedicionAltura, MedicionConvertida };

export interface UsoParaEstimacion {
  /** Entrada de los animales. */
  fecha: string;
  /** Salida registrada en la jornada; null en los usos viejos, que valen como un único día. */
  fechaSalida: string | null;
}

export interface EntradaEstimacion {
  tipoPastura: TipoPastura | null;
  desde: string;
  hoy: string;
  clima: RegistroClimaDia[];
  /** Puede incluir usos anteriores a `desde`: de ellos sale el ciclo de los primeros días. */
  usos: UsoParaEstimacion[];
  /**
   * Alta del lote en RODEO. Regla del equipo (22/10/2026): si no hay un uso
   * registrado, no hubo pastoreo, así que sin usos el descanso se cuenta desde
   * acá como mínimo.
   */
  fechaAlta?: string | null;
  /** Mediciones de altura del usuario. */
  mediciones?: MedicionAltura[];
}

/**
 * - `en-pastoreo`: animales en el lote;
 * - `rebrotando`: le falta para el estado foliar óptimo;
 * - `listo`: dentro de la ventana de reingreso;
 * - `pasado`: pasó la ventana y las hojas más viejas empiezan a morir.
 */
export type Etapa = 'en-pastoreo' | 'rebrotando' | 'listo' | 'pasado';

const ETAPA_DE_CONDICION: Record<CondicionPastoreo, Etapa> = { 'no-apto': 'rebrotando', cuidado: 'rebrotando', perfecto: 'listo', regular: 'pasado' };

export interface DiaEstimacion extends BiomasaDelDia, ConsumibleDelDia {
  fecha: string;
  /** De dónde sale la temperatura de ese día; null si falta. */
  climaUsado: OrigenClima | null;
  etapa: Etapa | null;
  /** Por qué no hay etapa, si no la hay. */
  motivoEtapa: string | null;
  /** Contada desde el alta del lote: el lote está como mínimo así de avanzado. */
  etapaEsMinimo: boolean;
  /** Grados-día (base baja) sobre la vida media foliar mínima: 1 es "listo". Sin tope. */
  progresoRebrote: number | null;
}

export interface DiaCondicion {
  fecha: string;
  condicion: CondicionPastoreo;
  /** Grados-día con la base baja sobre la vida media foliar mínima, en %. Pasa de 100 dentro y después de la ventana. */
  avanceEstadoFoliar: number;
  gradosDia: { conBaseMaxima: number; conBaseMinima: number };
  climaUsado: OrigenClima;
}

export interface ReingresoEstimado {
  criterio: CriterioReingreso | null;
  fechaUltimoPastoreo: string | null;
  fechaTemprana: string | null;
  fechaTardia: string | null;
  /** Grados-día desde el pastoreo hasta `contadoHasta`, con la temperatura base máxima y mínima. */
  gradosDiaAcumulados: { conBaseMaxima: number; conBaseMinima: number } | null;
  contadoHasta: string | null;
  usaPronostico: boolean;
  /** Un día por fecha desde el día siguiente al pastoreo (o `desde`) hasta el último día con temperatura, incluido el pronóstico. */
  condiciones: DiaCondicion[];
  /** null si hoy hay animales, no hay temperatura de hoy o no hay desde cuándo contar. */
  condicionHoy: DiaCondicion | null;
  /** Desde dónde se cuentan los grados-día: el día siguiente al último pastoreo, o el alta del lote si no hay pastoreos. */
  inicioConteo: 'pastoreo' | 'alta' | null;
  fechaInicioConteo: string | null;
  /**
   * true cuando se cuenta desde el alta: el último pastoreo pudo ser antes, así
   * que el lote está como mínimo así de avanzado. La condición es un piso y las
   * fechas, lo más tarde posible. Una condición "regular" sí es segura.
   */
  esMinimo: boolean;
  mensaje: string | null;
}

export interface ParametrosUsados {
  pastura: string;
  reingreso: Parametro<CriterioReingreso>;
  /** Altura → kg MS/ha por instrumento; null donde no hay fuente. */
  alturaAKg: Record<Instrumento, Parametro<ConversionAltura>>;
  /** Altura a dejar al sacar los animales; null donde no hay fuente. */
  remanenteObjetivoCm: Record<Instrumento, Parametro<number>>;
}

export interface EstimacionForraje {
  versionModelo: string;
  tipoPastura: TipoPastura | null;
  desde: string;
  hasta: string | null;
  dias: DiaEstimacion[];
  reingreso: ReingresoEstimado | null;
  /** Las mediciones de altura del período, con sus kilos si hay conversión con fuente. */
  mediciones: MedicionConvertida[];
  avisos: string[];
  mensaje: string | null;
  parametrosUsados: ParametrosUsados | null;
}

const REINGRESO_VACIO: ReingresoEstimado = {
  criterio: null, fechaUltimoPastoreo: null, fechaTemprana: null, fechaTardia: null,
  gradosDiaAcumulados: null, contadoHasta: null, usaPronostico: false, condiciones: [], condicionHoy: null,
  inicioConteo: null, fechaInicioConteo: null, esMinimo: false, mensaje: null,
};

interface PeriodoPastoreo {
  entrada: string;
  salida: string;
}

function redondear(valor: number, decimales = 1): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

function periodosDePastoreo(usos: UsoParaEstimacion[]): PeriodoPastoreo[] {
  return usos
    .map((uso) => ({ entrada: uso.fecha, salida: uso.fechaSalida ?? uso.fecha }))
    .sort((a, b) => a.salida.localeCompare(b.salida));
}

interface EtapaDelDia {
  etapa: Etapa | null;
  motivoEtapa: string | null;
  etapaEsMinimo: boolean;
  progresoRebrote: number | null;
}

/**
 * Etapa de cada día, ciclo por ciclo: cada ciclo de descanso va del día
 * siguiente a una salida (o del alta, si todavía no hubo pastoreos) hasta la
 * próxima entrada, con las mismas reglas de la fecha de reingreso.
 */
function etapasPorDia(
  desde: string, hasta: string, periodos: PeriodoPastoreo[], criterio: CriterioReingreso | null,
  climaPorDia: Map<string, ClimaDelDia>, fechaAlta: string | null, nombrePastura: string,
): Map<string, EtapaDelDia> {
  const resultado = new Map<string, EtapaDelDia>();
  const ciclos = new Map<string, { ciclo: CicloEstadoFoliar; porFecha: Map<string, CicloEstadoFoliar['dias'][number]> }>();
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    const sinEtapa = (motivo: string, etapaEsMinimo = false): EtapaDelDia => ({ etapa: null, motivoEtapa: motivo, etapaEsMinimo, progresoRebrote: null });
    if (periodos.some((periodo) => periodo.entrada <= dia && dia <= periodo.salida)) {
      resultado.set(dia, { etapa: 'en-pastoreo', motivoEtapa: null, etapaEsMinimo: false, progresoRebrote: null });
      continue;
    }
    if (!criterio) { resultado.set(dia, sinEtapa(`Sin criterio de reingreso con fuente para ${nombrePastura}: no se puede decir si está listo.`)); continue; }
    const anterior = periodos.filter((periodo) => periodo.salida < dia).at(-1);
    const inicio = anterior ? sumarDias(anterior.salida, 1) : fechaAlta;
    if (!inicio || inicio > dia) {
      resultado.set(dia, sinEtapa(fechaAlta ? 'Antes del alta del lote en RODEO.' : 'Sin pastoreos registrados ni fecha de alta: no hay desde cuándo contar.'));
      continue;
    }
    const proxima = periodos.map((periodo) => periodo.entrada).filter((entrada) => entrada > dia).sort()[0];
    let delCiclo = ciclos.get(inicio);
    if (!delCiclo) {
      const fin = proxima && sumarDias(proxima, -1) < hasta ? sumarDias(proxima, -1) : hasta;
      const ciclo = cicloEstadoFoliar(criterio, inicio, fin, climaPorDia);
      delCiclo = { ciclo, porFecha: new Map(ciclo.dias.map((item) => [item.fecha, item])) };
      ciclos.set(inicio, delCiclo);
    }
    const delDia = delCiclo.porFecha.get(dia);
    if (!delDia) {
      resultado.set(dia, sinEtapa(`Falta la temperatura del ${fecha(delCiclo.ciclo.corte ?? dia)}: no se puede seguir contando el descanso.`, !anterior));
      continue;
    }
    resultado.set(dia, {
      etapa: ETAPA_DE_CONDICION[delDia.condicion],
      motivoEtapa: null,
      etapaEsMinimo: !anterior,
      progresoRebrote: redondear(delDia.rapido / criterio.vidaMediaFoliarGradosDia[0], 2),
    });
  }
  return resultado;
}

const SIN_ETAPA: EtapaDelDia = { etapa: null, motivoEtapa: null, etapaEsMinimo: false, progresoRebrote: null };

export function estimarReingreso(
  criterio: CriterioReingreso,
  usos: UsoParaEstimacion[],
  climaPorDia: Map<string, ClimaDelDia>,
  hoy: string,
  ultimoDiaConClima: string,
  desde?: string,
  fechaAlta?: string | null,
): ReingresoEstimado {
  const base: ReingresoEstimado = { ...REINGRESO_VACIO, criterio };
  const ultimo = periodosDePastoreo(usos).at(-1);
  if (!ultimo && !fechaAlta) return { ...base, mensaje: 'No hay pastoreos registrados: no hay desde cuándo contar el descanso.' };
  // Sin pastoreos se cuenta desde el alta, con la regla de que sin uso registrado no hubo pastoreo.
  const esMinimo = !ultimo;
  const inicio = ultimo ? sumarDias(ultimo.salida, 1) : fechaAlta as string;
  const desdeCuando = ultimo ? `el pastoreo del ${fecha(ultimo.salida)}` : `el alta del lote (${fecha(inicio)})`;

  const [vidaMinima] = criterio.vidaMediaFoliarGradosDia;
  const { dias, temprana, tardia, contadoHasta, resumen, usaPronostico, corte } = cicloEstadoFoliar(criterio, inicio, ultimoDiaConClima, climaPorDia);
  const condiciones: DiaCondicion[] = dias
    .filter((dia) => desde === undefined || dia.fecha >= desde)
    .map((dia) => ({
      fecha: dia.fecha,
      condicion: dia.condicion,
      avanceEstadoFoliar: Math.round((dia.rapido / vidaMinima) * 100),
      gradosDia: { conBaseMaxima: redondear(dia.lento), conBaseMinima: redondear(dia.rapido) },
      climaUsado: dia.climaUsado,
    }));

  const resultado: ReingresoEstimado = {
    ...base,
    fechaUltimoPastoreo: ultimo?.salida ?? null,
    fechaTemprana: temprana,
    fechaTardia: tardia,
    gradosDiaAcumulados: resumen,
    contadoHasta,
    usaPronostico,
    condiciones,
    condicionHoy: condiciones.find((condicion) => condicion.fecha === hoy) ?? null,
    inicioConteo: ultimo ? 'pastoreo' : 'alta',
    fechaInicioConteo: inicio,
    esMinimo,
  };
  if (tardia) return resultado;
  if (corte) {
    return { ...resultado, mensaje: `Falta la temperatura del ${fecha(corte)}: no se pueden seguir contando grados-día desde ${desdeCuando}. Se completa con la próxima actualización de clima.` };
  }
  const diasConPronostico = Math.max(0, diasEntreFechas(hoy, ultimoDiaConClima));
  return {
    ...resultado,
    mensaje: temprana
      ? `La fecha tardía no se alcanza dentro de los ${diasConPronostico} días con pronóstico.`
      : `No alcanza el estado foliar óptimo dentro de los ${diasConPronostico} días con pronóstico.`,
  };
}

export function estimarForraje(entrada: EntradaEstimacion): EstimacionForraje {
  const vacia: EstimacionForraje = {
    versionModelo: VERSION_MODELO, tipoPastura: entrada.tipoPastura, desde: entrada.desde, hasta: null,
    dias: [], reingreso: null, mediciones: [], avisos: [], mensaje: null, parametrosUsados: null,
  };
  if (!entrada.tipoPastura) {
    return { ...vacia, mensaje: 'El lote no tiene tipo de pastura cargado: sin ella no se puede estimar el forraje.' };
  }

  const pastura = PARAMETROS_PASTURA[entrada.tipoPastura];
  const criterio = pastura.reingreso.valor;
  const parametrosUsados: ParametrosUsados = {
    pastura: pastura.nombre, reingreso: pastura.reingreso, alturaAKg: pastura.alturaAKg, remanenteObjetivoCm: pastura.remanenteObjetivoCm,
  };
  const conConversion = INSTRUMENTOS.some((instrumento) => pastura.alturaAKg[instrumento].valor !== null);
  if (!criterio && !conConversion) {
    return { ...vacia, parametrosUsados, mensaje: `Sin parámetros para ${pastura.nombre}: no hay criterio de reingreso ni conversión de altura a kilos con fuente verificada.` };
  }

  const climaPorDia = agruparClimaPorDia(entrada.clima);
  const ultimoDiaConClima = [...climaPorDia.keys()].sort().at(-1) ?? null;
  if (!ultimoDiaConClima || ultimoDiaConClima < entrada.desde) {
    return { ...vacia, parametrosUsados, mensaje: 'No hay clima guardado para el lote en el período: actualizá el clima para estimar.' };
  }

  const avisos = new Set<string>(['Estimación provisional: los parámetros salen de bibliografía y no están calibrados en este campo.']);
  if (entrada.clima.some((registro) => registro.esHistorico)) {
    avisos.add('Los días que las consultas de clima no cubrían se completaron con el clima histórico de Open-Meteo, de los mismos modelos.');
  }
  const periodos = periodosDePastoreo(entrada.usos);
  const etapas = etapasPorDia(entrada.desde, ultimoDiaConClima, periodos, criterio, climaPorDia, entrada.fechaAlta ?? null, pastura.nombre);

  const mediciones = (entrada.mediciones ?? [])
    .filter((medicion) => medicion.fecha >= entrada.desde && medicion.fecha <= ultimoDiaConClima)
    .map((medicion) => convertirMedicion(medicion, pastura.alturaAKg[medicion.instrumento]))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const medicion of mediciones) for (const aviso of medicion.avisos) avisos.add(`Medición del ${fecha(medicion.fecha)}: ${aviso}`);

  const fechas: string[] = [];
  for (let dia = entrada.desde; dia <= ultimoDiaConClima; dia = sumarDias(dia, 1)) fechas.push(dia);
  const pastoEnPie = biomasaPorDia(fechas, mediciones);
  const dias = fechas.map((dia): DiaEstimacion => {
    const etapa = etapas.get(dia) ?? SIN_ETAPA;
    const medida = pastoEnPie.get(dia) as BiomasaDelDia;
    const biomasa = etapa.etapa === 'en-pastoreo' && medida.biomasaEnPieKgMsHa === null ? { ...medida, motivoBiomasa: 'Animales en el lote.' } : medida;
    return {
      fecha: dia,
      climaUsado: climaPorDia.get(dia)?.temperaturaMedia?.origen ?? null,
      ...etapa,
      ...biomasa,
      ...consumibleDelDia(dia, biomasa, mediciones, pastura.remanenteObjetivoCm, pastura.alturaAKg, pastura.nombre),
    };
  });

  let reingreso: ReingresoEstimado;
  let mensaje: string | null = null;
  if (criterio) {
    reingreso = estimarReingreso(criterio, entrada.usos, climaPorDia, entrada.hoy, ultimoDiaConClima, entrada.desde, entrada.fechaAlta);
    if (reingreso.esMinimo && reingreso.fechaInicioConteo) {
      avisos.add(`No hay pastoreos registrados: el descanso se cuenta desde el alta del lote en RODEO (${fecha(reingreso.fechaInicioConteo)}), con la regla de que sin uso registrado no hubo pastoreo. Si el último pastoreo fue antes, el lote está más avanzado de lo que se muestra.`);
    }
    if (reingreso.fechaUltimoPastoreo && entrada.usos.some((uso) => uso.fechaSalida === null)) {
      avisos.add('La salida de los animales no se registra: el descanso se cuenta desde la fecha del uso, así que el reingreso real puede ser más tarde.');
    }
  } else {
    reingreso = { ...REINGRESO_VACIO, mensaje: `Sin criterio de reingreso con fuente verificada para ${pastura.nombre}.` };
    mensaje = `Sin criterio de reingreso con fuente verificada para ${pastura.nombre}: sólo se informa el pasto en pie de los días con medición.`;
  }

  return { ...vacia, hasta: ultimoDiaConClima, dias, reingreso, mediciones, avisos: [...avisos], mensaje, parametrosUsados };
}
