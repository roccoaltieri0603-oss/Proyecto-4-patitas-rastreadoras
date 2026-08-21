import type { UsuarioAutenticado } from "../api/auth";

interface SetupPendingScreenProps {
  user: UsuarioAutenticado;
  onLogout: () => void;
}

export default function SetupPendingScreen({ user, onLogout }: SetupPendingScreenProps) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="auth-brand-mark">R</span>
        <p className="setup-kicker">Configuración inicial</p>
        <h1>Tu cuenta ya está lista, {user.username}.</h1>
        <p>Ahora falta configurar tu establecimiento y crear tu primer lote para empezar a usar RODEO.</p>
        <p className="setup-muted">El próximo paso será dibujar el establecimiento y completar el onboarding desde el mapa.</p>
        <button className="btn btn-secondary" onClick={onLogout}>Cerrar sesión</button>
      </section>
    </main>
  );
}
