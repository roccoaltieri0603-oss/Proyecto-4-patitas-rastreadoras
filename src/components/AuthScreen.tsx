import { FormEvent, useState } from "react";
import { ApiError, login, register, type UsuarioAutenticado } from "../api/auth";

interface AuthScreenProps {
  onAuthenticated: (user: UsuarioAutenticado) => void;
}

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function cambiarModo(next: "login" | "registro") {
    setModo(next);
    setError(null);
    setPassword("");
    setConfirmacion("");
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nombre = username.trim();
    if (!nombre) {
      setError("Ingresá tu nombre de usuario.");
      return;
    }
    if (modo === "registro" && password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (modo === "registro" && password !== confirmacion) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      const user = modo === "login" ? await login(nombre, password) : await register(nombre, password);
      onAuthenticated(user);
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.status === 0 ? error.message : error.message);
      } else {
        setError("No se pudo completar la operación. Intentá nuevamente.");
      }
    } finally {
      setEnviando(false);
    }
  }

  const esRegistro = modo === "registro";
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="auth-brand-mark">R</span>
          <div>
            <h1 id="auth-title">RODEO</h1>
            <p>Gestión clara para cada lote y cada decisión de pastoreo.</p>
          </div>
        </div>

        <div className="auth-heading">
          <h2>{esRegistro ? "Crear tu cuenta" : "Bienvenido de nuevo"}</h2>
          <p>{esRegistro ? "Empezá a organizar tu establecimiento." : "Ingresá para continuar con tu establecimiento."}</p>
        </div>

        <form className="auth-form" onSubmit={enviar}>
          <label htmlFor="auth-username">Nombre de usuario</label>
          <input
            id="auth-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            disabled={enviando}
          />

          <label htmlFor="auth-password">Contraseña</label>
          <div className="auth-password-field">
            <input
              id="auth-password"
              type={mostrarPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={esRegistro ? "new-password" : "current-password"}
              required
              disabled={enviando}
            />
            <button type="button" className="auth-password-toggle" onClick={() => setMostrarPassword((value) => !value)}>
              {mostrarPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {esRegistro && (
            <>
              <label htmlFor="auth-confirmacion">Repetir contraseña</label>
              <input
                id="auth-confirmacion"
                type={mostrarPassword ? "text" : "password"}
                value={confirmacion}
                onChange={(event) => setConfirmacion(event.target.value)}
                autoComplete="new-password"
                required
                disabled={enviando}
              />
            </>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={enviando}>
            {enviando ? (esRegistro ? "Creando cuenta…" : "Iniciando sesión…") : esRegistro ? "Crear cuenta" : "Iniciar sesión"}
          </button>
        </form>

        <div className="auth-switch">
          <span>{esRegistro ? "¿Ya tenés una cuenta?" : "¿Todavía no tenés cuenta?"}</span>
          <button type="button" onClick={() => cambiarModo(esRegistro ? "login" : "registro")}>
            {esRegistro ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </div>
      </section>
    </main>
  );
}
