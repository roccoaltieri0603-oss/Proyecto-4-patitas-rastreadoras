import { FormEvent, useState } from "react";
import { ApiError, login, register, type UsuarioAutenticado } from "../api/auth";
import { AuthBackdrop, AUTH_CARD_CLASS, BrandMark } from "../components/ui/AuthLayout";

interface AuthPageProps {
  onAuthenticated: (user: UsuarioAutenticado) => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-gray-800 outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(42,120,214,0.14)]";

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
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
    <AuthBackdrop>
      <section className={AUTH_CARD_CLASS} aria-labelledby="auth-title">
        <div className="mb-7 flex items-center gap-3">
          <BrandMark />
          <div>
            <h1 id="auth-title" className="m-0 text-[1.35rem] tracking-[0.08em] text-brand">RODEO</h1>
            <p className="mt-0.5 text-[0.82rem] leading-[1.35] text-slate-500">Gestión clara para cada lote y cada decisión de pastoreo.</p>
          </div>
        </div>

        <div>
          <h2 className="m-0 text-[1.45rem] text-brand-deep">{esRegistro ? "Crear tu cuenta" : "Bienvenido de nuevo"}</h2>
          <p className="mt-1.5 leading-[1.45] text-slate-500">{esRegistro ? "Empezá a organizar tu establecimiento." : "Ingresá para continuar con tu establecimiento."}</p>
        </div>

        <form className="mt-6 flex flex-col gap-2" onSubmit={enviar}>
          <label className="mt-1 text-[0.84rem] font-semibold text-slate-700" htmlFor="auth-username">Nombre de usuario</label>
          <input
            id="auth-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            disabled={enviando}
            className={INPUT_CLASS}
          />

          <label className="mt-1 text-[0.84rem] font-semibold text-slate-700" htmlFor="auth-password">Contraseña</label>
          <div className="relative">
            <input
              id="auth-password"
              type={mostrarPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={esRegistro ? "new-password" : "current-password"}
              required
              disabled={enviando}
              className={`${INPUT_CLASS} pr-[74px]`}
            />
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 border-0 bg-transparent text-[0.76rem] text-brand cursor-pointer"
              onClick={() => setMostrarPassword((value) => !value)}
            >
              {mostrarPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {esRegistro && (
            <>
              <label className="mt-1 text-[0.84rem] font-semibold text-slate-700" htmlFor="auth-confirmacion">Repetir contraseña</label>
              <input
                id="auth-confirmacion"
                type={mostrarPassword ? "text" : "password"}
                value={confirmacion}
                onChange={(event) => setConfirmacion(event.target.value)}
                autoComplete="new-password"
                required
                disabled={enviando}
                className={INPUT_CLASS}
              />
            </>
          )}

          {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[0.84rem] text-red-800" role="alert">{error}</p>}

          <button
            className="mt-2.5 cursor-pointer rounded-lg border-0 bg-brand px-3.5 py-2.5 font-bold text-white enabled:hover:bg-brand-dark disabled:cursor-wait disabled:opacity-65"
            type="submit"
            disabled={enviando}
          >
            {enviando ? (esRegistro ? "Creando cuenta…" : "Iniciando sesión…") : esRegistro ? "Crear cuenta" : "Iniciar sesión"}
          </button>
        </form>

        <div className="mt-5.5 flex justify-center gap-1.5 text-[0.84rem] text-slate-500">
          <span>{esRegistro ? "¿Ya tenés una cuenta?" : "¿Todavía no tenés cuenta?"}</span>
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-bold text-brand" onClick={() => cambiarModo(esRegistro ? "login" : "registro")}>
            {esRegistro ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </div>
      </section>
    </AuthBackdrop>
  );
}
