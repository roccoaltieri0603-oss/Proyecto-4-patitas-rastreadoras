interface RodeoLogoProps {
  className?: string;
}

const LETRAS = ["R", "O", "D", "E", "O"];

/**
 * Marca RODEO: cinco fichas verdes con la letra en crema.
 *
 * En el Figma cada letra es un SVG propio, con trazos gruesos que llenan la
 * ficha. Acá están imitadas con tipografía muy pesada y apretada para acercarse
 * a ese peso; si algún día se exportan los SVG a `src/assets/`, conviene
 * reemplazar esto por los originales.
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
          className="flex aspect-[147/154] w-[clamp(2.6rem,11.5vw,9.2rem)] items-center justify-center rounded-[clamp(7px,2.2vw,28px)] border-[clamp(3px,0.72vw,9px)] border-lima bg-lima/60 shadow-[0_2px_14px_rgba(31,51,25,0.28)] backdrop-blur-[2px]"
        >
          <span className="text-[clamp(2rem,9.4vw,7.5rem)] leading-none font-bold tracking-[-0.06em] text-crema drop-shadow-[0_2px_3px_rgba(47,74,30,0.45)]">
            {letra}
          </span>
        </span>
      ))}
    </div>
  );
}
