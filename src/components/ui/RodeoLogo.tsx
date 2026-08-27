import logo from "../../assets/rodeo-logo.svg";

interface RodeoLogoProps {
  /** El ancho lo pone cada pantalla: no hay uno solo en el diseño. */
  className?: string;
}

/**
 * Marca RODEO: las cinco fichas verdes con la letra en crema.
 *
 * Es el SVG exportado del Figma tal cual (`Rodeo Layout.svg` en el repo del
 * prototipo). Antes acá había cinco `<span>` con las letras imitadas por CSS
 * porque el archivo no estaba en este repo; con el original a mano no tiene
 * sentido sostener la imitación.
 */
export default function RodeoLogo({ className = "" }: RodeoLogoProps) {
  return (
    <img
      src={logo}
      alt="RODEO"
      // drop-shadow: sobre el cielo claro de la foto el verde pierde el borde.
      className={`h-auto max-w-full drop-shadow-[0_2px_14px_rgba(31,51,25,0.28)] ${className}`}
    />
  );
}
