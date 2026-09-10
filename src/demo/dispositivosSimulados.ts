// Datos falsos para la pantalla de dispositivos GPS.
//
// Existen sólo porque todavía no hay backend de GPS. No se persisten, no salen
// de este módulo y la pantalla los rotula siempre como simulados. Cuando el
// backend implemente el contrato de src/api/dispositivos.ts, alcanza con poner
// USAR_DISPOSITIVOS_SIMULADOS en false (o definir VITE_DISPOSITIVOS_MOCK=false)
// y borrar este archivo.
//
// Los casos elegidos cubren todo lo que la interfaz tiene que saber dibujar,
// incluido lo que NO tiene dato: batería null, ubicación null, nunca conectado.

import type { Dispositivo, MuestraBateria } from "../api/dispositivos";

export const USAR_DISPOSITIVOS_SIMULADOS =
  (import.meta.env.VITE_DISPOSITIVOS_MOCK ?? "true").toString().trim() !== "false";

const UN_MINUTO = 60 * 1000;

/** Momento fijo por render de módulo: los "hace X" quedan estables durante la sesión. */
const AHORA = Date.now();

function haceMinutos(minutos: number): string {
  return new Date(AHORA - minutos * UN_MINUTO).toISOString();
}

export const DISPOSITIVOS_SIMULADOS: Dispositivo[] = [
  {
    id: "sim-1",
    identificadorEquipo: "RD-0001",
    apodo: "Collar cabecera",
    conexion: "en-linea",
    bateriaPorcentaje: 87,
    ultimaSenal: haceMinutos(4),
    ubicacion: { latitud: -34.6118, longitud: -58.4173, precisionMetros: 6 },
    loteId: null,
    numeroLote: 1,
    animalId: null,
  },
  {
    id: "sim-2",
    identificadorEquipo: "RD-0002",
    apodo: "Collar rodeo chico",
    conexion: "en-linea",
    bateriaPorcentaje: 12,
    ultimaSenal: haceMinutos(11),
    ubicacion: { latitud: -34.6155, longitud: -58.4102, precisionMetros: 14 },
    loteId: null,
    numeroLote: 2,
    animalId: null,
  },
  {
    id: "sim-3",
    identificadorEquipo: "RD-0003",
    apodo: null,
    conexion: "sin-senal",
    bateriaPorcentaje: 41,
    ultimaSenal: haceMinutos(9 * 60),
    ubicacion: { latitud: -34.6201, longitud: -58.4260, precisionMetros: null },
    loteId: null,
    numeroLote: 3,
    animalId: null,
  },
  {
    id: "sim-4",
    identificadorEquipo: "RD-0004",
    apodo: "Collar prestado",
    conexion: "en-linea",
    // El equipo reporta posición pero no informa batería: no se asume 0.
    bateriaPorcentaje: null,
    ultimaSenal: haceMinutos(2),
    ubicacion: { latitud: -34.6089, longitud: -58.4310, precisionMetros: 22 },
    loteId: null,
    numeroLote: null,
    animalId: null,
  },
  {
    id: "sim-5",
    identificadorEquipo: "RD-0005",
    apodo: "Collar taller",
    conexion: "sin-senal",
    bateriaPorcentaje: 3,
    ultimaSenal: haceMinutos(3 * 24 * 60),
    ubicacion: null,
    loteId: null,
    numeroLote: null,
    animalId: null,
  },
  {
    id: "sim-6",
    identificadorEquipo: "RD-0006",
    apodo: null,
    conexion: "nunca-conectado",
    bateriaPorcentaje: null,
    ultimaSenal: null,
    ubicacion: null,
    loteId: null,
    numeroLote: null,
    animalId: null,
  },
];

/** Curva de descarga inventada, sólo para que el gráfico tenga forma. */
export function historialBateriaSimulado(dispositivo: Dispositivo): MuestraBateria[] {
  if (dispositivo.bateriaPorcentaje === null) return [];
  const muestras: MuestraBateria[] = [];
  for (let horasAtras = 11; horasAtras >= 0; horasAtras -= 1) {
    muestras.push({
      momento: haceMinutos(horasAtras * 60),
      porcentaje: Math.min(100, dispositivo.bateriaPorcentaje + horasAtras),
    });
  }
  return muestras;
}
