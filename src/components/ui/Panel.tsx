import type { HTMLAttributes } from "react";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Sin caja propia: el contenido de una pestaña ya va sobre la tarjeta blanca de la sidebar. */
  plano?: boolean;
}

/** Contenedor reutilizable con el estilo de tarjeta (.panel) usado en toda la sidebar. */
export default function Panel({ className = "", plano = false, ...rest }: PanelProps) {
  const caja = plano ? "" : "rounded-lg border border-gray-200 bg-gray-50 p-3.5";
  return (
    <div
      className={`flex flex-col gap-2.5 ${caja} ${className}`}
      {...rest}
    />
  );
}
