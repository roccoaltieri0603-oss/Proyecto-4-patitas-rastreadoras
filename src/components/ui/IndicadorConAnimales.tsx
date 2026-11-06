/**
 * Punto rojo con ondas y "Con animales", dentro de la tarjeta de un lote. Es
 * un dato más de la tarjeta, no una alerta: el texto va en el gris de la
 * tarjeta y sólo el punto lleva color.
 *
 * `simulado`: lo marcó el GPS simulado del mapa, no una jornada cargada. Se dice
 * siempre, porque esa posición es de la demo y no un dato real de campo.
 *
 * Las ondas son dos anillos desfasados; con "reducir movimiento" activado en el
 * sistema quedan quietas y el punto sigue visible.
 */
export default function IndicadorConAnimales({ simulado = false }: { simulado?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-medium text-gray-600">
      <span aria-hidden="true" className="relative flex size-2.5 flex-none">
        <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
        <span className="absolute inset-0 rounded-full bg-red-500 opacity-40 motion-safe:animate-ping motion-safe:[animation-delay:700ms]" />
        <span className="relative size-2.5 rounded-full bg-red-600" />
      </span>
      Con animales
      {simulado && <span className="text-gray-400">· GPS simulado</span>}
    </span>
  );
}
