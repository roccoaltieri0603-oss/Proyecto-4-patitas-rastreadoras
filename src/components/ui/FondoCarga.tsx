import fondoCarga from "../../assets/carga-rodeo.jpg";

interface FondoCargaProps {
  /** Qué se está esperando. Va abajo, chico, y lo anuncian los lectores de pantalla. */
  mensaje: string;
}

/**
 * Pantalla de carga: la imagen del Figma con el wordmark RODEO sobre el campo.
 *
 * El logo viene dentro de la imagen (es la exportación del diseño), así que no
 * se le superpone `RodeoLogo`. Se recorta con `object-cover` centrado: en
 * pantallas muy angostas (celular vertical) los costados del logo pueden
 * quedar afuera. `bg-[#2f5868]` es el azul del cielo de la imagen, para que no
 * haya un flash blanco mientras carga.
 */
export default function FondoCarga({ mensaje }: FondoCargaProps) {
  return (
    <main className="relative h-full min-h-screen w-full overflow-hidden bg-[#2f5868] font-display">
      <img src={fondoCarga} alt="RODEO" className="absolute inset-0 h-full w-full object-cover" />
      <p
        aria-live="polite"
        className="texto-foto absolute right-0 bottom-[6%] left-0 m-0 text-center text-[clamp(1rem,1.6vw,1.375rem)] tracking-[-0.03em] text-white"
      >
        {mensaje}
      </p>
    </main>
  );
}
