export function esFechaCalendario(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [anio, mes, dia] = value.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

export function diasEntreFechas(fechaInicial: string, fechaFinal: string): number {
  const [anioInicial, mesInicial, diaInicial] = fechaInicial.split('-').map(Number);
  const [anioFinal, mesFinal, diaFinal] = fechaFinal.split('-').map(Number);
  const inicial = Date.UTC(anioInicial, mesInicial - 1, diaInicial);
  const final = Date.UTC(anioFinal, mesFinal - 1, diaFinal);
  return Math.round((final - inicial) / 86400000);
}

export function hoyCalendario(date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

export function horasDesdeTimestamp(timestamp: Date | string, ahora = Date.now()): number {
  return Math.max(0, (ahora - new Date(timestamp).getTime()) / 3600000);
}
