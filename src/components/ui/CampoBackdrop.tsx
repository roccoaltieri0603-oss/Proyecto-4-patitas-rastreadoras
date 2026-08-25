import type { ReactNode } from "react";

interface CampoBackdropProps {
  children: ReactNode;
}

/**
 * Fondo a sangre de las pantallas de acceso.
 *
 * El diseño usa una foto de campo que todavía no está en el repo, así que se
 * dibuja un degradado con sus mismos tonos: cielo, sierra al fondo y pastizal
 * seco. Para usar la foto real, ver `src/assets/README.md`.
 *
 * Va como `style` y no como clase de Tailwind porque Tailwind lee el código de
 * forma estática: una clase armada con un template literal nunca se generaría.
 */
const FOTO_CAMPO = [
  "linear-gradient(180deg",
  "#7fb2dd 0%",
  "#9cc4e3 18%",
  "#c2d6e2 32%",
  "#a3ad95 46%",
  "#9aa07f 55%",
  "#b5a468 68%",
  "#a89355 80%",
  "#8a7c41 100%)",
].join(",");

export default function CampoBackdrop({ children }: CampoBackdropProps) {
  return (
    <main
      className="relative h-full min-h-screen w-full overflow-hidden bg-cover bg-center font-display"
      style={{ backgroundImage: FOTO_CAMPO }}
    >
      {children}
    </main>
  );
}
