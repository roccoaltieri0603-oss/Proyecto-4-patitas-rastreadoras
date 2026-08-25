import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getCurrentUser, logout, type UsuarioAutenticado } from "./api/auth";
import { AuthBackdrop, BrandMark } from "./components/ui/AuthLayout";
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
    <AuthBackdrop>
      <div className="flex flex-col items-center gap-3 text-slate-500" aria-live="polite">
        <BrandMark />
        <p className="m-0">Comprobando tu sesión...</p>
      </div>
    </AuthBackdrop>
  );
  if (authStatus === "unauthenticated") return <AuthPage onAuthenticated={(user) => { setUsuario(user); setAuthStatus("authenticated"); }} />;
  if (!usuario) return null;
  return <Routes>
    <Route path="/" element={<HomePage usuario={usuario} onUserUpdated={setUsuario} onLogout={handleLogout} />} />
    <Route path="/lotes/:id" element={usuario.onboardingCompleted ? <LotePage /> : <Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
