import * as turf from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { estaContenido, esPolygonFeature, seSuperpone, type PolygonFeature } from '../geometria.js';

/**
 * Depuración geométrica de lo que devuelve el modelo.
 *
 * El modelo mira una imagen rectangular y no sabe nada del establecimiento ni
 * de los lotes que ya existen: propone polígonos que se salen del límite, que
 * pisan lotes cargados y que se pisan entre sí. Acá se recortan contra la
 * realidad guardada en PostgreSQL, de modo que toda sugerencia que llega al
 * usuario sea una que `POST /api/lotes` aceptaría tal cual.
 *
 * Nada de esto se persiste: es una propuesta que vive en la respuesta HTTP.
 */

/** Piso de superficie: por debajo son astillas del recorte, no lotes. */
export const HECTAREAS_MINIMAS = 0.25;
/**
 * Tope de sugerencias. Estaba en 60 y topaba: sobre el campo de referencia el
 * modelo devolvía 63 detecciones y el tope se comía las tres últimas. Con las
 * cinco escalas devuelve 72 y con confianza baja hasta 90, así que el tope pasa
 * a ser una red contra una respuesta absurda, no un recorte en uso normal.
 */
export const MAXIMO_SUGERENCIAS = 150;

const M2_POR_HECTAREA = 10_000;

/**
 * Cierre de huecos: hasta qué ancho una tira sin asignar se considera artefacto
 * del recorte y no superficie legítimamente vacía. Es el único parámetro
 * físico del criterio y el que hay que mover si el campo tiene caminos
 * angostos: un camino vecinal de la pampa mide 20-30 m, y el desajuste de las
 * máscaras del modelo va de 4 a 15 m según la escala (2 a 8 m/píxel).
 */
export const FRANJA_ANCHO_MAXIMO_METROS = 12;
/** Techo de superficie: por fina que parezca, una franja no es media hectárea de campo. */
export const FRANJA_HECTAREAS_MAXIMAS = 2.5;
/** Fracción del contorno de la franja que tiene que ir pegada a lotes vecinos. */
export const FRANJA_ENCIERRO_MINIMO = 0.6;
/** Fracción del contorno que tiene que compartir el lote que se la queda. */
export const FRANJA_ASIGNACION_MINIMA = 0.2;

export interface SugerenciaLote {
  id: string;
  polygon: PolygonFeature;
  hectareas: number;
  confianza: number | null;
  /**
   * `ia`: la detectó el modelo. `hueco`: es superficie que quedó sin cubrir y
   * se ofrece como candidata, sin que nadie afirme que ahí hay un lote.
   */
  origen: 'ia' | 'hueco';
}

/** Umbrales del cierre de huecos. `false` en `OpcionesDepuracion` lo apaga. */
export interface OpcionesFranjas {
  anchoMaximoMetros?: number;
  hectareasMaximas?: number;
  encierroMinimo?: number;
  asignacionMinima?: number;
}

export interface OpcionesDepuracion {
  establecimiento: PolygonFeature;
  lotesExistentes: PolygonFeature[];
  hectareasMinimas?: number;
  maximo?: number;
  franjas?: OpcionesFranjas | false;
  huecos?: OpcionesHuecos | false;
}

export interface ResultadoDepuracion {
  sugerencias: SugerenciaLote[];
  descartadas: number;
  /** Franjas de recorte repartidas entre lotes vecinos para cerrar huecos. */
  franjasAsignadas: number;
  /** Huecos sin cubrir ofrecidos como candidatos, incluidos en `sugerencias`. */
  huecos: number;
}

type Recorte = Feature<Polygon | MultiPolygon>;

function confianzaDe(polygon: PolygonFeature): number | null {
  const valor = (polygon.properties as { confianza?: unknown } | null)?.confianza;
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function intersectar(a: Recorte, b: PolygonFeature): Recorte | null {
  try { return turf.intersect(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

function restar(a: Recorte, b: Recorte): Recorte | null {
  try { return turf.difference(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

function intersectarRecortes(a: Recorte, b: Recorte): Recorte | null {
  try { return turf.intersect(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

function unir(a: PolygonFeature, b: PolygonFeature): Recorte | null {
  try { return turf.union(turf.featureCollection([a, b])) as Recorte | null; }
  catch { return null; }
}

/** Un MultiPolygon del recorte son varios lotes separados, no uno con partes. */
function separarEnPoligonos(recorte: Recorte): PolygonFeature[] {
  if (recorte.geometry.type === 'Polygon') {
    return [turf.feature(recorte.geometry) as PolygonFeature];
  }
  return recorte.geometry.coordinates.map(
    (coordenadas) => turf.polygon(coordenadas) as PolygonFeature,
  );
}

/* ── Cierre de las franjas que deja el recorte ──────────────────────────────
 *
 * Cada máscara sale independiente del modelo y suele quedarse unos píxeles
 * adentro del alambrado real, así que entre dos lotes contiguos queda una tira
 * de nadie. Sin cerrarlas, la propuesta no tesela el campo y el usuario tiene
 * que coser a mano.
 *
 * Lo que NO se rellena: caminos, canales, cascos, lagunas y potreros que el
 * modelo no detectó. Son superficie legítimamente sin lote, y un lote que se
 * come la laguna es peor que el hueco.
 *
 * El criterio: una franja de recorte es el área sin asignar que está a menos de
 * `anchoMaximoMetros` de DOS lotes distintos a la vez. Se construye como la
 * intersección de las bandas de ambos contornos, así que un hueco más ancho que
 * ese umbral no genera candidata pegada a ningún lote y queda intacto. El ancho
 * es el único parámetro físico y es configurable, porque separar una franja de
 * un camino angosto es una cuestión de escala, no de forma: un camino y una
 * franja tienen la misma geometría, sólo cambia cuánto miden.
 *
 * A propósito no se usa `turf.buffer` sobre los lotes: dilatarlos cierra los
 * huecos pero redondea las esquinas y devuelve globos en vez de los rectángulos
 * que son. Acá las bandas son sólo un cortador para trocear el sobrante —el
 * área no cubierta de un campo es UNA sola pieza conectada, caminos y franjas
 * todo junto—, nunca la geometría que se ofrece: lo que se suma al lote es
 * siempre sobrante real, con sus bordes rectos.
 */

type Punto = [number, number];
interface Segmento { a: Punto; b: Punto; largo: number }

/** Dos bordes se consideran pegados si están a menos de esto (metros). */
const TOLERANCIA_BORDE_METROS = 0.5;
/** Margen para comparar cajas: bordes compartidos dan cajas que se tocan justo. */
const MARGEN_CAJA_GRADOS = 1e-7;
/** Astillas numéricas del recorte: no son franjas. */
const AREA_MINIMA_FRANJA_M2 = 1;

/**
 * Plano local en metros centrado en el establecimiento. A escala de un campo el
 * error de la equirectangular es de centímetros, y permite medir anchos y
 * bordes compartidos sin trigonometría punto por punto.
 */
function planoLocal(referencia: PolygonFeature) {
  const [lng0, lat0] = turf.centroid(referencia).geometry.coordinates;
  const metrosPorGradoLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const metrosPorGradoLat = 110_574;
  return {
    aMetros: ([lng, lat]: number[]): Punto => [(lng - lng0) * metrosPorGradoLng, (lat - lat0) * metrosPorGradoLat],
    aGrados: ([x, y]: Punto): number[] => [lng0 + x / metrosPorGradoLng, lat0 + y / metrosPorGradoLat],
  };
}

type Plano = ReturnType<typeof planoLocal>;

function segmentosDe(polygon: PolygonFeature, plano: Plano): Segmento[] {
  const salida: Segmento[] = [];
  for (const anillo of polygon.geometry.coordinates) {
    for (let i = 0; i < anillo.length - 1; i += 1) {
      const a = plano.aMetros(anillo[i]);
      const b = plano.aMetros(anillo[i + 1]);
      const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (largo > 0) salida.push({ a, b, largo });
    }
  }
  return salida;
}

function distanciaAlSegmento(p: Punto, { a, b, largo }: Segmento): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const proyeccion = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (largo * largo);
  const t = Math.max(0, Math.min(1, proyeccion));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Metros del contorno de la franja que van pegados a alguno de esos bordes. */
function bordeCompartido(franja: Segmento[], vecinos: Segmento[]): number {
  let total = 0;
  for (const segmento of franja) {
    const medio: Punto = [(segmento.a[0] + segmento.b[0]) / 2, (segmento.a[1] + segmento.b[1]) / 2];
    if (vecinos.some((otro) => distanciaAlSegmento(medio, otro) <= TOLERANCIA_BORDE_METROS)) {
      total += segmento.largo;
    }
  }
  return total;
}

function cajasSeTocan(a: number[], b: number[]): boolean {
  return !(a[0] - MARGEN_CAJA_GRADOS > b[2] || b[0] - MARGEN_CAJA_GRADOS > a[2]
    || a[1] - MARGEN_CAJA_GRADOS > b[3] || b[1] - MARGEN_CAJA_GRADOS > a[3]);
}

/**
 * Banda de `ancho` metros a cada lado del contorno, con esquinas rectas: un
 * rectángulo por segmento, estirado `ancho` metros más allá de cada punta. Ese
 * estirón es el que tapa la cuña que dos rectángulos consecutivos dejarían en
 * una esquina: se solapan alrededor del vértice sin necesidad de una pieza
 * aparte, que costaba el triple de tiempo. Rectángulos y no círculos,
 * justamente para no reintroducir el redondeo del buffer.
 */
function bandaDelContorno(polygon: PolygonFeature, plano: Plano, ancho: number): Recorte | null {
  const piezas: PolygonFeature[] = [];
  // El contorno se simplifica antes de armar la banda: un lote traído del
  // modelo puede tener cien vértices y cada uno cuesta un rectángulo más en la
  // unión. La tolerancia va muy por debajo del ancho de la banda, y de todas
  // formas esto es un cortador —nunca la geometría que se ofrece—, así que
  // perder un detalle de pocos metros no cambia ninguna decisión.
  const tolerancia = (ancho / 4) / 111_320;
  let contorno = polygon;
  try {
    const simplificado = turf.simplify(polygon, { tolerance: tolerancia, highQuality: false });
    if (esPolygonFeature(simplificado)) contorno = simplificado;
  } catch { /* con el contorno original también anda, sólo más lento */ }
  for (const { a, b, largo } of segmentosDe(contorno, plano)) {
    const ux = ((b[0] - a[0]) / largo) * ancho;
    const uy = ((b[1] - a[1]) / largo) * ancho;
    const desde: Punto = [a[0] - ux, a[1] - uy];
    const hasta: Punto = [b[0] + ux, b[1] + uy];
    piezas.push(turf.polygon([[
      plano.aGrados([desde[0] - uy, desde[1] + ux]),
      plano.aGrados([hasta[0] - uy, hasta[1] + ux]),
      plano.aGrados([hasta[0] + uy, hasta[1] - ux]),
      plano.aGrados([desde[0] + uy, desde[1] - ux]),
      plano.aGrados([desde[0] - uy, desde[1] + ux]),
    ]]) as PolygonFeature);
  }
  if (piezas.length === 0) return null;
  try { return turf.union(turf.featureCollection(piezas)) as Recorte | null; }
  catch { return null; }
}

/** Las bandas de todos los lotes, recortadas al establecimiento, con sus cajas. */
function bandasDeContornos(
  lotes: { polygon: PolygonFeature }[],
  plano: Plano,
  ancho: number,
  establecimiento: PolygonFeature,
): { bandas: (Recorte | null)[]; cajas: (number[] | null)[] } {
  const bandas = lotes.map((lote) => {
    const banda = bandaDelContorno(lote.polygon, plano, ancho);
    return banda ? intersectarRecortes(banda, establecimiento) : null;
  });
  return { bandas, cajas: bandas.map((banda) => (banda ? turf.bbox(banda) : null)) };
}

interface Vecino {
  polygon: PolygonFeature;
  caja: number[];
  segmentos: Segmento[];
  /** null = lote ya guardado: puede limitar una franja, pero no se lo agranda. */
  sugerencia: SugerenciaLote | null;
}

function nuevoVecino(polygon: PolygonFeature, plano: Plano, sugerencia: SugerenciaLote | null): Vecino {
  return { polygon, caja: turf.bbox(polygon), segmentos: segmentosDe(polygon, plano), sugerencia };
}

/** Reparte entre los lotes vecinos las franjas finas que dejó el recorte. */
function cerrarFranjas(aceptadas: SugerenciaLote[], opciones: OpcionesDepuracion): number {
  if (opciones.franjas === false || aceptadas.length < 2) return 0;
  const ajustes = opciones.franjas ?? {};
  const ancho = ajustes.anchoMaximoMetros ?? FRANJA_ANCHO_MAXIMO_METROS;
  const maximoM2 = (ajustes.hectareasMaximas ?? FRANJA_HECTAREAS_MAXIMAS) * M2_POR_HECTAREA;
  const encierroMinimo = ajustes.encierroMinimo ?? FRANJA_ENCIERRO_MINIMO;
  const asignacionMinima = ajustes.asignacionMinima ?? FRANJA_ASIGNACION_MINIMA;
  if (!(ancho > 0)) return 0;

  const { establecimiento } = opciones;
  const plano = planoLocal(establecimiento);
  const vecinos: Vecino[] = [
    ...opciones.lotesExistentes.map((polygon) => nuevoVecino(polygon, plano, null)),
    ...aceptadas.map((sugerencia) => nuevoVecino(sugerencia.polygon, plano, sugerencia)),
  ];

  const { bandas, cajas: cajasBanda } = bandasDeContornos(aceptadas, plano, ancho, establecimiento);

  let asignadas = 0;

  for (let i = 0; i < aceptadas.length; i += 1) {
    for (let j = i + 1; j < aceptadas.length; j += 1) {
      const bandaA = bandas[i];
      const bandaB = bandas[j];
      const cajaA = cajasBanda[i];
      const cajaB = cajasBanda[j];
      if (!bandaA || !bandaB || !cajaA || !cajaB || !cajasSeTocan(cajaA, cajaB)) continue;

      // Lo que está a menos de `ancho` de los dos lotes a la vez y todavía no
      // es de nadie. Se resta acá y no sobre cada banda entera porque la
      // intersección es chica: la misma cuenta cuesta la cuarta parte. Los
      // vecinos se releen en cada par, así que una franja ya repartida —que ya
      // es parte del lote que se la quedó— no se puede volver a repartir.
      let candidata: Recorte | null = intersectarRecortes(bandaA, bandaB);
      if (candidata) {
        const caja = turf.bbox(candidata);
        for (const vecino of vecinos) {
          if (!candidata) break;
          if (cajasSeTocan(vecino.caja, caja)) candidata = restar(candidata, vecino.polygon);
        }
      }
      if (!candidata) continue;

      for (const franja of separarEnPoligonos(candidata)) {
        const area = turf.area(franja);
        if (!Number.isFinite(area) || area < AREA_MINIMA_FRANJA_M2 || area > maximoM2) continue;

        const segmentos = segmentosDe(franja, plano);
        const perimetro = segmentos.reduce((total, segmento) => total + segmento.largo, 0);
        if (perimetro <= 0) continue;
        // Ancho medio de la figura: para una tira larga da su ancho real, y una
        // figura compacta que lo pase mide menos de media hectárea. Por eso no
        // hace falta un umbral aparte de alargamiento: una laguna o un casco,
        // que son compactos y grandes, dan un ancho medio enorme.
        if ((2 * area) / perimetro > ancho) continue;

        const cajaFranja = turf.bbox(franja);
        const pegados = vecinos.filter((vecino) => cajasSeTocan(vecino.caja, cajaFranja));
        // Encerrada entre lotes, no colgada de uno solo: una tira contra el
        // límite del establecimiento, o el sobrante de un potrero sin detectar,
        // tienen la mitad del contorno al aire y no se tocan.
        const encierro = bordeCompartido(segmentos, pegados.flatMap((vecino) => vecino.segmentos));
        if (encierro / perimetro < encierroMinimo) continue;

        let elegido: Vecino | null = null;
        let mayor = 0;
        for (const vecino of pegados) {
          const compartido = bordeCompartido(segmentos, vecino.segmentos);
          if (compartido > mayor) { mayor = compartido; elegido = vecino; }
        }
        // La franja va al lote con el que comparte más borde. Si ese lote ya
        // está guardado no se lo toca, y la franja queda sin asignar.
        if (!elegido || !elegido.sugerencia || mayor / perimetro < asignacionMinima) continue;

        const unido = unir(elegido.polygon, franja);
        if (!unido || unido.geometry.type !== 'Polygon') continue;
        const crecido = turf.feature(unido.geometry, { ...elegido.polygon.properties }) as PolygonFeature;
        // Misma red de seguridad que abajo: el lote agrandado tiene que seguir
        // siendo guardable por POST /api/lotes.
        if (!esPolygonFeature(crecido) || !estaContenido(crecido, establecimiento)) continue;
        const cajaCrecido = turf.bbox(crecido);
        const choca = vecinos.some((vecino) => vecino !== elegido
          && cajasSeTocan(vecino.caja, cajaCrecido) && seSuperpone(crecido, vecino.polygon));
        if (choca) continue;

        elegido.sugerencia.polygon = crecido;
        elegido.sugerencia.hectareas = Number((turf.area(crecido) / M2_POR_HECTAREA).toFixed(2));
        elegido.polygon = crecido;
        elegido.caja = cajaCrecido;
        elegido.segmentos = segmentosDe(crecido, plano);
        asignadas += 1;
      }
    }
  }

  return asignadas;
}

/* ── Huecos sin cubrir ──────────────────────────────────────────────────────
 *
 * El modelo no detecta todo: sobre el campo de referencia, medido, deja fuera
 * potreros enteros —los de pasto sin borde neto, que es donde el modelo, que se
 * entrenó sobre parcelas agrícolas, anda peor—. Esos huecos son lotes que el
 * usuario va a terminar dibujando a mano.
 *
 * Acá se le ofrecen ya dibujados, pero **como candidatos, no como detecciones**:
 * viajan con `origen: 'hueco'` y `confianza: null`, y la interfaz los muestra
 * destildados. Nadie está diciendo que ahí hay un lote; se está diciendo "esto
 * quedó sin cubrir, ¿lo querés como lote?".
 *
 * El problema geométrico es que el área sin cubrir de un campo es UNA sola
 * pieza conectada: los potreros sin detectar cuelgan de los caminos y de los
 * callejones entre lotes. Ofrecerla entera sería ofrecer un lote de 200 ha con
 * los caminos adentro. Por eso primero se le sacan los corredores —lo que está
 * cerca de dos lotes a la vez, con el mismo cortador que usa el cierre de
 * franjas pero más ancho—, que es justamente lo que separa un potrero del
 * camino que lo bordea, y recién ahí se miran las piezas sueltas.
 */

/** Un hueco más angosto que esto es un corredor, no un potrero. */
export const HUECO_ANCHO_MINIMO_METROS = 50;
/** Piso de superficie para ofrecer un hueco como lote candidato. */
export const HUECO_HECTAREAS_MINIMAS = 3;
/** Ancho del cortador que separa los potreros de los caminos que los bordean. */
export const HUECO_CORREDOR_METROS = 40;

export interface OpcionesHuecos {
  anchoMinimoMetros?: number;
  hectareasMinimas?: number;
  corredorMetros?: number;
}

/**
 * Área del establecimiento que no quedó cubierta por ningún lote ni sugerencia.
 *
 * Se restan todos juntos como un MultiPolygon y no de a uno: restándolos uno
 * por uno, el acumulador se llena de huecos y cada resta siguiente cuesta más
 * que la anterior. El motor de recorte los normaliza igual.
 */
function sobranteDelCampo(aceptadas: SugerenciaLote[], opciones: OpcionesDepuracion): Recorte | null {
  const anillos = [...opciones.lotesExistentes, ...aceptadas.map((sugerencia) => sugerencia.polygon)]
    .map((polygon) => polygon.geometry.coordinates);
  if (anillos.length === 0) return opciones.establecimiento;
  return restar(opciones.establecimiento, turf.multiPolygon(anillos) as Recorte);
}

/** Ofrece como candidatos los huecos grandes y compactos que quedaron sin lote. */
function huecosSinCubrir(aceptadas: SugerenciaLote[], opciones: OpcionesDepuracion): SugerenciaLote[] {
  // Con menos de dos lotes no hay ningún par del que sacar corredores, así que
  // el "hueco" sería todo el resto del campo de una sola pieza, caminos
  // incluidos. Eso no es una propuesta, es devolverle el problema al usuario.
  if (opciones.huecos === false || aceptadas.length < 2) return [];
  const ajustes = opciones.huecos ?? {};
  const anchoMinimo = ajustes.anchoMinimoMetros ?? HUECO_ANCHO_MINIMO_METROS;
  const minimoM2 = (ajustes.hectareasMinimas ?? HUECO_HECTAREAS_MINIMAS) * M2_POR_HECTAREA;
  const corredor = ajustes.corredorMetros ?? HUECO_CORREDOR_METROS;

  const { establecimiento, lotesExistentes } = opciones;
  let sobrante = sobranteDelCampo(aceptadas, opciones);
  if (!sobrante) return [];

  // Los corredores se juntan primero y se restan de una: restarlos de a uno
  // sobre una geometría con decenas de huecos cuesta varios segundos.
  const plano = planoLocal(establecimiento);
  const { bandas, cajas } = bandasDeContornos(aceptadas, plano, corredor, establecimiento);
  const anillos: Polygon['coordinates'][] = [];
  for (let i = 0; i < aceptadas.length; i += 1) {
    for (let j = i + 1; j < aceptadas.length; j += 1) {
      const a = bandas[i];
      const b = bandas[j];
      if (!a || !b || !cajas[i] || !cajas[j] || !cajasSeTocan(cajas[i]!, cajas[j]!)) continue;
      const entre = intersectarRecortes(a, b);
      if (!entre) continue;
      if (entre.geometry.type === 'Polygon') anillos.push(entre.geometry.coordinates);
      else anillos.push(...entre.geometry.coordinates);
    }
  }
  if (anillos.length > 0) {
    // Se restan todos juntos como un MultiPolygon en vez de unirlos primero:
    // el motor de recorte los normaliza igual y la unión explícita de cien
    // piezas era el paso más caro de todo el armado.
    const corredores = turf.multiPolygon(anillos) as Recorte;
    sobrante = restar(sobrante, corredores) ?? sobrante;
  }
  if (!sobrante) return [];

  const huecos: SugerenciaLote[] = [];
  for (const pieza of separarEnPoligonos(sobrante)) {
    const area = turf.area(pieza);
    if (!Number.isFinite(area) || area < minimoM2) continue;
    const segmentos = segmentosDe(pieza, plano);
    const perimetro = segmentos.reduce((total, segmento) => total + segmento.largo, 0);
    if (perimetro <= 0) continue;
    // Un hueco compacto tiene ancho medio grande; un pedazo de camino que
    // sobrevivió al cortador, no.
    if ((2 * area) / perimetro < anchoMinimo) continue;
    if (!esPolygonFeature(pieza) || !estaContenido(pieza, establecimiento)) continue;
    if (lotesExistentes.some((lote) => seSuperpone(pieza, lote))) continue;
    if (aceptadas.some((previa) => seSuperpone(pieza, previa.polygon))) continue;
    if (huecos.some((previo) => seSuperpone(pieza, previo.polygon))) continue;

    pieza.properties = { origen: 'hueco', confianza: null };
    huecos.push({
      id: `hueco-${huecos.length + 1}`,
      polygon: pieza,
      hectareas: Number((area / M2_POR_HECTAREA).toFixed(2)),
      confianza: null,
      origen: 'hueco',
    });
  }
  return huecos;
}

export function depurarSugerencias(crudas: PolygonFeature[], opciones: OpcionesDepuracion): ResultadoDepuracion {
  const { establecimiento, lotesExistentes } = opciones;
  const minimoM2 = (opciones.hectareasMinimas ?? HECTAREAS_MINIMAS) * M2_POR_HECTAREA;
  const maximo = opciones.maximo ?? MAXIMO_SUGERENCIAS;

  // De mayor a menor: ante un solape entre dos detecciones, el lote grande se
  // queda entero y el chico cede la parte pisada.
  const ordenadas = [...crudas]
    .map((polygon) => ({ polygon, area: turf.area(polygon) }))
    .filter((item) => Number.isFinite(item.area) && item.area > 0)
    .sort((a, b) => b.area - a.area);

  const aceptadas: SugerenciaLote[] = [];
  // Restar un polígono que ni siquiera toca el recorte es una operación cara
  // que no cambia nada, y acá son todos contra todos: con setenta detecciones
  // eran miles de restas de más. La caja se compara primero.
  const cajasAceptadas: number[][] = [];
  const cajasExistentes = lotesExistentes.map((lote) => turf.bbox(lote));
  let descartadas = 0;

  for (const { polygon } of ordenadas) {
    if (aceptadas.length >= maximo) { descartadas += 1; continue; }

    let recorte: Recorte | null = intersectar(polygon, establecimiento);
    let caja = recorte ? turf.bbox(recorte) : null;
    for (let i = 0; i < lotesExistentes.length; i += 1) {
      if (!recorte || !caja) break;
      if (!cajasSeTocan(cajasExistentes[i], caja)) continue;
      recorte = restar(recorte, lotesExistentes[i]);
      caja = recorte ? turf.bbox(recorte) : null;
    }
    for (let i = 0; i < aceptadas.length; i += 1) {
      if (!recorte || !caja) break;
      if (!cajasSeTocan(cajasAceptadas[i], caja)) continue;
      recorte = restar(recorte, aceptadas[i].polygon);
      caja = recorte ? turf.bbox(recorte) : null;
    }
    if (!recorte) { descartadas += 1; continue; }

    const confianza = confianzaDe(polygon);
    let sumadas = 0;
    for (const parte of separarEnPoligonos(recorte)) {
      if (aceptadas.length >= maximo) break;
      const area = turf.area(parte);
      if (!Number.isFinite(area) || area < minimoM2) continue;
      // Red de seguridad: lo que no pasaría las validaciones de POST /api/lotes
      // no se ofrece. Preferimos una sugerencia menos que una que no se puede guardar.
      if (!esPolygonFeature(parte) || !estaContenido(parte, establecimiento)) continue;
      const cajaParte = turf.bbox(parte);
      if (lotesExistentes.some((lote, i) => cajasSeTocan(cajasExistentes[i], cajaParte) && seSuperpone(parte, lote))) continue;
      if (aceptadas.some((previa, i) => cajasSeTocan(cajasAceptadas[i], cajaParte) && seSuperpone(parte, previa.polygon))) continue;

      parte.properties = { origen: 'ia', confianza };
      aceptadas.push({
        id: `sug-${aceptadas.length + 1}`,
        polygon: parte,
        hectareas: Number((area / M2_POR_HECTAREA).toFixed(2)),
        confianza,
        origen: 'ia',
      });
      cajasAceptadas.push(cajaParte);
      sumadas += 1;
    }
    if (sumadas === 0) descartadas += 1;
  }

  const franjasAsignadas = cerrarFranjas(aceptadas, opciones);
  // Los huecos van al final y respetan el mismo tope: son candidatos, y ante un
  // tope apretado se prefiere conservar lo que el modelo sí detectó.
  const huecos = huecosSinCubrir(aceptadas, opciones).slice(0, Math.max(0, maximo - aceptadas.length));

  return { sugerencias: [...aceptadas, ...huecos], descartadas, franjasAsignadas, huecos: huecos.length };
}
