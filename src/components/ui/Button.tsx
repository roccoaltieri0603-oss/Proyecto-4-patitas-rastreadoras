import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "link" | "link-danger";
type ButtonSize = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "border-0 bg-brand text-white hover:enabled:bg-brand-dark",
  secondary: "border-0 bg-gray-200 text-gray-800 hover:enabled:bg-gray-300",
  danger: "border-0 bg-red-100 text-red-700 hover:enabled:bg-red-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed",
  link: "border-0 bg-transparent p-0 text-brand text-[0.82rem] underline",
  "link-danger": "border-0 bg-transparent p-0 text-red-700 text-[0.82rem] underline",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-3.5 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-xs",
};

/** Botón reutilizable: unifica todas las variantes (primary/secondary/danger/link) que antes eran clases CSS sueltas (.btn, .btn-primary, etc). */
export default function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonProps) {
  const isLink = variant === "link" || variant === "link-danger";
  const shape = isLink ? "cursor-pointer" : `rounded-md cursor-pointer transition-colors disabled:cursor-not-allowed ${SIZE_CLASSES[size]}`;
  return <button className={`${shape} ${VARIANT_CLASSES[variant]} ${className}`} {...rest} />;
}
