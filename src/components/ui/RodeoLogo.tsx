import logo from "../../assets/rodeo-logo.svg";

interface RodeoLogoProps {
  className?: string;
}

/**
 * Marca RODEO: las cinco fichas verdes con la letra en crema.
 *
 * Es el SVG exportado del Figma tal cual (`Rodeo Layout.svg` en el repo del
 * prototipo). Antes acá había cinco `<span>` con las letras imitadas por CSS
 * porque el archivo no estaba en este repo; con el original a mano no tiene
 * sentido sostener la imitación.
 *
 * El ancho por defecto (63.7vw sobre un frame de 1280px) es el que ocupa en la
 * pantalla de bienvenida del diseño. `max-w` lo frena para que no se desborde
 * en pantallas anchas.
 */
export default function RodeoLogo({ className = "" }: RodeoLogoProps) {
  return (
    <img
      src={logo}
      alt="RODEO"
      // drop-shadow: sobre el cielo claro de la foto el verde pierde el borde.
      className={`h-auto w-[clamp(13rem,63.7vw,51rem)] max-w-full drop-shadow-[0_2px_14px_rgba(31,51,25,0.28)] ${className}`}
    />
  );
}
