import { estacionDelMes, kgDesdeAltura, type ConversionAltura, type Estacion, type Instrumento, type Parametro, type ValidacionPublicada } from './parametros.js';

/**
 * Pasto en pie a partir de las mediciones de altura que carga el usuario. Se
 * conoce sólo el día de la medición: sin un crecimiento diario con fuente
 * verificada no se proyecta a los días siguientes. Derivado: no se persiste.
 */

export type Confianza = 'alta' | 'media' | 'baja';
export type MomentoMedicion = 'salida' | 'antes-de-entrar' | 'recorrida';

/** Debajo de esto, el promedio de una recorrida puede no representar el lote. */
export const LECTURAS_MINIMAS = 20;

export interface MedicionAltura {
  id?: string;
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  alturaPromedioCm: number;
  cantidadLecturas: number;
}

export interface MedicionConvertida {
  id: string | null;
  fecha: string;
  momento: MomentoMedicion;
  instrumento: Instrumento;
  alturaPromedioCm: number;
  cantidadLecturas: number;
  /** null si no hay conversión con fuente para esta pastura e instrumento. */
  kgMsHa: number | null;
  /** Con el intervalo del 95 % del coeficiente de la fuente. */
  rango: [number, number] | null;
  coeficienteKgPorCm: number | null;
  estacion: Estacion;
  validacion: ValidacionPublicada | null;
  confianza: Confianza | null;
  avisos: string[];
  motivo: string | null;
}

const NOMBRE_ESTACION: Record<Estacion, string> = { verano: 'verano', otono: 'otoño', invierno: 'invierno', primavera: 'primavera' };

function numero(valor: number): string {
  return valor.toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

export function convertirMedicion(medicion: MedicionAltura, conversion: Parametro<ConversionAltura>): MedicionConvertida {
  const estacion = estacionDelMes(Number(medicion.fecha.slice(5, 7)));
  const base = {
    id: medicion.id ?? null, fecha: medicion.fecha, momento: medicion.momento, instrumento: medicion.instrumento,
    alturaPromedioCm: medicion.alturaPromedioCm, cantidadLecturas: medicion.cantidadLecturas, estacion,
  };
  if (!conversion.valor) {
    return {
      ...base, kgMsHa: null, rango: null, coeficienteKgPorCm: null, validacion: null, confianza: null, avisos: [],
      motivo: `No se convierte a kilos: ${conversion.fuente?.cita ?? 'sin conversión con fuente para este instrumento.'}`,
    };
  }
  const { kg, rango, coeficiente } = kgDesdeAltura(conversion.valor, medicion.alturaPromedioCm, estacion);
  const [minimo, maximo] = conversion.valor.rangoValidoCm;
  const avisos: string[] = [];
  const pocasLecturas = medicion.cantidadLecturas < LECTURAS_MINIMAS;
  const fueraDeRango = medicion.alturaPromedioCm < minimo || medicion.alturaPromedioCm > maximo;
  if (pocasLecturas) avisos.push(`Tiene ${medicion.cantidadLecturas} lecturas: con menos de ${LECTURAS_MINIMAS}, el promedio puede no representar el lote.`);
  if (fueraDeRango) avisos.push(`${numero(medicion.alturaPromedioCm)} cm está fuera del rango con que se calibró la conversión (${numero(minimo)} a ${numero(maximo)} cm).`);
  if (coeficiente.fueraDeEstacion) avisos.push(`La fuente no midió en ${NOMBRE_ESTACION[estacion]}: se usa su coeficiente anual.`);
  else if (coeficiente.usaAnual) avisos.push(`En ${NOMBRE_ESTACION[estacion]} la fuente tiene pocos datos: se usa su coeficiente anual.`);
  return {
    ...base,
    kgMsHa: Math.round(kg),
    rango: [Math.round(rango[0]), Math.round(rango[1])],
    coeficienteKgPorCm: coeficiente.kgPorCm,
    validacion: coeficiente.validacion,
    confianza: pocasLecturas || fueraDeRango || coeficiente.fueraDeEstacion ? 'baja' : 'alta',
    avisos,
    motivo: null,
  };
}

export interface BiomasaDelDia {
  biomasaEnPieKgMsHa: number | null;
  biomasaRango: [number, number] | null;
  /** Siempre lo medido ese día: no hay pasto en pie estimado. */
  biomasaOrigen: 'medido' | null;
  fechaMedicion: string | null;
  biomasaConfianza: Confianza | null;
  motivoBiomasa: string | null;
}

/** De cada día, la medición convertible con más lecturas: es la que mejor representa el lote. */
function medicionDelDia(mediciones: MedicionConvertida[], fecha: string): MedicionConvertida | null {
  return mediciones
    .filter((medicion) => medicion.fecha === fecha && medicion.kgMsHa !== null)
    .sort((a, b) => b.cantidadLecturas - a.cantidadLecturas)[0] ?? null;
}

const SIN_BIOMASA = (motivo: string): BiomasaDelDia => ({
  biomasaEnPieKgMsHa: null, biomasaRango: null, biomasaOrigen: null, fechaMedicion: null, biomasaConfianza: null, motivoBiomasa: motivo,
});

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

/** Pasto en pie de cada fecha: lo medido ese día, o por qué no se sabe. */
export function biomasaPorDia(fechas: string[], mediciones: MedicionConvertida[]): Map<string, BiomasaDelDia> {
  const porFecha = new Map<string, BiomasaDelDia>();
  let anterior: MedicionConvertida | null = null;
  for (const fecha of fechas) {
    for (const medicion of mediciones) if (medicion.kgMsHa !== null && medicion.fecha < fecha) anterior = medicion;
    const medida = medicionDelDia(mediciones, fecha);
    if (medida) {
      porFecha.set(fecha, {
        biomasaEnPieKgMsHa: medida.kgMsHa, biomasaRango: medida.rango, biomasaOrigen: 'medido',
        fechaMedicion: medida.fecha, biomasaConfianza: medida.confianza, motivoBiomasa: null,
      });
      continue;
    }
    porFecha.set(fecha, SIN_BIOMASA(anterior
      ? `El pasto en pie se conoce sólo el día que se mide; la última medición es del ${fechaCorta(anterior.fecha)}.`
      : 'Sin una medición de altura que se pueda pasar a kilos.'));
  }
  return porFecha;
}

export interface ConsumibleDelDia {
  /** Pasto en pie por encima del remanente objetivo; nunca negativo. */
  consumibleKgMsHa: number | null;
  motivoConsumible: string | null;
}

/**
 * Lo que se puede comer: el pasto en pie menos lo que hay que dejar, con la
 * altura de remanente objetivo pasada a kilos con el mismo instrumento y
 * coeficiente de la medición. Sin remanente con fuente, no se calcula.
 */
export function consumibleDelDia(
  fecha: string,
  biomasa: BiomasaDelDia,
  mediciones: MedicionConvertida[],
  remanente: Record<Instrumento, Parametro<number>>,
  conversion: Record<Instrumento, Parametro<ConversionAltura>>,
  nombrePastura: string,
): ConsumibleDelDia {
  if (biomasa.biomasaEnPieKgMsHa === null) return { consumibleKgMsHa: null, motivoConsumible: 'Sin pasto en pie: hace falta una medición de altura.' };
  const medicion = mediciones.find((item) => item.fecha === biomasa.fechaMedicion && item.kgMsHa !== null);
  const objetivo = medicion ? remanente[medicion.instrumento].valor : null;
  const coeficientes = medicion ? conversion[medicion.instrumento].valor : null;
  if (!medicion || objetivo === null || !coeficientes) {
    return { consumibleKgMsHa: null, motivoConsumible: `Sin altura de remanente objetivo con fuente para ${nombrePastura}${medicion ? ` con ${medicion.instrumento}` : ''}: no se calcula cuánto se puede comer.` };
  }
  const { kg } = kgDesdeAltura(coeficientes, objetivo, estacionDelMes(Number(fecha.slice(5, 7))));
  return { consumibleKgMsHa: Math.max(0, Math.round(biomasa.biomasaEnPieKgMsHa - kg)), motivoConsumible: null };
}
