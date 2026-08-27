import type { ReactNode } from "react";
import campo from "../../assets/campo.svg";

interface CampoBackdropProps {
  children: ReactNode;
}

/**
 * Fondo a sangre de las pantallas de acceso.
 *
 * El paisaje está dibujado en `src/assets/campo.svg` porque la foto del Figma
 * no se pudo exportar. Para cambiarlo por la foto real basta con reemplazar ese
 * import; ver `src/assets/README.md`.
 */
export default function CampoBackdrop({ children }: CampoBackdropProps) {
  return (
    // transform-gpu promueve el fondo a su propia capa. El panel de vidrio lleva
    // backdrop-filter encima; sin la capa aparte el navegador vuelve a desenfocar
    // el fondo entero en cada repintado y la pantalla se siente pesada.
    <main
      className="relative h-full min-h-screen w-full transform-gpu overflow-hidden bg-[#9cbcd8] bg-cover bg-center font-display"
      style={{ backgroundImage: `url(${campo})` }}
    >
      {children}
    </main>
  );
}
