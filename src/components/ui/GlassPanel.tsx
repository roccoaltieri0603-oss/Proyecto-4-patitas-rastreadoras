import type { ReactNode } from "react";

interface GlassPanelProps {
  children: ReactNode;
  /** Clases de posición. El diseño lo usa a pantalla casi completa o solo abajo. */
  className?: string;
}

/**
 * Panel de vidrio esmerilado del diseño: `rgba(168,190,196,.2)` con desenfoque
 * de fondo y esquinas muy redondeadas. Lo comparten las tres pantallas de acceso.
 */
export default function GlassPanel({ children, className = "" }: GlassPanelProps) {
  return (
    <section
      className={`absolute overflow-hidden rounded-[clamp(20px,3.1vw,40px)] border border-white/20 bg-[rgba(168,190,196,0.2)] backdrop-blur-[20px] ${className}`}
    >
      {children}
    </section>
  );
}
