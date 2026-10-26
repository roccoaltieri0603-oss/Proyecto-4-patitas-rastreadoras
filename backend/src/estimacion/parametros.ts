/**
 * Parámetros de la estimación de forraje: el criterio de reingreso por estado
 * foliar, la conversión de altura a kilos y el remanente objetivo.
 *
 * El crecimiento diario por eficiencia en el uso de la radiación (EUR × fRFA
 * del NDVI × radiación) se sacó el 25/10/2026, por decisión del equipo: la EUR
 * salía de un solo ensayo en Colonia (Uruguay) y la fRFA de una calibración en
 * trigo, y no cambiaba ni la etapa ni el orden de los lotes.
 *
 * Cada valor lleva su fuente. Lo que no tiene una fuente verificada queda en
 * null y el modelo responde "sin parámetros" para esa parte: no se completa con
 * un número supuesto ni se toma prestado de otra especie. La tabla para revisión
 * agronómica está en docs/ESTIMACION_FORRAJE.md.
 */

export interface Fuente {
  cita: string;
  url: string | null;
  nota?: string;
}

export interface Parametro<T> {
  valor: T | null;
  fuente: Fuente | null;
  /** Todo es provisional hasta contrastarlo con cortes a campo en los lotes propios. */
  provisional: boolean;
}

export const TIPOS_PASTURA = [
  'alfalfa',
  'festuca_alta',
  'mezcla_alfalfa_gramineas',
  'raigras_anual',
  'raigras_perenne',
  'agropiro_alargado',
  'pasto_ovillo',
  'cebadilla_criolla',
  'avena',
  'pastizal_natural',
] as const;

export type TipoPastura = (typeof TIPOS_PASTURA)[number];

export function esTipoPastura(valor: unknown): valor is TipoPastura {
  return typeof valor === 'string' && (TIPOS_PASTURA as readonly string[]).includes(valor);
}

export type Estacion = 'verano' | 'otono' | 'invierno' | 'primavera';

/**
 * Estado foliar óptimo: se vuelve a pastorear cuando el macollo llegó a las
 * hojas vivas que es capaz de mantener. Ese lapso es la vida media foliar, en
 * grados-día acumulados desde la salida de los animales. Los rangos se
 * conservan tal cual los publica la fuente; el motor los usa para dar una fecha
 * temprana y una tardía en vez de un único día con falsa precisión.
 */
export interface CriterioReingreso {
  hojasVivasPorMacollo: number;
  filocronoGradosDia: [number, number];
  vidaMediaFoliarGradosDia: [number, number];
  temperaturaBaseC: [number, number];
}

export type Instrumento = 'plato' | 'regla';
export const INSTRUMENTOS: readonly Instrumento[] = ['plato', 'regla'];

/** Validación independiente que publica la fuente, si la publica. */
export interface ValidacionPublicada {
  n: number;
  r2: number;
  /** Coeficiente de concordancia de Lin. */
  ccc: number;
  /** (media modelada − media observada) / observada, en %. Positivo: el modelo sobrestimaba. */
  sesgoPorcentaje: number;
}

export interface CoeficienteAltura {
  /** kg MS/ha por cm de altura, con la regresión forzada al origen. */
  kgPorCm: number;
  /** Intervalo de confianza del 95 % del coeficiente que publica la fuente. */
  intervalo95: [number, number];
  n: number;
  r2: number;
  validacion: ValidacionPublicada | null;
  /** La estación tiene n < 20 o no tiene datos: se usa el coeficiente anual de la misma fuente. */
  usaAnual: boolean;
  /** La fuente no midió en esta estación: se calcula igual, con aviso y confianza baja. */
  fueraDeEstacion: boolean;
}

/**
 * Altura → kg MS/ha para una pastura y un instrumento. La conversión es
 * kg MS/ha = coeficiente de la estación × altura (cm), como la publica la fuente.
 */
export interface ConversionAltura {
  porEstacion: Record<Estacion, CoeficienteAltura>;
  /** Rango de alturas con que se calibró. Fuera de él se calcula igual, con aviso y confianza baja. */
  rangoValidoCm: [number, number];
  zona: string;
  instrumento: string;
}

export interface ParametrosPastura {
  nombre: string;
  reingreso: Parametro<CriterioReingreso>;
  alturaAKg: Record<Instrumento, Parametro<ConversionAltura>>;
  /** Altura a la que hay que dejar el pasto al sacar los animales, en cm del instrumento. */
  remanenteObjetivoCm: Record<Instrumento, Parametro<number>>;
}

const FUENTE_ESTADO_FOLIAR: Fuente = {
  cita: 'Berone, G. D.; Recavarren, P. M.; Marino, M. A. (2021). ¿Cada cuánto damos la vuelta en pastoreos de Festuca? Visión Rural 27(137): 24-27. Unidad Integrada Balcarce INTA-FCA UNMdP. Tabla 1.',
  url: 'https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/9704',
  nota: 'Valores para el sudeste bonaerense. Temperatura base de 2-4 °C para gramíneas templadas perennes.',
};

function sinFuente<T>(): Parametro<T> {
  return { valor: null, fuente: null, provisional: true };
}

function estadoFoliar(hojas: number, filocrono: [number, number], vidaMedia: [number, number]): Parametro<CriterioReingreso> {
  return {
    valor: { hojasVivasPorMacollo: hojas, filocronoGradosDia: filocrono, vidaMediaFoliarGradosDia: vidaMedia, temperaturaBaseC: [2, 4] },
    fuente: FUENTE_ESTADO_FOLIAR,
    provisional: true,
  };
}

const FUENTE_PLATO_ENTRE_RIOS: Fuente = {
  cita: 'Ojeda, J. J.; Quinodoz, J. E.; Lezana, L. C. (2021). Estimación de disponibilidad forrajera de pasturas base alfalfa y verdeos invernales en el sudoeste de Entre Ríos. RIA 47(1): 26-45, INTA. Tabla 2 (calibración) y Tabla 3 (validación).',
  url: 'https://www.redalyc.org/journal/864/86468100002/86468100002.pdf',
  nota: '17 sitios del sudoeste de Entre Ríos (31,8-33,1 °S), 1999-2005, corte al ras en 0,2 m². Plato Filip\'s Manual Folding Plate Meter (Jenquip), relación peso/área de 3,23 kg/m²; su eje marca cada 0,5 cm, así que la lectura se divide por 2 para tener cm. Con otro plato, más pesado o liviano, la conversión es orientativa. La ordenada al origen no fue significativa en ningún caso y se usa el modelo forzado al origen.',
};

function coeficiente(kgPorCm: number, intervalo95: [number, number], n: number, r2: number, validacion: ValidacionPublicada | null, extra: Partial<CoeficienteAltura> = {}): CoeficienteAltura {
  return { kgPorCm, intervalo95, n, r2, validacion, usaAnual: false, fueraDeEstacion: false, ...extra };
}

/**
 * Pasturas perennes base alfalfa (consociadas). Tabla 2: n de calibración, a, LI-LS, R².
 * Tabla 3: validación con datos independientes; el sesgo es (media modelada − observada) / observada.
 */
const PLATO_BASE_ALFALFA: Parametro<ConversionAltura> = {
  valor: {
    porEstacion: {
      otono: coeficiente(153.0, [143.8, 162.2], 63, 0.68, { n: 39, r2: 0.78, ccc: 0.88, sesgoPorcentaje: -9.8 }),
      invierno: coeficiente(179.6, [170.0, 189.1], 79, 0.67, { n: 38, r2: 0.37, ccc: 0.61, sesgoPorcentaje: 17.1 }),
      primavera: coeficiente(195.6, [184.5, 206.7], 45, 0.69, { n: 55, r2: 0.64, ccc: 0.72, sesgoPorcentaje: 41.0 }),
      verano: coeficiente(194.2, [186.7, 201.6], 40, 0.74, { n: 212, r2: 0.65, ccc: 0.76, sesgoPorcentaje: 14.0 }),
    },
    rangoValidoCm: [3, 15.5],
    zona: 'Sudoeste de Entre Ríos',
    instrumento: 'Plato Filip\'s (Jenquip), 3,23 kg/m²',
  },
  fuente: {
    ...FUENTE_PLATO_ENTRE_RIOS,
    nota: `${FUENTE_PLATO_ENTRE_RIOS.nota} Pasturas perennes base alfalfa, consociadas con gramíneas: se aplica a la mezcla y a la alfalfa con esa aclaración. Rango calibrado: 3-15,5 cm de altura comprimida (los autores sugieren 5-30 cm, pero no lo probaron). Anual: 179,7 kg/cm (n 227, R² 0,68).`,
  },
  provisional: true,
};

/**
 * Verdeos invernales (avena y raigrás anual). Primavera tiene n = 6 y no fue
 * significativa: se usa el anual. En verano no hay datos: anual, con aviso.
 */
const ANUAL_VERDEOS = coeficiente(151.9, [144.1, 159.6], 75, 0.78, { n: 72, r2: 0.51, ccc: 0.68, sesgoPorcentaje: -27.8 });
const PLATO_VERDEOS: Parametro<ConversionAltura> = {
  valor: {
    porEstacion: {
      otono: coeficiente(149.5, [134.7, 164.4], 24, 0.83, null),
      invierno: coeficiente(154.2, [144.5, 163.9], 45, 0.71, null),
      primavera: { ...ANUAL_VERDEOS, usaAnual: true },
      verano: { ...ANUAL_VERDEOS, usaAnual: true, fueraDeEstacion: true },
    },
    rangoValidoCm: [3, 24],
    zona: 'Sudoeste de Entre Ríos',
    instrumento: 'Plato Filip\'s (Jenquip), 3,23 kg/m²',
  },
  fuente: {
    ...FUENTE_PLATO_ENTRE_RIOS,
    nota: `${FUENTE_PLATO_ENTRE_RIOS.nota} Verdeos invernales de avena y raigrás anual. Primavera con n = 6, no significativa: se usa el anual (151,9 kg/cm, n 75, R² 0,78). Sin mediciones de verano. La validación sólo se publicó anual: subestimó 27,8 %. El texto del artículo dice 149,0 para otoño; se usa el 149,5 de la Tabla 2. Rango calibrado: 3-24 cm.`,
  },
  provisional: true,
};

function sinConversion(cita: string, nota?: string): Parametro<ConversionAltura> {
  return { valor: null, fuente: { cita, url: null, ...(nota ? { nota } : {}) }, provisional: true };
}

const BALCARCE_SIN_ECUACIONES = sinConversion(
  'Sin ecuación publicada: pendiente de INTA Balcarce.',
  'Laplacette, Berone, Utsumi, Cicore, Marino, Errecart e Insua calibraron plato y regla en festuca alta (n 69) y agropiro alargado (n 30) en la EEA Balcarce, primavera 2021, pero no publicaron las ecuaciones. Informan R² del plato contra el corte de 0,88 (festuca) y 0,86 (agropiro), y de la regla 0,74 y 0,77; RMSE promedio de ambas especies de 615 kg MS/ha con plato y 687 con regla. Resumen: https://www.engormix.com/lecheria/manejo-pasturas/monitoreo-pasturas-calibracion-distintos_a52047/',
);

/**
 * Ninguna fuente verificada da una altura de remanente objetivo por especie e
 * instrumento. Sin ella no se calcula cuánto pasto se puede comer.
 */
const SIN_REMANENTE: Parametro<number> = {
  valor: null,
  fuente: {
    cita: 'Sin altura de remanente objetivo con fuente verificada.',
    url: null,
    nota: 'Agnusdei (2013), Archivos Latinoamericanos de Producción Animal 21(1): 63-78, explica por qué dejar láminas al salir pero no da alturas por especie. La ficha 48 de INIA Uruguay (Manejo de Praderas), que se cita con 10 cm para festuca, no se pudo abrir para verificarla. Las alturas de salida medidas por INTA Olavarría son de mezclas y no son recomendaciones. No se adopta un valor sin leerlo en la fuente.',
  },
  provisional: true,
};
const REMANENTE_SIN_FUENTE: Record<Instrumento, Parametro<number>> = { plato: SIN_REMANENTE, regla: SIN_REMANENTE };

const SIN_REGLA = sinConversion('Sin calibración con regla para esta pastura.', 'La medición con regla se guarda, pero no se convierte a kilos: no se toma prestada la de otra especie ni la del plato.');

const PARAMETROS_POR_PASTURA: Record<TipoPastura, Omit<ParametrosPastura, 'remanenteObjetivoCm'>> = {
  alfalfa: {
    nombre: 'Alfalfa',
    reingreso: {
      ...sinFuente<CriterioReingreso>(),
      fuente: {
        cita: 'Sin criterio en grados-día con fuente verificada.',
        url: null,
        nota: 'INTA Manfredi recomienda descansos de 35-42 días, pero en días corridos, no en tiempo térmico. El umbral de 500-600 grados-día que circula proviene de una guía privada y no se adoptó.',
      },
    },
    alturaAKg: { plato: PLATO_BASE_ALFALFA, regla: SIN_REGLA },
  },
  festuca_alta: {
    nombre: 'Festuca alta',
    reingreso: estadoFoliar(2.5, [180, 220], [450, 550]),
    alturaAKg: { plato: BALCARCE_SIN_ECUACIONES, regla: BALCARCE_SIN_ECUACIONES },
  },
  mezcla_alfalfa_gramineas: {
    nombre: 'Mezcla alfalfa con gramíneas',
    reingreso: sinFuente(),
    alturaAKg: { plato: PLATO_BASE_ALFALFA, regla: SIN_REGLA },
  },
  raigras_anual: { nombre: 'Raigrás anual', reingreso: estadoFoliar(3.8, [90, 120], [350, 390]), alturaAKg: { plato: PLATO_VERDEOS, regla: SIN_REGLA } },
  raigras_perenne: { nombre: 'Raigrás perenne', reingreso: estadoFoliar(3, [100, 115], [300, 350]), alturaAKg: { plato: sinConversion('Sin calibración con plato para raigrás perenne con fuente verificada.'), regla: SIN_REGLA } },
  agropiro_alargado: { nombre: 'Agropiro alargado', reingreso: estadoFoliar(2.5, [180, 240], [450, 600]), alturaAKg: { plato: BALCARCE_SIN_ECUACIONES, regla: BALCARCE_SIN_ECUACIONES } },
  pasto_ovillo: { nombre: 'Pasto ovillo', reingreso: estadoFoliar(4, [105, 125], [420, 500]), alturaAKg: { plato: sinConversion('Sin calibración con plato para pasto ovillo con fuente verificada.'), regla: SIN_REGLA } },
  cebadilla_criolla: { nombre: 'Cebadilla criolla', reingreso: estadoFoliar(4, [75, 90], [300, 350]), alturaAKg: { plato: sinConversion('Sin calibración con plato para cebadilla criolla con fuente verificada.'), regla: SIN_REGLA } },
  avena: { nombre: 'Avena (verdeo de invierno)', reingreso: estadoFoliar(3.8, [110, 150], [450, 500]), alturaAKg: { plato: PLATO_VERDEOS, regla: SIN_REGLA } },
  pastizal_natural: {
    nombre: 'Pastizal natural',
    reingreso: sinFuente(),
    alturaAKg: { plato: sinConversion('Sin calibración con plato para pastizal natural con fuente verificada.'), regla: SIN_REGLA },
  },
};

/** El remanente objetivo de cada pastura se carga acá cuando aparezca una fuente verificada; hoy no hay ninguna. */
export const PARAMETROS_PASTURA: Record<TipoPastura, ParametrosPastura> = Object.fromEntries(
  TIPOS_PASTURA.map((tipo) => [tipo, { ...PARAMETROS_POR_PASTURA[tipo], remanenteObjetivoCm: REMANENTE_SIN_FUENTE }]),
) as Record<TipoPastura, ParametrosPastura>;

/** kg MS/ha de una altura promedio en cm, con el coeficiente de la estación y su intervalo del 95 %. */
export function kgDesdeAltura(conversion: ConversionAltura, alturaCm: number, estacion: Estacion): { kg: number; rango: [number, number]; coeficiente: CoeficienteAltura } {
  const coeficiente = conversion.porEstacion[estacion];
  return {
    kg: coeficiente.kgPorCm * alturaCm,
    rango: [coeficiente.intervalo95[0] * alturaCm, coeficiente.intervalo95[1] * alturaCm],
    coeficiente,
  };
}

/** Estaciones del hemisferio sur por mes calendario (1-12), las de la conversión de altura a kilos. */
export function estacionDelMes(mes: number): Estacion {
  if (mes === 12 || mes <= 2) return 'verano';
  if (mes <= 5) return 'otono';
  if (mes <= 8) return 'invierno';
  return 'primavera';
}
