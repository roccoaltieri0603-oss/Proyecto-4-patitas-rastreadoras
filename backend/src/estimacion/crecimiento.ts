import { diasEntreFechas, sumarDias } from '../fechas.js';
import type { ClimaDelDia } from './clima.js';
import { PARAMETROS_CRECIMIENTO, type EcuacionPpna, type Parametro, type ParametrosCrecimiento } from './parametros.js';

/**
 * Tasa de crecimiento promedio de los últimos 60 días, con el cálculo de
 * Grigera, Oesterheld y Pacín (2007): fRFA desde el NDVI, RFA desde la
 * radiación global y PPNA por una recta sobre la RFA absorbida acumulada.
 *
 * Funciones puras: reciben lo persistido (NDVI de Sentinel-2 y radiación de
 * Open-Meteo) y devuelven un derivado que no se guarda. No es ML. El paso es de
 * 60 días porque así está calibrada la fuente: no da valores diarios ni
 * semanales, y por eso no se usa para proyectar el pasto en pie.
 *
 * Sentinel-1 no interviene: el radar no mide NDVI.
 */

export interface ObservacionNdvi {
  fecha: string;
  /** Mediana del NDVI de una imagen óptica despejada. */
  ndvi: number;
}

export interface VentanaCrecimiento {
  desde: string;
  hasta: string;
}

export interface CrecimientoEstimado {
  /** Promedio de la ventana, en kg MS/ha/día; null cuando falta algo. */
  kgMsHaDia: number | null;
  ventana: VentanaCrecimiento | null;
  /** PPNA de la ventana, en g MS/m² por 60 días, como la publica la fuente. */
  ppnaGM2: number | null;
  /** RFA absorbida acumulada en la ventana, en MJ/m². */
  rfaaMjM2: number | null;
  /** Imágenes ópticas despejadas usadas dentro de la ventana. */
  imagenesDespejadas: number;
  ecuacion: Parametro<EcuacionPpna>;
  parametros: Parametro<ParametrosCrecimiento>;
  /** Por qué no hay número, si no hay. */
  motivo: string | null;
  /** Lo que hay que leer junto al número; vacío cuando no hay número. */
  avisos: string[];
}

/** Van siempre junto al número: son los límites de la fuente, no una aclaración opcional. */
export const AVISOS_CRECIMIENTO = [
  'La relación entre el NDVI y la radiación absorbida se calibró con imágenes MODIS en el sudoeste bonaerense, 2000-2003. Según M. Oyarzabal (LART, FAUBA), el NDVI de Sentinel-2 es muy parecido.',
  'La fuente midió el pasto producido por encima de 4 cm de altura. Por eso no se suma al pasto en pie de las mediciones de altura, que se cortan al ras del suelo, ni se usa para proyectarlo.',
  'El método no da estimaciones diarias ni semanales: es el promedio de los últimos 60 días.',
];

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

function redondear(valor: number, decimales = 1): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * fRFA desde el NDVI por el cociente simple: SR = (1 + NDVI) / (1 − NDVI),
 * fRFA = (SR − 1,55) / (11,62 − 1,55), acotada entre 0 y 0,95. Un NDVI de 1 da
 * una SR infinita y queda en el tope.
 */
export function frfaDesdeNdvi(ndvi: number, parametros: ParametrosCrecimiento = PARAMETROS_CRECIMIENTO.valor as ParametrosCrecimiento): number {
  const sr = (1 + ndvi) / (1 - ndvi);
  const frfa = (sr - parametros.srMinimo) / (parametros.srMaximo - parametros.srMinimo);
  return Math.min(parametros.frfaMaxima, Math.max(0, frfa));
}

/**
 * NDVI de un día entre dos imágenes despejadas, por interpolación lineal
 * (Oyarzabal la considera aceptable). null si no hay una imagen anterior o
 * posterior: no se extrapola en ninguna de las dos direcciones.
 */
export function ndviInterpolado(observaciones: ObservacionNdvi[], dia: string): number | null {
  const antes = observaciones.filter((observacion) => observacion.fecha <= dia).at(-1);
  const despues = observaciones.find((observacion) => observacion.fecha >= dia);
  if (!antes || !despues) return null;
  if (antes.fecha === despues.fecha) return antes.ndvi;
  const total = diasEntreFechas(antes.fecha, despues.fecha);
  return antes.ndvi + ((despues.ndvi - antes.ndvi) * diasEntreFechas(antes.fecha, dia)) / total;
}

function ordenar(observaciones: ObservacionNdvi[]): ObservacionNdvi[] {
  return observaciones
    .filter((observacion) => Number.isFinite(observacion.ndvi))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * La ventana termina en la última imagen despejada, nunca después: no se
 * extrapola el NDVI hacia adelante. Se usa también para saber desde cuándo
 * hace falta la radiación guardada.
 */
export function ventanaCrecimiento(
  fechasDeImagenes: string[],
  parametros: ParametrosCrecimiento = PARAMETROS_CRECIMIENTO.valor as ParametrosCrecimiento,
): VentanaCrecimiento | null {
  const hasta = [...fechasDeImagenes].sort().at(-1);
  return hasta ? { desde: sumarDias(hasta, -(parametros.diasVentana - 1)), hasta } : null;
}

function vacio(ecuacion: Parametro<EcuacionPpna>, motivo: string | null, ventana: VentanaCrecimiento | null = null, imagenes = 0): CrecimientoEstimado {
  return {
    kgMsHaDia: null, ventana, ppnaGM2: null, rfaaMjM2: null, imagenesDespejadas: imagenes,
    ecuacion, parametros: PARAMETROS_CRECIMIENTO, motivo, avisos: [],
  };
}

/**
 * Tasa promedio de los últimos 60 días para una pastura, o el motivo por el que
 * no se puede calcular. Nunca completa un día faltante con un supuesto: sin
 * NDVI interpolable o sin radiación de algún día, no hay número.
 */
export function estimarCrecimiento(
  observaciones: ObservacionNdvi[],
  climaPorDia: Map<string, ClimaDelDia>,
  ecuacion: Parametro<EcuacionPpna>,
  nombrePastura: string,
): CrecimientoEstimado {
  const parametros = PARAMETROS_CRECIMIENTO.valor;
  if (!parametros) return vacio(ecuacion, 'Sin parámetros de la tasa de crecimiento con fuente verificada.');
  if (!ecuacion.valor) return vacio(ecuacion, `Sin ecuación con fuente para ${nombrePastura}: no se estima la tasa de crecimiento.`);

  const imagenes = ordenar(observaciones);
  const ventana = ventanaCrecimiento(imagenes.map((imagen) => imagen.fecha), parametros);
  if (!ventana) return vacio(ecuacion, 'Sin imágenes ópticas despejadas guardadas: no se puede estimar la tasa de crecimiento.');

  const enVentana = imagenes.filter((imagen) => imagen.fecha >= ventana.desde && imagen.fecha <= ventana.hasta);
  // La calibración es cada 60 días, pero con imágenes salteadas el NDVI interpolado
  // deja de representar el ciclo: la fuente pide una densidad mínima.
  const tramos = Math.ceil(parametros.diasVentana / 30);
  for (let tramo = 0; tramo < tramos; tramo += 1) {
    const inicio = sumarDias(ventana.desde, tramo * 30);
    const fin = sumarDias(inicio, 29);
    const cuantas = enVentana.filter((imagen) => imagen.fecha >= inicio && imagen.fecha <= fin).length;
    if (cuantas < parametros.imagenesPorCada30Dias) {
      return vacio(
        ecuacion,
        `Del ${fecha(inicio)} al ${fecha(fin)} hay ${cuantas} ${cuantas === 1 ? 'imagen' : 'imágenes'} despejadas y hacen falta ${parametros.imagenesPorCada30Dias} por cada 30 días: no se estima la tasa de crecimiento.`,
        ventana,
        enVentana.length,
      );
    }
  }

  let rfaa = 0;
  for (let dia = ventana.desde; dia <= ventana.hasta; dia = sumarDias(dia, 1)) {
    const ndvi = ndviInterpolado(imagenes, dia);
    if (ndvi === null) {
      return vacio(ecuacion, `No hay una imagen despejada del ${fecha(ventana.desde)} o anterior: el NDVI no se extrapola hacia atrás.`, ventana, enVentana.length);
    }
    const radiacion = climaPorDia.get(dia)?.radiacionMjM2 ?? null;
    if (!radiacion) {
      return vacio(ecuacion, `Falta la radiación del ${fecha(dia)}: sin ella no se estima la tasa de crecimiento. Actualizá el clima del lote.`, ventana, enVentana.length);
    }
    rfaa += frfaDesdeNdvi(ndvi, parametros) * parametros.fraccionRfaDeRadiacion * radiacion.valor;
  }

  const ppna = ecuacion.valor.pendiente * rfaa + ecuacion.valor.ordenada;
  // g/m² en la ventana → kg/ha/día: ×10 pasa g/m² a kg/ha, y se reparte en los días de la ventana.
  return {
    kgMsHaDia: redondear((ppna * 10) / parametros.diasVentana),
    ventana,
    ppnaGM2: redondear(ppna),
    rfaaMjM2: redondear(rfaa),
    imagenesDespejadas: enVentana.length,
    ecuacion,
    parametros: PARAMETROS_CRECIMIENTO,
    motivo: null,
    avisos: [...AVISOS_CRECIMIENTO],
  };
}
