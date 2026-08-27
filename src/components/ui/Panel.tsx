import type { HTMLAttributes } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement>;

/** Contenedor reutilizable con el estilo de tarjeta (.panel) usado en toda la sidebar. */
export default function Panel({ className = "", ...rest }: PanelProps) {
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3.5 ${className}`}
      {...rest}
    />
  );
}
