import type { AyudaFecha } from "../../estimacion/presentacion";

/**
 * Una frase con una fecha subrayada: al pasar el cursor, al enfocarla con el
 * teclado o al tocarla, aparece un cartel que explica de dónde sale. Sin ayuda
 * (o si el texto no está en la frase) se muestra la frase tal cual.
 */
export default function FraseConAyuda({ frase, ayuda }: { frase: string; ayuda: AyudaFecha | null }) {
  const indice = ayuda ? frase.indexOf(ayuda.texto) : -1;
  if (!ayuda || indice < 0) return <>{frase}</>;
  return (
    <>
      {frase.slice(0, indice)}
      <span tabIndex={0} className="group relative cursor-help underline decoration-dotted decoration-2 underline-offset-4 outline-none">
        {ayuda.texto}
        <span role="tooltip" className="pointer-events-none invisible absolute bottom-full left-0 z-50 mb-2 w-64 max-w-[80vw] rounded-lg bg-gray-900 px-3 py-2 text-left text-xs leading-[1.4] font-normal tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100">
          {ayuda.explicacion}
        </span>
      </span>
      {frase.slice(indice + ayuda.texto.length)}
    </>
  );
}
