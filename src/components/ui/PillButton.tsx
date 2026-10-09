import type { ButtonHTMLAttributes } from "react";

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Botón de contorno redondeado sobre el fondo de campo: borde blanco, sin
 * relleno y tipografía grande. Es el único botón de las pantallas de acceso.
 *
 * Las medidas salen del Figma (1280×832) y se expresan en `--figma` para que
 * coincidan a ese tamaño y achiquen bien en pantallas más chicas, anchas o bajas.
 */
export default function PillButton({ className = "", ...rest }: PillButtonProps) {
  return (
    <button
      className={`texto-foto foco-campo cursor-pointer rounded-full border-[length:clamp(2px,calc(0.31*var(--figma)),4px)] border-white bg-black/10 px-[clamp(1.5rem,calc(8.1*var(--figma)),6.5rem)] py-[clamp(0.5rem,calc(2.34*var(--figma)),1.875rem)] text-center text-[length:clamp(0.95rem,calc(3.05*var(--figma)),2.44rem)] font-medium tracking-[-0.05em] text-white transition-colors enabled:hover:bg-white/20 disabled:cursor-wait disabled:opacity-60 ${className}`}
      {...rest}
    />
  );
}
