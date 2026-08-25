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
 * Las medidas salen del Figma (1280px de ancho); los clamp hacen que coincidan
 * a ese ancho y se achiquen bien en pantallas menores.
 */
export default function PillInput({ etiqueta, id, accion, className = "", ...rest }: PillInputProps) {
  return (
    <div className="flex w-full flex-col gap-[clamp(0.4rem,2.27vw,1.8rem)]">
      <label
        htmlFor={id}
        className="pl-[clamp(0.75rem,2vw,1.75rem)] text-[clamp(1rem,3.13vw,2.5rem)] font-medium tracking-[-0.05em] text-white"
      >
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`h-[clamp(2.9rem,6.56vw,5.25rem)] w-full rounded-full border-[clamp(2px,0.31vw,4px)] border-white bg-black/20 pl-[clamp(1rem,2.34vw,1.875rem)] text-[clamp(0.95rem,3.05vw,2.44rem)] font-medium tracking-[-0.05em] text-white outline-none placeholder:text-white/70 focus-visible:border-lima disabled:opacity-60 ${
            accion ? "pr-[clamp(4.5rem,8.1vw,6.5rem)]" : "pr-[clamp(1rem,2.34vw,1.875rem)]"
          } ${className}`}
          {...rest}
        />
        {accion && (
          <div className="absolute top-1/2 right-[clamp(1rem,2.34vw,1.875rem)] -translate-y-1/2">
            {accion}
          </div>
        )}
      </div>
    </div>
  );
}
