import type { ReactNode } from "react";

export const MODAL_CARD_CLASS =
  "flex w-80 flex-col gap-2.5 rounded-lg bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]";

interface ModalProps {
  onDismiss: () => void;
  children: ReactNode;
}

/** Overlay reutilizable para modales: centra la tarjeta y cierra al hacer click afuera. El contenido (children) define si es un <div> o un <form>. */
export default function Modal({ onDismiss, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      onMouseDown={onDismiss}
    >
      {children}
    </div>
  );
}
