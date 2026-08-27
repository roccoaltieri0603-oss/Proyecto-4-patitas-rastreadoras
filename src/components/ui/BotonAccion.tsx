import type { ButtonHTMLAttributes } from "react";

type BotonAccionProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Botón verde de acción del onboarding: relleno `#97ea7c` al 60% con borde
 * sólido del mismo verde y esquinas muy redondeadas. Es la acción principal de
 * cada paso.
 */
export default function BotonAccion({ className = "", ...rest }: BotonAccionProps) {
  return (
    <button
      className={`texto-foto foco-campo w-full cursor-pointer rounded-[clamp(18px,3.1vw,40px)] border-4 border-[var(--color-verde-accion)] bg-[color-mix(in_srgb,var(--color-verde-accion)_60%,transparent)] p-[clamp(0.5rem,0.78vw,0.625rem)] text-center text-[clamp(0.9rem,2.03vw,1.62rem)] font-medium tracking-[-0.05em] text-white transition-colors enabled:hover:bg-[color-mix(in_srgb,var(--color-verde-accion)_80%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}
