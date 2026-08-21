export const EVALSCRIPT_INDICES = `//VERSION=3
function setup() {
  return {
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

export const EVALSCRIPT_RADAR = `//VERSION=3
function setup() {
  return {
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

