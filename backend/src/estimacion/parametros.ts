/**
 * Parámetros de la estimación de forraje por eficiencia en el uso de la
 * radiación (lógica de Monteith, la misma del seguimiento forrajero de
 * LART-FAUBA):
 *
 *   crecimiento (kgMS/ha/día) = EUR × fRFA(NDVI) × 0,48 × radiación global × 10
 *
 * El NDVI no se convierte en biomasa en pie: sólo estima qué fracción de la luz
 * absorbe el canopeo. Por eso no hace falta una calibración NDVI→kg, que el
 * proyecto no tiene.
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

/** g de materia seca aérea por MJ de radiación fotosintéticamente activa absorbida. */
export type EurEstacional = Record<Estacion, number>;

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

export interface ParametrosPastura {
  nombre: string;
  eur: Parametro<EurEstacional>;
  reingreso: Parametro<CriterioReingreso>;
}

export interface ParametrosFrfa {
  /** fRFA = coeficiente × e^(exponente × NDVI), acotada a [0, maximo]. */
  coeficiente: number;
  exponente: number;
  maximo: number;
}

const FUENTE_FRFA: Fuente = {
  cita: 'Pellegrini, P.; Cossani, C. M.; Di Bella, C. M.; Piñeiro, G.; Sadras, V. O.; Oesterheld, M. (2020). Simple regression models to estimate light interception in wheat crops with Sentinel-2 and a handheld sensor. Crop Science 60(3): 1607-1616. Ecuación en Pellegrini, P. (2024), tesis doctoral FAUBA, Cuadro 2.5.',
  url: 'https://ri.agro.uba.ar/files/download/tesis/doctorado/2025pellegrinipedro.pdf',
  nota: 'Medida a campo en trigo del sudoeste pampeano con NDVI de Sentinel-2 a 10 m (R² 0,89; n 158; RMSD 0,09). Se aplica a pasturas como hicieron Tommasino et al. con alfalfa y festuca. El tope de 0,95 es la convención de Potter et al. (1993) que usa el seguimiento forrajero de Grigera et al. (2007).',
};

const FUENTE_EUR_ENSAYOS_COLONIA: Fuente = {
  cita: 'Tommasino, A.; Castro, M.; Baldassini, P.; Cuitiño, M. J.; Paruelo, J. M. (2026). Field data on aboveground net primary productivity, photosynthetically active radiation absorbed and the derived calculation of radiation use efficiency, from trials with Medicago sativa L and Lolium arundinacea (2020-2021). Zenodo.',
  url: 'https://zenodo.org/records/18874910',
  nota: 'Ensayos con cortes sucesivos en Colonia, Uruguay, 2020-2021. Valor por estación = suma de producción / suma de radiación absorbida de los ciclos de rebrote cuyo punto medio cae en esa estación (verano: dic-feb).',
};

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

export const FRFA_DESDE_NDVI: Parametro<ParametrosFrfa> = {
  valor: { coeficiente: 0.013, exponente: 4.48, maximo: 0.95 },
  fuente: FUENTE_FRFA,
  provisional: true,
};

export const FRACCION_RFA: Parametro<number> = {
  valor: 0.48,
  fuente: {
    cita: 'Monteith, J. L. (1972). Solar radiation and productivity in tropical ecosystems. Journal of Applied Ecology 9: 747-766.',
    url: null,
    nota: 'Mismo factor que usan Maidana (2021, FAUBA) y Tommasino et al. (2026) para pasar de radiación global a fotosintéticamente activa.',
  },
  provisional: false,
};

export const PARAMETROS_PASTURA: Record<TipoPastura, ParametrosPastura> = {
  alfalfa: {
    nombre: 'Alfalfa',
    eur: {
      valor: { verano: 0.53, otono: 0.82, invierno: 0.66, primavera: 0.92 },
      fuente: { ...FUENTE_EUR_ENSAYOS_COLONIA, nota: `${FUENTE_EUR_ENSAYOS_COLONIA.nota} Alfalfa: 20 ciclos, 15 parcelas por ciclo.` },
      provisional: true,
    },
    reingreso: {
      ...sinFuente<CriterioReingreso>(),
      fuente: {
        cita: 'Sin criterio en grados-día con fuente verificada.',
        url: null,
        nota: 'INTA Manfredi recomienda descansos de 35-42 días, pero en días corridos, no en tiempo térmico. El umbral de 500-600 grados-día que circula proviene de una guía privada y no se adoptó.',
      },
    },
  },
  festuca_alta: {
    nombre: 'Festuca alta',
    eur: {
      valor: { verano: 0.29, otono: 0.83, invierno: 0.59, primavera: 1.06 },
      fuente: { ...FUENTE_EUR_ENSAYOS_COLONIA, nota: `${FUENTE_EUR_ENSAYOS_COLONIA.nota} Festuca alta: 9 ciclos, 15 parcelas por ciclo; verano e invierno salen de sólo 2 ciclos largos cada uno.` },
      provisional: true,
    },
    reingreso: estadoFoliar(2.5, [180, 220], [450, 550]),
  },
  mezcla_alfalfa_gramineas: {
    nombre: 'Mezcla alfalfa con gramíneas',
    eur: {
      ...sinFuente<EurEstacional>(),
      fuente: {
        cita: 'Sin EUR con fuente verificada para la mezcla.',
        url: 'https://repositorio.inta.gob.ar/xmlui/handle/20.500.12123/11882',
        nota: 'La EUR de una mezcla depende de su composición. INTA Balcarce midió mezclas alfalfa-festuca, pero los valores no se pudieron verificar; no se promedian las especies puras.',
      },
    },
    reingreso: sinFuente(),
  },
  raigras_anual: { nombre: 'Raigrás anual', eur: sinFuente(), reingreso: estadoFoliar(3.8, [90, 120], [350, 390]) },
  raigras_perenne: { nombre: 'Raigrás perenne', eur: sinFuente(), reingreso: estadoFoliar(3, [100, 115], [300, 350]) },
  agropiro_alargado: { nombre: 'Agropiro alargado', eur: sinFuente(), reingreso: estadoFoliar(2.5, [180, 240], [450, 600]) },
  pasto_ovillo: { nombre: 'Pasto ovillo', eur: sinFuente(), reingreso: estadoFoliar(4, [105, 125], [420, 500]) },
  cebadilla_criolla: { nombre: 'Cebadilla criolla', eur: sinFuente(), reingreso: estadoFoliar(4, [75, 90], [300, 350]) },
  avena: { nombre: 'Avena (verdeo de invierno)', eur: sinFuente(), reingreso: estadoFoliar(3.8, [110, 150], [450, 500]) },
  pastizal_natural: {
    nombre: 'Pastizal natural',
    eur: {
      ...sinFuente<EurEstacional>(),
      fuente: {
        cita: 'Sin EUR comparable con la fRFA de Sentinel-2.',
        url: null,
        nota: 'Los valores publicados para pastizales del Río de la Plata (Grigera et al. 2007; Baeza et al. 2011) se calcularon con fRFA de MODIS y la fórmula de Potter; combinarlos con la ecuación de Sentinel-2 sesgaría el resultado.',
      },
    },
    reingreso: sinFuente(),
  },
};

/** Estaciones del hemisferio sur por mes calendario (1-12), igual que en la agregación de la EUR. */
export function estacionDelMes(mes: number): Estacion {
  if (mes === 12 || mes <= 2) return 'verano';
  if (mes <= 5) return 'otono';
  if (mes <= 8) return 'invierno';
  return 'primavera';
}
