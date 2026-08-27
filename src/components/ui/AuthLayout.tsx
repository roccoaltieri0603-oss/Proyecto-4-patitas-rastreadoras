import type { ReactNode } from "react";

export const AUTH_CARD_CLASS =
  "w-[min(92vw,440px)] rounded-2xl border border-slate-200 bg-white/96 p-8 shadow-[0_20px_55px_rgba(30,58,95,0.12)]";

interface AuthBackdropProps {
  children: ReactNode;
}

/** Fondo de pantalla completa reutilizado por login, registro, onboarding pendiente y la pantalla de carga inicial. */
export function AuthBackdrop({ children }: AuthBackdropProps) {
  return (
    <main className="grid min-h-screen w-full place-items-center bg-[radial-gradient(circle_at_15%_10%,#dbeafe_0,transparent_34%),#f3f4f6]">
      {children}
    </main>
  );
}

interface BrandMarkProps {
  className?: string;
}

/** Logo "R" reutilizable de RODEO. */
export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span
      className={`grid h-[42px] w-[42px] flex-none place-items-center rounded-xl bg-brand text-[1.3rem] font-extrabold tracking-[0.04em] text-white ${className}`}
    >
      R
    </span>
  );
}
