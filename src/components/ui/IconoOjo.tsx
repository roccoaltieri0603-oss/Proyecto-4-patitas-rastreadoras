interface IconoOjoProps {
  /** Ojo tachado: la acción es ocultar lo que ya se está mostrando. */
  tachado?: boolean;
  className?: string;
}

export default function IconoOjo({ tachado = false, className = "" }: IconoOjoProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      {tachado && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
