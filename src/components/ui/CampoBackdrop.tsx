import type { ReactNode } from "react";
import campo from "../../assets/campo.jpg";

interface CampoBackdropProps {
  children: ReactNode;
}

/**
 * Fondo a sangre de las pantallas de acceso: la foto de campo del Figma.
 *
 * El archivo es el mismo `cow.jpeg` que estaba en el repo del prototipo
 * (bs2896-stack/RODEO-prototipo-1); es la foto que usa el diseño, así que se
 * trajo tal cual en vez de volver a exportarla.
 *
 * `bg-[#9cbcd8]` es el celeste del cielo de la foto: se ve mientras la imagen
 * carga y evita el flash blanco debajo del vidrio.
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
