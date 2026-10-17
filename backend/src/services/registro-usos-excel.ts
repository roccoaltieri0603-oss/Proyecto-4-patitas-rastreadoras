import ExcelJS from 'exceljs';
import type { LoteDelRegistro, RegistroDeUso } from './registro-usos.js';

/**
 * Libro Excel del registro de manejo de potreros.
 *
 * No se guarda ningún archivo: el libro se arma al vuelo con la misma consulta
 * que alimenta la planilla en pantalla y se escribe directo en la respuesta.
 *
 * Replica la planilla de campo, encabezados combinados incluidos. Las columnas
 * que el sistema todavía no registra —fecha de salida, días de ocupación,
 * animales y recomendaciones de manejo— quedan **vacías a propósito**, para
 * que se completen a mano en el campo. No se rellenan con un valor inventado y
 * la hoja aclara arriba por qué están vacías.
 */

export interface DatosDelLibro {
  establecimiento: string;
  /** Un potrero por hoja, también los que no tienen renglones en el período. */
  lotes: LoteDelRegistro[];
  registros: RegistroDeUso[];
  desde?: string;
  hasta?: string;
  generadoEn: Date;
}

export const TITULO = 'Registro de manejo de potreros en la finca';

const AZUL = 'FF1E3A5F';
const VERDE_CLARO = 'FFE6F2EA';
const VERDE_OSCURO = 'FF24543C';
const BORDE = 'FFB7C4D1';

/** Columna por columna, en el orden de la planilla. */
const COLUMNAS = [
  { grupo: 'Potrero', titulo: 'Potrero', ancho: 24 },
  { grupo: 'Potrero', titulo: 'Superficie (ha)', ancho: 15 },
  { grupo: 'Fechas', titulo: 'Fecha de entrada', ancho: 16 },
  { grupo: 'Fechas', titulo: 'Fecha de salida', ancho: 16 },
  { grupo: 'Días', titulo: 'Días de descanso', ancho: 18 },
  { grupo: 'Días', titulo: 'Días de ocupación', ancho: 16 },
  { grupo: 'Número de animales que ingresan', titulo: 'Adultos', ancho: 11 },
  { grupo: 'Número de animales que ingresan', titulo: 'Toretes o vaconas', ancho: 16 },
  { grupo: 'Número de animales que ingresan', titulo: 'Terneros o terneras', ancho: 17 },
  { grupo: 'Recomendaciones de manejo', titulo: 'Corte de igualación', ancho: 17 },
  { grupo: 'Recomendaciones de manejo', titulo: 'Riego', ancho: 12 },
  { grupo: 'Recomendaciones de manejo', titulo: 'Fertilización', ancho: 14 },
  { grupo: 'Recomendaciones de manejo', titulo: 'Resiembra', ancho: 13 },
  { grupo: 'Origen del registro', titulo: 'Origen del registro', ancho: 16 },
] as const;

const FILA_GRUPOS = 4;
const FILA_TITULOS = 5;
const PRIMERA_FILA_DATOS = 6;
const ULTIMA_COLUMNA = COLUMNAS.length;

const NOTA =
  'Las columnas de fecha de salida, días de ocupación, animales y recomendaciones de manejo ' +
  'están vacías para completar a mano: el sistema todavía no registra jornadas de pastoreo ni ganado. ' +
  'La fecha de entrada es la fecha del uso registrado y los días de descanso se cuentan contra el uso anterior del mismo potrero.';

function letra(indice: number): string {
  // La planilla tiene 14 columnas; alcanza con A..Z.
  return String.fromCharCode(64 + indice);
}

function periodo(desde?: string, hasta?: string): string {
  if (desde && hasta) return `Período: ${fechaLegible(desde)} a ${fechaLegible(hasta)}`;
  if (desde) return `Período: desde el ${fechaLegible(desde)}`;
  if (hasta) return `Período: hasta el ${fechaLegible(hasta)}`;
  return 'Período: todo el historial registrado';
}

function fechaLegible(calendario: string): string {
  const [anio, mes, dia] = calendario.split('-');
  return `${dia}/${mes}/${anio}`;
}

/**
 * Una fecha de calendario no es un instante: se escribe a mediodía UTC para que
 * Excel muestre el mismo día en cualquier huso.
 */
function fechaExcel(calendario: string): Date {
  const [anio, mes, dia] = calendario.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, 12));
}

export function nombreDeHoja(lote: LoteDelRegistro, usados: Set<string>): string {
  const base = lote.apodo ? `Lote ${lote.numero} - ${lote.apodo}` : `Lote ${lote.numero}`;
  // Excel rechaza * ? : \ / [ ] y corta en 31 caracteres.
  let nombre = base.replace(/[*?:\\/[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  for (let sufijo = 2; usados.has(nombre); sufijo += 1) {
    nombre = `${base.slice(0, 27)} (${sufijo})`;
  }
  usados.add(nombre);
  return nombre;
}

interface GrupoDeColumnas {
  nombre: string;
  /** Índices de columna 1-based, inclusive. */
  primera: number;
  ultima: number;
}

/** Tramos consecutivos de `COLUMNAS` que comparten grupo, en orden. */
export function gruposDeColumnas(): GrupoDeColumnas[] {
  const grupos: GrupoDeColumnas[] = [];
  COLUMNAS.forEach((columna, indice) => {
    const anterior = grupos[grupos.length - 1];
    if (anterior && anterior.nombre === columna.grupo) anterior.ultima = indice + 1;
    else grupos.push({ nombre: columna.grupo, primera: indice + 1, ultima: indice + 1 });
  });
  return grupos;
}

function bordear(celda: ExcelJS.Cell): void {
  celda.border = {
    top: { style: 'thin', color: { argb: BORDE } },
    left: { style: 'thin', color: { argb: BORDE } },
    bottom: { style: 'thin', color: { argb: BORDE } },
    right: { style: 'thin', color: { argb: BORDE } },
  };
}

function escribirEncabezado(hoja: ExcelJS.Worksheet, lote: LoteDelRegistro, datos: DatosDelLibro): void {
  hoja.mergeCells(`A1:${letra(ULTIMA_COLUMNA)}1`);
  const titulo = hoja.getCell('A1');
  titulo.value = TITULO;
  titulo.font = { bold: true, size: 14, color: { argb: AZUL } };
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  hoja.getRow(1).height = 24;

  hoja.mergeCells(`A2:${letra(ULTIMA_COLUMNA)}2`);
  const superficie = lote.hectareas === null ? 'superficie sin datos' : `${lote.hectareas.toFixed(2)} ha`;
  const subtitulo = hoja.getCell('A2');
  subtitulo.value = `${datos.establecimiento} · Lote ${lote.numero}${lote.apodo ? ` (${lote.apodo})` : ''} · ${superficie} · `
    + `${periodo(datos.desde, datos.hasta)} · Generado el ${datos.generadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`;
  subtitulo.font = { size: 10, color: { argb: VERDE_OSCURO } };
  subtitulo.alignment = { horizontal: 'left', vertical: 'middle' };

  hoja.mergeCells(`A3:${letra(ULTIMA_COLUMNA)}3`);
  const nota = hoja.getCell('A3');
  nota.value = NOTA;
  nota.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
  nota.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  hoja.getRow(3).height = 28;
}

function escribirColumnas(hoja: ExcelJS.Worksheet): void {
  COLUMNAS.forEach((columna, indice) => { hoja.getColumn(indice + 1).width = columna.ancho; });

  // Cada grupo combina sus columnas consecutivas. Un grupo de una sola columna
  // se combina en vertical con la fila de títulos, así no queda un rótulo
  // repetido dos veces.
  for (const grupo of gruposDeColumnas()) {
    hoja.mergeCells(grupo.primera === grupo.ultima
      ? `${letra(grupo.primera)}${FILA_GRUPOS}:${letra(grupo.primera)}${FILA_TITULOS}`
      : `${letra(grupo.primera)}${FILA_GRUPOS}:${letra(grupo.ultima)}${FILA_GRUPOS}`);
    hoja.getCell(`${letra(grupo.primera)}${FILA_GRUPOS}`).value = grupo.nombre;
  }

  for (let indice = 1; indice <= ULTIMA_COLUMNA; indice += 1) {
    const celda = hoja.getCell(`${letra(indice)}${FILA_GRUPOS}`);
    celda.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    bordear(celda);

    const titulo = hoja.getCell(`${letra(indice)}${FILA_TITULOS}`);
    if (!titulo.isMerged) titulo.value = COLUMNAS[indice - 1].titulo;
    titulo.font = { bold: true, size: 10, color: { argb: VERDE_OSCURO } };
    titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
    titulo.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    bordear(titulo);
  }
  hoja.getRow(FILA_GRUPOS).height = 20;
  hoja.getRow(FILA_TITULOS).height = 30;
}

function escribirFila(hoja: ExcelJS.Worksheet, fila: number, lote: LoteDelRegistro, registro: RegistroDeUso): void {
  const nombre = lote.apodo ? `Lote ${lote.numero} - ${lote.apodo}` : `Lote ${lote.numero}`;
  hoja.getCell(`A${fila}`).value = nombre;
  if (lote.hectareas !== null) {
    const superficie = hoja.getCell(`B${fila}`);
    superficie.value = lote.hectareas;
    superficie.numFmt = '0.00';
  }
  const entrada = hoja.getCell(`C${fila}`);
  entrada.value = fechaExcel(registro.fecha);
  entrada.numFmt = 'dd/mm/yyyy';
  // D (fecha de salida) queda vacía: no se registra todavía.
  hoja.getCell(`E${fila}`).value = registro.diasDescanso ?? 'Primer uso registrado';
  // F a M quedan vacías para completar a mano.
  hoja.getCell(`N${fila}`).value = registro.origen;

  for (let indice = 1; indice <= ULTIMA_COLUMNA; indice += 1) {
    const celda = hoja.getCell(`${letra(indice)}${fila}`);
    celda.alignment = { vertical: 'middle', horizontal: indice === 1 ? 'left' : 'center', wrapText: indice === 1 };
    bordear(celda);
  }
  if (fila % 2 === 0) {
    for (let indice = 1; indice <= ULTIMA_COLUMNA; indice += 1) {
      hoja.getCell(`${letra(indice)}${fila}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAF8' } };
    }
  }
}

export function construirLibroRegistro(datos: DatosDelLibro): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'RODEO';
  libro.created = datos.generadoEn;

  const porLote = new Map<string, RegistroDeUso[]>();
  for (const registro of datos.registros) {
    const lista = porLote.get(registro.loteId) ?? [];
    lista.push(registro);
    porLote.set(registro.loteId, lista);
  }

  const usados = new Set<string>();
  for (const lote of datos.lotes) {
    const hoja = libro.addWorksheet(nombreDeHoja(lote, usados), {
      views: [{ state: 'frozen', ySplit: FILA_TITULOS }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    escribirEncabezado(hoja, lote, datos);
    escribirColumnas(hoja);

    const registros = porLote.get(lote.id) ?? [];
    registros.forEach((registro, indice) => escribirFila(hoja, PRIMERA_FILA_DATOS + indice, lote, registro));
    if (registros.length === 0) {
      hoja.mergeCells(`A${PRIMERA_FILA_DATOS}:${letra(ULTIMA_COLUMNA)}${PRIMERA_FILA_DATOS}`);
      const vacia = hoja.getCell(`A${PRIMERA_FILA_DATOS}`);
      vacia.value = 'Sin usos registrados en este período.';
      vacia.font = { italic: true, color: { argb: 'FF6B7280' } };
      vacia.alignment = { horizontal: 'center', vertical: 'middle' };
      bordear(vacia);
    } else {
      hoja.autoFilter = { from: `A${FILA_TITULOS}`, to: `${letra(ULTIMA_COLUMNA)}${FILA_TITULOS}` };
    }
  }

  return libro;
}
