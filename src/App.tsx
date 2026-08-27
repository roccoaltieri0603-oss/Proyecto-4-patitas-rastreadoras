import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getCurrentUser, logout, type UsuarioAutenticado } from "./api/auth";
import CampoBackdrop from "./components/ui/CampoBackdrop";
import RodeoLogo from "./components/ui/RodeoLogo";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import LotePage from "./pages/LotePage";
import "./leaflet-overrides.css";

type AuthStatus = "loading" | "unauthenticated" | "authenticated";

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [usuario, setUsuario] = useState<UsuarioAutenticado | null>(null);

  useEffect(() => {
    let vigente = true;
    getCurrentUser().then((user) => {
      if (!vigente) return;
      setUsuario(user);
      setAuthStatus(user ? "authenticated" : "unauthenticated");
    }).catch(() => {
      if (vigente) setAuthStatus("unauthenticated");
    });
    return () => { vigente = false; };
  }, []);

  async function handleLogout() {
    try { await logout(); } finally { setUsuario(null); setAuthStatus("unauthenticated"); }
  }

  if (authStatus === "loading") return (
    <CampoBackdrop>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-[clamp(1rem,3vw,2.4rem)]"
        aria-live="polite"
      >
        <RodeoLogo className="w-[65vw] max-w-[560px]" />
        <p className="m-0 text-[clamp(1rem,2.2vw,1.75rem)] tracking-[-0.03em] text-white">
          Comprobando tu sesión...
        </p>
      </div>
    </CampoBackdrop>
  );
  if (authStatus === "unauthenticated") return <AuthPage onAuthenticated={(user) => { setUsuario(user); setAuthStatus("authenticated"); }} />;
  if (!usuario) return null;
  return <Routes>
    <Route path="/" element={<HomePage usuario={usuario} onUserUpdated={setUsuario} onLogout={handleLogout} />} />
    <Route path="/lotes/:id" element={usuario.onboardingCompleted ? <LotePage /> : <Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
