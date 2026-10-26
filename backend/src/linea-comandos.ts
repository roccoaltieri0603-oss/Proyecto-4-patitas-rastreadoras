import { esFechaCalendario } from './fechas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Argumentos de los scripts de mantenimiento. Una opción desconocida es un
 * error y no se ignora: un typo en `--escribir` no puede convertir una prueba en
 * una escritura, ni al revés.
 */

export interface Argumentos {
  banderas: Set<string>;
  valores: Map<string, string[]>;
}

export interface OpcionesAceptadas {
  banderas: readonly string[];
  conValor: readonly string[];
}

export function leerArgumentos(argv: string[], aceptadas: OpcionesAceptadas): Argumentos {
  const banderas = new Set<string>();
  const valores = new Map<string, string[]>();
  for (let indice = 0; indice < argv.length; indice += 1) {
    const crudo = argv[indice];
    if (!crudo.startsWith('--')) throw new Error(`Argumento inesperado: ${crudo}`);
    const [nombre, enLinea] = crudo.slice(2).split(/=(.*)/s, 2);
    if (aceptadas.banderas.includes(nombre)) {
      if (enLinea !== undefined) throw new Error(`--${nombre} no lleva valor.`);
      banderas.add(nombre);
      continue;
    }
    if (!aceptadas.conValor.includes(nombre)) throw new Error(`Opción desconocida: --${nombre}`);
    const valor = enLinea ?? argv[indice + 1];
    if (valor === undefined || valor.startsWith('--') || valor.trim() === '') throw new Error(`--${nombre} necesita un valor.`);
    if (enLinea === undefined) indice += 1;
    valores.set(nombre, [...(valores.get(nombre) ?? []), valor.trim()]);
  }
  return { banderas, valores };
}

function unico(argumentos: Argumentos, nombre: string): string | undefined {
  const lista = argumentos.valores.get(nombre);
  if (lista && lista.length > 1) throw new Error(`--${nombre} va una sola vez.`);
  return lista?.[0];
}

/**
 * Por defecto los scripts sólo muestran lo que harían. Escribir pide
 * `--escribir` explícito; pasar las dos cosas es una contradicción y se rechaza.
 */
export function escribe(argumentos: Argumentos): boolean {
  if (argumentos.banderas.has('escribir') && argumentos.banderas.has('dry-run')) throw new Error('--escribir y --dry-run no van juntos.');
  return argumentos.banderas.has('escribir');
}

export function enteroPositivo(argumentos: Argumentos, nombre: string): number | undefined {
  const crudo = unico(argumentos, nombre);
  if (crudo === undefined) return undefined;
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error(`--${nombre} debe ser un entero positivo.`);
  return valor;
}

export function fecha(argumentos: Argumentos, nombre: string): string | undefined {
  const crudo = unico(argumentos, nombre);
  if (crudo === undefined) return undefined;
  if (!esFechaCalendario(crudo)) throw new Error(`--${nombre} debe ser una fecha YYYY-MM-DD válida.`);
  return crudo;
}

/** Acepta la opción repetida o una lista separada por comas. */
export function uuids(argumentos: Argumentos, nombre: string): string[] | undefined {
  const lista = argumentos.valores.get(nombre)?.flatMap((valor) => valor.split(',')).map((valor) => valor.trim()).filter(Boolean);
  if (!lista || lista.length === 0) return undefined;
  const invalido = lista.find((valor) => !UUID.test(valor));
  if (invalido) throw new Error(`--${nombre}: "${invalido}" no es un UUID.`);
  return [...new Set(lista)];
}
