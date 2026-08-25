import type { UsuarioAutenticado } from "../api/auth";
import { AuthBackdrop, AUTH_CARD_CLASS, BrandMark } from "../components/ui/AuthLayout";
import Button from "../components/ui/Button";

interface SetupPendingPageProps {
  user: UsuarioAutenticado;
  onLogout: () => void;
}

export default function SetupPendingPage({ user, onLogout }: SetupPendingPageProps) {
  return (
    <AuthBackdrop>
      <section className={`${AUTH_CARD_CLASS} text-center`}>
        <BrandMark className="mx-auto mb-5.5" />
        <p className="text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-accent">Configuración inicial</p>
        <h1 className="m-0 text-[1.45rem] text-brand-deep">Tu cuenta ya está lista, {user.username}.</h1>
        <p className="mt-1.5 leading-normal text-slate-500">Ahora falta configurar tu establecimiento y crear tu primer lote para empezar a usar RODEO.</p>
        <p className="text-[0.88rem] text-slate-500">El próximo paso será dibujar el establecimiento y completar el onboarding desde el mapa.</p>
        <Button variant="secondary" className="mt-6" onClick={onLogout}>Cerrar sesión</Button>
      </section>
    </AuthBackdrop>
  );
}
