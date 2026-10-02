import type { ButtonHTMLAttributes } from "react";
import "./BotonSubdividirIA.css";

interface BotonSubdividirIAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  generando?: boolean;
}

const ICONO_DESTELLOS =
  "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z";

function Letras({ texto }: { texto: string }) {
  return (
    <>
      {texto.split("").map((letra, indice) => (
        <span className="boton-ia-letra" key={`${texto}-${indice}`}>
          {letra === " " ? "\u00a0" : letra}
        </span>
      ))}
    </>
  );
}

export default function BotonSubdividirIA({ generando = false, className = "", ...props }: BotonSubdividirIAProps) {
  return (
    <span className={`boton-ia-wrapper ${className}`}>
      <button
        {...props}
        type={props.type ?? "button"}
        className={`boton-ia ${generando ? "boton-ia-generando" : ""}`}
        aria-label={generando ? "Analizando con IA" : "Subdividir con IA"}
      >
        <svg className="boton-ia-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={ICONO_DESTELLOS} />
        </svg>
        <span className="boton-ia-texto">
          <span className="boton-ia-texto-actual"><Letras texto={generando ? "Analizando..." : "Subdividir con IA"} /></span>
          {generando && <span className="boton-ia-texto-cargando"><Letras texto="Analizando..." /></span>}
        </span>
      </button>
    </span>
  );
}
