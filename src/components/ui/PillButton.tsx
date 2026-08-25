import type { ButtonHTMLAttributes } from "react";

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Botón de contorno redondeado sobre el fondo de campo: borde blanco, sin
 * relleno y tipografía grande. Es el único botón de las pantallas de acceso.
 *
 * Las medidas salen del Figma (1280px de ancho) y se expresan con clamp para
 * que coincidan exactamente a ese ancho y achiquen bien en pantallas menores.
 */
export default function PillButton({ className = "", ...rest }: PillButtonProps) {
  return (
    <button
      className={`cursor-pointer rounded-full border-[clamp(2px,0.31vw,4px)] border-white bg-transparent px-[clamp(1.5rem,8.1vw,6.5rem)] py-[clamp(0.5rem,2.34vw,1.875rem)] text-center text-[clamp(0.95rem,3.05vw,2.44rem)] font-medium tracking-[-0.05em] text-white transition-colors enabled:hover:bg-white/15 disabled:cursor-wait disabled:opacity-60 ${className}`}
      {...rest}
    />
  );
}
