import type { InputHTMLAttributes, ReactNode } from "react";

interface PillInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Texto que va arriba del campo, como en el diseño. */
  etiqueta: string;
  id: string;
  /** Control opcional dentro de la píldora, a la derecha. El diseño reserva ese espacio. */
  accion?: ReactNode;
}

/**
 * Campo de texto de las pantallas de acceso: etiqueta grande arriba y un input
 * con forma de píldora, borde blanco y fondo negro al 20%.
 *
 * Las medidas salen del Figma (1280×832) y se expresan en `--figma`: coinciden
 * a ese tamaño y se achican en pantallas más chicas, anchas o bajas.
 */
export default function PillInput({ etiqueta, id, accion, className = "", ...rest }: PillInputProps) {
  return (
    <div className="flex w-full flex-col gap-[clamp(0.3rem,calc(2.27*var(--figma)),1.8rem)]">
      <label
        htmlFor={id}
        className="texto-foto pl-[clamp(0.75rem,calc(2*var(--figma)),1.75rem)] text-[length:clamp(1rem,calc(3.13*var(--figma)),2.5rem)] font-medium tracking-[-0.05em] text-white"
      >
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`campo-pill foco-campo h-[clamp(2.5rem,calc(6.56*var(--figma)),5.25rem)] w-full rounded-full border-[length:clamp(2px,calc(0.31*var(--figma)),4px)] border-white bg-black/25 pl-[clamp(1rem,calc(2.34*var(--figma)),1.875rem)] text-[length:clamp(0.95rem,calc(3.05*var(--figma)),2.44rem)] font-medium tracking-[-0.05em] text-white outline-none placeholder:text-white/75 disabled:opacity-60 ${
            accion ? "pr-[clamp(3rem,calc(6*var(--figma)),4.75rem)]" : "pr-[clamp(1rem,calc(2.34*var(--figma)),1.875rem)]"
          } ${className}`}
          {...rest}
        />
        {accion && (
          <div className="texto-foto absolute top-1/2 right-[clamp(1rem,calc(2.34*var(--figma)),1.875rem)] flex -translate-y-1/2">
            {accion}
          </div>
        )}
      </div>
    </div>
  );
}
