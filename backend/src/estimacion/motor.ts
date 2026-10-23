import { diasEntreFechas, sumarDias } from '../fechas.js';
import { agruparClimaPorDia, type ClimaDelDia, type OrigenClima, type RegistroClimaDia } from './clima.js';
import {
  FRACCION_RFA,
  FRFA_DESDE_NDVI,
  PARAMETROS_PASTURA,
  estacionDelMes,
  type CriterioReingreso,
  type EurEstacional,
  type Parametro,
  type ParametrosFrfa,
  type TipoPastura,
} from './parametros.js';

/**
 * Estimación diaria de forraje producido y fecha estimada de reingreso.
 *
 * Funciones puras: reciben lo persistido y devuelven un cálculo derivado que
 * no se guarda, igual que copernicus/proyeccion.ts. No es ML ni un modelo
 * entrenado. Sólo usa Sentinel-2: el radar mide otra física y no entra acá.
 */

/** 2: condición por día. 3: sin pastoreos cuenta desde el alta del lote y usa el clima histórico. */
export const VERSION_MODELO = 'forraje-eur-3';

/**
 * Más exigente que COBERTURA_MINIMA del análisis satelital (0,35): acá el NDVI
 * de una imagen se arrastra durante días, así que una lectura parcial pesa más.
 */
export const COBERTURA_MINIMA_ESTIMACION = 0.6;

/**
 * Decisión de diseño, no agronómica: cuánto se tolera arrastrar el NDVI de la
 * última imagen. 30 días alcanzan para cubrir los 16 de pronóstico después de
 * una imagen de dos semanas; más allá, la cobertura del lote puede haber
 * cambiado demasiado.
 */
export const MAXIMO_DIAS_SIN_IMAGEN = 30;

export interface ObservacionOptica {
  fecha: string;
  ndviMediana: number | null;
  coberturaValida: number | null;
}

export interface UsoParaEstimacion {
  /** Entrada de los animales: hoy es la única fecha que se registra. */
  fecha: string;
  /** Queda null hasta que se destrabe el registro del resultado del pastoreo. */
  fechaSalida: string | null;
}

export interface EntradaEstimacion {
  tipoPastura: TipoPastura | null;
  desde: string;
  hoy: string;
  /** Sólo Sentinel-2. Puede incluir imágenes anteriores a `desde`. */
  observaciones: ObservacionOptica[];
  clima: RegistroClimaDia[];
  /** Puede incluir usos anteriores a `desde`. */
  usos: UsoParaEstimacion[];
  /**
   * Alta del lote en RODEO. Regla del equipo (22/10/2026): si no hay un uso
   * registrado, no hubo pastoreo, así que sin usos el descanso se cuenta desde
   * acá como mínimo.
   */
  fechaAlta?: string | null;
}

export type OrigenDia = 'observado' | 'proyectado' | 'en-pastoreo' | 'sin-dato';
export type TipoAncla = 'pastoreo' | 'inicio' | 'reanudacion';

export interface DiaEstimacion {
  fecha: string;
  crecimientoKgMsHaDia: number | null;
  /** Producido desde el ancla. No es la biomasa en pie del lote. */
  acumuladoKgMsHa: number | null;
  origen: OrigenDia;
  fechaAncla: string | null;
  tipoAncla: TipoAncla | null;
  diasDesdeAncla: number | null;
  ndviUsado: number | null;
  fechaImagen: string | null;
  diasDesdeImagen: number | null;
  climaUsado: OrigenClima | null;
  motivo: string | null;
}

export interface ErrorReinicio {
  fecha: string;
  fechaImagenAnterior: string;
  diasSinImagen: number;
  ndviSupuesto: number;
  ndviObservado: number;
  /** supuesto − observado: positivo si arrastrar el NDVI lo sobrestimaba. */
  diferencia: number;
}

/**
 * Condición estimada para pastorear según el estado foliar, de peor a mejor:
 * - `no-apto`: le falta más de una hoja (un filocrono) para la vida media foliar mínima;
 * - `cuidado`: le falta menos de una hoja;
 * - `perfecto`: entre la fecha temprana y la tardía;
 * - `regular`: pasó la tardía y las hojas más viejas empiezan a morir.
 */
export type CondicionPastoreo = 'no-apto' | 'cuidado' | 'perfecto' | 'regular';

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
  frfa: Parametro<ParametrosFrfa>;
  fraccionRfa: Parametro<number>;
  eur: Parametro<EurEstacional>;
  reingreso: Parametro<CriterioReingreso>;
  coberturaMinima: number;
  maximoDiasSinImagen: number;
}

export interface EstimacionForraje {
  versionModelo: string;
  tipoPastura: TipoPastura | null;
  desde: string;
  hasta: string | null;
  dias: DiaEstimacion[];
  reingreso: ReingresoEstimado | null;
  erroresReinicio: ErrorReinicio[];
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

export function frfaDesdeNdvi(ndvi: number, parametros: ParametrosFrfa): { valor: number; enTope: boolean } {
  const crudo = parametros.coeficiente * Math.exp(parametros.exponente * ndvi);
  return { valor: Math.min(parametros.maximo, Math.max(0, crudo)), enTope: crudo >= parametros.maximo };
}

/** kgMS/ha/día: g/MJ × MJ/m² da g/m², y × 10 pasa a kg/ha. */
export function crecimientoDiario(eur: number, frfa: number, fraccionRfa: number, radiacionMjM2: number): number {
  return eur * frfa * fraccionRfa * radiacionMjM2 * 10;
}

function periodosDePastoreo(usos: UsoParaEstimacion[]): PeriodoPastoreo[] {
  return usos
    .map((uso) => ({ entrada: uso.fecha, salida: uso.fechaSalida ?? uso.fecha }))
    .sort((a, b) => a.salida.localeCompare(b.salida));
}

function imagenesValidas(observaciones: ObservacionOptica[]): Array<{ fecha: string; ndvi: number }> {
  return observaciones
    .filter((obs) => obs.ndviMediana !== null && obs.coberturaValida !== null && obs.coberturaValida >= COBERTURA_MINIMA_ESTIMACION)
    .map((obs) => ({ fecha: obs.fecha, ndvi: obs.ndviMediana as number }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

type ImagenParaDia =
  | { imagen: { fecha: string; ndvi: number }; motivo: null }
  | { imagen: null; motivo: string; pastoreo?: string };

/** La última imagen buena hasta `dia`, siempre que ningún pastoreo la haya dejado vieja. */
function imagenParaDia(dia: string, imagenes: Array<{ fecha: string; ndvi: number }>, periodos: PeriodoPastoreo[]): ImagenParaDia {
  const imagen = imagenes.filter((candidata) => candidata.fecha <= dia).at(-1);
  if (!imagen) return { imagen: null, motivo: `Sin imagen Sentinel-2 con cobertura de al menos ${COBERTURA_MINIMA_ESTIMACION * 100} % hasta esta fecha.` };
  const pastoreo = periodos.filter((periodo) => periodo.entrada <= dia && periodo.salida >= imagen.fecha).at(-1);
  if (pastoreo) {
    return {
      imagen: null,
      pastoreo: pastoreo.entrada,
      motivo: `Sin imagen posterior al pastoreo del ${fecha(pastoreo.entrada)}: el NDVI anterior sobrestimaría el crecimiento.`,
    };
  }
  if (diasEntreFechas(imagen.fecha, dia) > MAXIMO_DIAS_SIN_IMAGEN) {
    return { imagen: null, motivo: `La última imagen válida es del ${fecha(imagen.fecha)}, hace más de ${MAXIMO_DIAS_SIN_IMAGEN} días.` };
  }
  return { imagen, motivo: null };
}

function sinDato(dia: string, motivo: string, climaUsado: OrigenClima | null = null): DiaEstimacion {
  return {
    fecha: dia, crecimientoKgMsHaDia: null, acumuladoKgMsHa: null, origen: 'sin-dato',
    fechaAncla: null, tipoAncla: null, diasDesdeAncla: null,
    ndviUsado: null, fechaImagen: null, diasDesdeImagen: null, climaUsado, motivo,
  };
}

function errorReinicio(dia: string, imagenes: Array<{ fecha: string; ndvi: number }>, periodos: PeriodoPastoreo[]): ErrorReinicio | null {
  const nueva = imagenes.find((imagen) => imagen.fecha === dia);
  if (!nueva) return null;
  // Si un pastoreo dejó vieja la imagen anterior, la caída la explica él y no es error del arrastre.
  const anterior = imagenParaDia(sumarDias(dia, -1), imagenes, periodos);
  if (!anterior.imagen) return null;
  return {
    fecha: dia,
    fechaImagenAnterior: anterior.imagen.fecha,
    diasSinImagen: diasEntreFechas(anterior.imagen.fecha, dia),
    ndviSupuesto: redondear(anterior.imagen.ndvi, 3),
    ndviObservado: redondear(nueva.ndvi, 3),
    diferencia: redondear(anterior.imagen.ndvi - nueva.ndvi, 3),
  };
}

function curvaDeCrecimiento(
  entrada: EntradaEstimacion,
  hasta: string,
  climaPorDia: Map<string, ClimaDelDia>,
  eur: EurEstacional,
  avisos: Set<string>,
): { dias: DiaEstimacion[]; erroresReinicio: ErrorReinicio[] } {
  const frfa = FRFA_DESDE_NDVI.valor as ParametrosFrfa;
  const fraccionRfa = FRACCION_RFA.valor as number;
  const imagenes = imagenesValidas(entrada.observaciones);
  const periodos = periodosDePastoreo(entrada.usos);
  const dias: DiaEstimacion[] = [];
  const erroresReinicio: ErrorReinicio[] = [];
  let ancla: { fecha: string; tipo: TipoAncla } | null = null;
  let acumulado = 0;
  let huboCrecimiento = false;

  for (let dia = entrada.desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    const pastoreo = periodos.find((periodo) => periodo.entrada <= dia && dia <= periodo.salida);
    if (pastoreo) {
      dias.push({ ...sinDato(dia, 'Animales en el lote.'), origen: 'en-pastoreo' });
      ancla = { fecha: pastoreo.salida, tipo: 'pastoreo' };
      acumulado = 0;
      continue;
    }

    const elegida = imagenParaDia(dia, imagenes, periodos);
    if (!elegida.imagen) {
      if (elegida.pastoreo) avisos.add(`Después del pastoreo del ${fecha(elegida.pastoreo)} no hay crecimiento estimado hasta la próxima imagen válida.`);
      dias.push(sinDato(dia, elegida.motivo));
      ancla = null;
      continue;
    }

    const radiacion = climaPorDia.get(dia)?.radiacionMjM2 ?? null;
    if (!radiacion) {
      dias.push(sinDato(dia, 'Sin radiación guardada para este día.'));
      ancla = null;
      continue;
    }

    const { valor: fraccionAbsorbida, enTope } = frfaDesdeNdvi(elegida.imagen.ndvi, frfa);
    if (enTope) avisos.add(`Hubo días con NDVI tan alto que la fracción de luz absorbida llegó al tope de ${String(frfa.maximo).replace('.', ',')}.`);
    const mes = Number(dia.slice(5, 7));
    const crecimiento = crecimientoDiario(eur[estacionDelMes(mes)], fraccionAbsorbida, fraccionRfa, radiacion.valor);

    if (!ancla) {
      ancla = { fecha: dia, tipo: huboCrecimiento ? 'reanudacion' : 'inicio' };
      acumulado = 0;
    }
    acumulado += crecimiento;
    huboCrecimiento = true;

    const error = errorReinicio(dia, imagenes, periodos);
    if (error) erroresReinicio.push(error);

    const diasDesdeImagen = diasEntreFechas(elegida.imagen.fecha, dia);
    if (diasDesdeImagen > 0) avisos.add('Entre imágenes se usa el NDVI de la última imagen válida: esos días suponen que la cobertura del lote no cambió.');
    if (radiacion.origen === 'pronostico') avisos.add('Los días con pronóstico usan la radiación pronosticada por Open-Meteo, no la observada.');

    dias.push({
      fecha: dia,
      crecimientoKgMsHaDia: redondear(crecimiento),
      acumuladoKgMsHa: redondear(acumulado),
      origen: diasDesdeImagen === 0 ? 'observado' : 'proyectado',
      fechaAncla: ancla.fecha,
      tipoAncla: ancla.tipo,
      diasDesdeAncla: diasEntreFechas(ancla.fecha, dia),
      ndviUsado: redondear(elegida.imagen.ndvi, 3),
      fechaImagen: elegida.imagen.fecha,
      diasDesdeImagen,
      climaUsado: radiacion.origen,
      motivo: null,
    });
  }
  return { dias, erroresReinicio };
}

/**
 * Una hoja menos que el estado foliar óptimo es "cuidado". La hoja se mide con
 * el filocrono más largo de la fuente, para no adelantar el aviso.
 */
function condicionDelDia(rapido: number, tardiaAlcanzada: string | null, dia: string, criterio: CriterioReingreso): CondicionPastoreo {
  const [vidaMinima] = criterio.vidaMediaFoliarGradosDia;
  if (tardiaAlcanzada !== null && dia > tardiaAlcanzada) return 'regular';
  if (rapido >= vidaMinima) return 'perfecto';
  if (rapido >= vidaMinima - criterio.filocronoGradosDia[1]) return 'cuidado';
  return 'no-apto';
}

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

  const [baseMinima, baseMaxima] = criterio.temperaturaBaseC;
  const [vidaMinima, vidaMaxima] = criterio.vidaMediaFoliarGradosDia;
  // La fecha temprana suma rápido (base baja) hasta el umbral bajo; la tardía, al revés.
  let rapido = 0;
  let lento = 0;
  let temprana: string | null = null;
  let tardia: string | null = null;
  let contadoHasta: string | null = null;
  let usaPronostico = false;
  let corte: string | null = null;
  let resumen: { conBaseMaxima: number; conBaseMinima: number } | null = null;
  const condiciones: DiaCondicion[] = [];

  // Sigue después de la tardía sólo para la condición de cada día: el resumen se congela en ella.
  for (let dia = inicio; dia <= ultimoDiaConClima; dia = sumarDias(dia, 1)) {
    const temperatura = climaPorDia.get(dia)?.temperaturaMedia ?? null;
    if (!temperatura) { if (tardia === null) corte = dia; break; }
    rapido += Math.max(0, temperatura.valor - baseMinima);
    lento += Math.max(0, temperatura.valor - baseMaxima);
    if (tardia === null) {
      if (temperatura.origen === 'pronostico') usaPronostico = true;
      contadoHasta = dia;
      resumen = { conBaseMaxima: redondear(lento), conBaseMinima: redondear(rapido) };
      if (temprana === null && rapido >= vidaMinima) temprana = dia;
      if (lento >= vidaMaxima) tardia = dia;
    }
    if (desde === undefined || dia >= desde) {
      condiciones.push({
        fecha: dia,
        condicion: condicionDelDia(rapido, tardia, dia, criterio),
        avanceEstadoFoliar: Math.round((rapido / vidaMinima) * 100),
        gradosDia: { conBaseMaxima: redondear(lento), conBaseMinima: redondear(rapido) },
        climaUsado: temperatura.origen,
      });
    }
  }

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
    dias: [], reingreso: null, erroresReinicio: [], avisos: [], mensaje: null, parametrosUsados: null,
  };
  if (!entrada.tipoPastura) {
    return { ...vacia, mensaje: 'El lote no tiene tipo de pastura cargado: sin ella no se puede estimar el forraje.' };
  }

  const pastura = PARAMETROS_PASTURA[entrada.tipoPastura];
  const parametrosUsados: ParametrosUsados = {
    pastura: pastura.nombre, frfa: FRFA_DESDE_NDVI, fraccionRfa: FRACCION_RFA, eur: pastura.eur, reingreso: pastura.reingreso,
    coberturaMinima: COBERTURA_MINIMA_ESTIMACION, maximoDiasSinImagen: MAXIMO_DIAS_SIN_IMAGEN,
  };
  if (!pastura.eur.valor && !pastura.reingreso.valor) {
    return { ...vacia, parametrosUsados, mensaje: `Sin parámetros para ${pastura.nombre}: no hay eficiencia de uso de la radiación ni criterio de reingreso con fuente verificada.` };
  }

  const climaPorDia = agruparClimaPorDia(entrada.clima);
  const ultimoDiaConClima = [...climaPorDia.keys()].sort().at(-1) ?? null;
  if (!ultimoDiaConClima || ultimoDiaConClima < entrada.desde) {
    return { ...vacia, parametrosUsados, mensaje: 'No hay clima guardado para el lote en el período: actualizá el clima para estimar.' };
  }

  const avisos = new Set<string>(['Estimación provisional: los parámetros salen de bibliografía y no están calibrados con cortes en este campo.']);
  if (entrada.clima.some((registro) => registro.esHistorico)) {
    avisos.add('Los días que las consultas de clima no cubrían se completaron con el clima histórico de Open-Meteo, de los mismos modelos.');
  }
  let mensaje: string | null = null;
  let dias: DiaEstimacion[] = [];
  let erroresReinicio: ErrorReinicio[] = [];
  if (pastura.eur.valor) {
    ({ dias, erroresReinicio } = curvaDeCrecimiento(entrada, ultimoDiaConClima, climaPorDia, pastura.eur.valor, avisos));
  } else {
    mensaje = `Sin eficiencia de uso de la radiación con fuente verificada para ${pastura.nombre}: no se estima el crecimiento diario.`;
  }

  let reingreso: ReingresoEstimado;
  if (pastura.reingreso.valor) {
    reingreso = estimarReingreso(pastura.reingreso.valor, entrada.usos, climaPorDia, entrada.hoy, ultimoDiaConClima, entrada.desde, entrada.fechaAlta);
    if (reingreso.esMinimo && reingreso.fechaInicioConteo) {
      avisos.add(`No hay pastoreos registrados: el descanso se cuenta desde el alta del lote en RODEO (${fecha(reingreso.fechaInicioConteo)}), con la regla de que sin uso registrado no hubo pastoreo. Si el último pastoreo fue antes, el lote está más avanzado de lo que se muestra.`);
    }
    if (reingreso.fechaUltimoPastoreo && entrada.usos.some((uso) => uso.fechaSalida === null)) {
      avisos.add('La salida de los animales no se registra: el descanso se cuenta desde la fecha del uso, así que el reingreso real puede ser más tarde.');
    }
  } else {
    reingreso = { ...REINGRESO_VACIO, mensaje: `Sin criterio de reingreso con fuente verificada para ${pastura.nombre}.` };
  }

  return {
    ...vacia, hasta: ultimoDiaConClima, dias, reingreso, erroresReinicio,
    avisos: [...avisos], mensaje, parametrosUsados,
  };
}
