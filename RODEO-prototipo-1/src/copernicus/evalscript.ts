/**
 * Evalscript (V3) para la Statistical API de Sentinel Hub sobre Sentinel-2 L2A.
 *
 * Devuelve cuatro índices por píxel y una máscara de validez:
 *  - ndvi: vigor / biomasa verde         (B08, B04)
 *  - ndmi: humedad de la vegetación      (B08, B11)
 *  - ndwi: agua libre / anegamiento      (B03, B08)
 *  - evi:  vegetación corregida por suelo y atmósfera (B08, B04, B02)
 *
 * La máscara `dataMask` se pone en 0 para nubes, sombras, cirrus, nieve y
 * píxeles saturados según la banda de clasificación de escena (SCL). La
 * Statistical API cuenta esos píxeles como `noDataCount`, así que del lado del
 * front podemos saber qué porcentaje del lote se vio realmente despejado.
 */
export const EVALSCRIPT_INDICES = `//VERSION=3
function setup() {
  return {
    // Sin "units": Sentinel-2 L2A ya entrega las bandas ópticas en reflectancia
    // (0..1) por defecto. Forzar REFLECTANCE acá rompe, porque SCL y dataMask
    // no admiten esa unidad.
    input: [{
      bands: ["B02", "B03", "B04", "B08", "B11", "SCL", "dataMask"]
    }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "evi",  bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ],
    mosaicking: "SIMPLE"
  };
}

// SCL: 0 sin dato, 1 saturado/defectuoso, 3 sombra de nube,
//      8 nube prob. media, 9 nube prob. alta, 10 cirrus, 11 nieve/hielo.
function esPixelDespejado(scl) {
  return scl !== 0 && scl !== 1 && scl !== 3 &&
         scl !== 8 && scl !== 9 && scl !== 10 && scl !== 11;
}

function indiceNormalizado(a, b) {
  var suma = a + b;
  if (suma === 0) return 0;
  return (a - b) / suma;
}

function acotar(v) {
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function evaluatePixel(muestra) {
  var valido = muestra.dataMask === 1 && esPixelDespejado(muestra.SCL);
  if (!valido) {
    return { ndvi: [0], ndmi: [0], ndwi: [0], evi: [0], dataMask: [0] };
  }

  var denomEvi = muestra.B08 + 6 * muestra.B04 - 7.5 * muestra.B02 + 1;
  var evi = denomEvi === 0 ? 0 : (2.5 * (muestra.B08 - muestra.B04)) / denomEvi;

  return {
    ndvi: [acotar(indiceNormalizado(muestra.B08, muestra.B04))],
    ndmi: [acotar(indiceNormalizado(muestra.B08, muestra.B11))],
    ndwi: [acotar(indiceNormalizado(muestra.B03, muestra.B08))],
    evi:  [acotar(evi)],
    dataMask: [1]
  };
}`;

/**
 * Evalscript (V3) para la Statistical API sobre Sentinel-1 GRD (radar de apertura
 * sintética, banda C). Es el respaldo cuando no hay ninguna pasada óptica
 * despejada: el radar no lo tapan las nubes.
 *
 * Devuelve el RVI4S1 (Radar Vegetation Index para dual-pol VV+VH), que crece
 * con la biomasa/densidad del canopeo. No es NDVI ni es comparable con la
 * escala de puntaje óptico: sólo sirve como señal de "hay vegetación" cuando
 * no tenemos nada mejor.
 */
export const EVALSCRIPT_RADAR = `//VERSION=3
function setup() {
  return {
    // LINEAR_POWER explícito: el RVI4S1 se calcula sobre potencia lineal, no
    // sobre los dB que entrega Sentinel Hub por defecto.
    input: [{
      bands: ["VV", "VH"],
      units: "LINEAR_POWER"
    }],
    output: [
      { id: "rvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ],
    mosaicking: "SIMPLE"
  };
}

function evaluatePixel(muestra) {
  var valido = muestra.VV > 0 && muestra.VH > 0 &&
               isFinite(muestra.VV) && isFinite(muestra.VH);
  if (!valido) {
    return { rvi: [0], dataMask: [0] };
  }

  var suma = muestra.VV + muestra.VH;
  var dop = muestra.VV / suma;
  var rvi = Math.sqrt(dop) * (4 * muestra.VH / suma);

  return { rvi: [rvi > 1 ? 1 : rvi], dataMask: [1] };
}`;
