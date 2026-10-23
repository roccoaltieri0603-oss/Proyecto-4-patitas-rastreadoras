const ZONA = 'America/Argentina/Buenos_Aires';

export function fechaCompletaNotificacion(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: ZONA }).format(date);
}

export function fechaAmigableNotificacion(value: string, ahora = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  const delta = ahora.getTime() - date.getTime();
  if (delta >= 0 && delta < 60 * 60 * 1000) {
    const minutos = Math.floor(delta / 60_000);
    return minutos < 1 ? 'Hace unos segundos' : `Hace ${new Intl.NumberFormat('es-AR').format(minutos)} minuto${minutos === 1 ? '' : 's'}`;
  }
  if (delta >= 0 && delta < 24 * 60 * 60 * 1000) {
    const horas = Math.floor(delta / 3_600_000);
    return `Hace ${horas} hora${horas === 1 ? '' : 's'}`;
  }
  const formatDay = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);
  const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA }).format(date);
  const ayer = new Date(ahora.getTime() - 86_400_000);
  if (formatDay(date) === formatDay(ayer)) return `Ayer, ${hora}`;
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA }).format(date);
}

export function categoriaNotificacion(tipo: string): { icono: string; etiqueta: string } {
  if (/ingreso|sesion|seguridad/.test(tipo)) return { icono: '🔒', etiqueta: 'Seguridad' };
  if (/permiso|administrador|miembro|invitacion|propiedad/.test(tipo)) return { icono: '👥', etiqueta: 'Equipo' };
  // Antes que "lote": gps_simulado_en_lote es un aviso del GPS simulado.
  if (/gps/.test(tipo)) return { icono: '📍', etiqueta: 'GPS simulado' };
  if (/lote|limite/.test(tipo)) return { icono: '🌱', etiqueta: 'Lotes' };
  if (/satelite/.test(tipo)) return { icono: '🛰️', etiqueta: 'Satélite' };
  if (/clima|meteo/.test(tipo)) return { icono: '🌦️', etiqueta: 'Clima' };
  return { icono: '🔔', etiqueta: 'Aviso' };
}
