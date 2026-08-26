import type { ReactNode } from "react";

interface TarjetaVidrioProps {
  children: ReactNode;
  className?: string;
}

/**
 * Tarjeta interior de la sidebar de onboarding.
 *
 * Usa el vidrio más denso del diseño (`rgba(168,190,196,.5)`), pensado para ir
 * apoyado sobre el panel exterior, que es el mismo vidrio pero al 20%.
 * Medidas del Figma: radio 40 y padding 20 sobre un frame de 1280px.
 */
export default function TarjetaVidrio({ children, className = "" }: TarjetaVidrioProps) {
  return (
    <div
      className={`flex w-full flex-col rounded-[clamp(18px,3.1vw,40px)] bg-[var(--color-vidrio-fuerte)] p-[clamp(0.85rem,1.56vw,1.25rem)] ${className}`}
    >
      {children}
    </div>
  );
}
