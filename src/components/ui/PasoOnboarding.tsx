interface PasoOnboardingProps {
  etiqueta: string;
  /** Un paso pendiente se muestra atenuado, como en el diseño. */
  activo: boolean;
  completado?: boolean;
}

/**
 * Fila de un paso del onboarding: el texto a la izquierda y un círculo a la
 * derecha que se rellena cuando el paso está hecho.
 */
export default function PasoOnboarding({ etiqueta, activo, completado = false }: PasoOnboardingProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span
        className={`text-[clamp(0.9rem,2.03vw,1.62rem)] font-medium tracking-[-0.05em] ${
          activo || completado ? "text-white" : "text-white/20"
        }`}
      >
        {etiqueta}
      </span>
      <span
        aria-hidden="true"
        className={`flex size-[clamp(1rem,1.95vw,1.5625rem)] flex-none items-center justify-center rounded-full border-2 ${
          completado
            ? "border-[var(--color-verde-accion)] bg-[var(--color-verde-accion)]"
            : activo
              ? "border-white"
              : "border-white/25"
        }`}
      />
    </div>
  );
}
