interface RodeoLogoProps {
  className?: string;
}

const LETRAS = ["R", "O", "D", "E", "O"];

/**
 * Marca RODEO: cinco fichas verdes con la letra en crema.
 *
 * En el Figma cada letra es un SVG propio. Acá están imitadas con CSS para no
 * depender de archivos que todavía no están exportados; si se exportan a
 * `src/assets/`, conviene reemplazar esto por los SVG reales.
 *
 * Proporciones del diseño: fichas de 147.3 × 153.87 px separadas 19.98 px,
 * sobre un ancho de frame de 1280 px.
 */
export default function RodeoLogo({ className = "" }: RodeoLogoProps) {
  return (
    <div
      className={`flex items-center gap-[clamp(0.25rem,1.56vw,1.25rem)] ${className}`}
      role="img"
      aria-label="RODEO"
    >
      {LETRAS.map((letra, indice) => (
        <span
          key={`${letra}-${indice}`}
          aria-hidden="true"
          className="flex aspect-[147/154] w-[clamp(2.6rem,11.5vw,9.2rem)] items-center justify-center rounded-[clamp(6px,1.9vw,24px)] border-[clamp(2px,0.5vw,6px)] border-lima bg-lima/70 text-[clamp(1.6rem,7.6vw,6.1rem)] font-bold tracking-[-0.04em] text-crema"
        >
          {letra}
        </span>
      ))}
    </div>
  );
}
