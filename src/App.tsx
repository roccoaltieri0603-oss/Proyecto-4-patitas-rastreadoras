import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getCurrentUser, logout, type UsuarioAutenticado } from "./api/auth";
import AuthScreen from "./components/AuthScreen";
import RodeoApp from "./components/RodeoApp";
import LotePage from "./pages/LotePage";
import "./App.css";

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

  if (authStatus === "loading") return <main className="auth-loading" aria-live="polite"><span className="auth-brand-mark">R</span><p>Comprobando tu sesión...</p></main>;
  if (authStatus === "unauthenticated") return <AuthScreen onAuthenticated={(user) => { setUsuario(user); setAuthStatus("authenticated"); }} />;
  if (!usuario) return null;
  return <Routes>
    <Route path="/" element={<RodeoApp usuario={usuario} onUserUpdated={setUsuario} onLogout={handleLogout} />} />
    <Route path="/lotes/:id" element={usuario.onboardingCompleted ? <LotePage /> : <Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
