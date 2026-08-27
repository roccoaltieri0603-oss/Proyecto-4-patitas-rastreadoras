import { FormEvent, useState } from "react";
import { ApiError, login, register, type UsuarioAutenticado } from "../api/auth";
import CampoBackdrop from "../components/ui/CampoBackdrop";
import GlassPanel from "../components/ui/GlassPanel";
import PillButton from "../components/ui/PillButton";
import PillInput from "../components/ui/PillInput";
import RodeoLogo from "../components/ui/RodeoLogo";

interface AuthPageProps {
  onAuthenticated: (user: UsuarioAutenticado) => void;
}

type Vista = "bienvenida" | "login" | "registro";

const TITULO_GRANDE =
  "texto-foto text-[clamp(1.5rem,5.31vw,4.25rem)] font-medium leading-tight tracking-[-0.05em] text-white";
const PANEL_COMPLETO = "inset-[clamp(10px,1.95vw,25px)]";

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [vista, setVista] = useState<Vista>("bienvenida");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function irA(siguiente: Vista) {
    setVista(siguiente);
    setError(null);
    setPassword("");
    setMostrarPassword(false);
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cuenta = email.trim();
    if (!cuenta) {
      setError("Ingresá tu e-mail.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      // El backend identifica la cuenta por `username`; le mandamos el e-mail
      // tal cual. No se toca la API.
      const user = vista === "login" ? await login(cuenta, password) : await register(cuenta, password);
      onAuthenticated(user);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : "No se pudo completar la operación. Intentá nuevamente.",
      );
    } finally {
      setEnviando(false);
    }
  }

  if (vista === "bienvenida") {
    return (
      <CampoBackdrop>
        <div className="absolute top-[3.8%] left-1/2 flex w-[65vw] max-w-[832px] -translate-x-1/2 flex-col items-center gap-[clamp(0.75rem,2.97vw,2.4rem)]">
          <p className="texto-foto text-center text-[clamp(1.6rem,6.02vw,4.8rem)] font-medium leading-none tracking-[-0.05em] text-white">
            Bienvenido a
          </p>
          <RodeoLogo className="w-[clamp(13rem,63.7vw,51rem)]" />
        </div>

        <GlassPanel className="top-[44.2%] right-[clamp(10px,1.95vw,25px)] bottom-[clamp(10px,2.6vw,22px)] left-[clamp(10px,1.95vw,25px)]">
          <div className="flex h-full flex-col justify-center gap-[clamp(1.25rem,5vw,4rem)] px-[clamp(0.75rem,1.7vw,1.4rem)]">
            <div className={`flex flex-col ${TITULO_GRANDE}`}>
              <span className="self-start">Pastoreo inteligente,</span>
              <span className="self-end text-right">al alcance de tus manos</span>
            </div>
            <div className="flex flex-wrap justify-center gap-[clamp(0.75rem,3.1vw,2.5rem)]">
              <PillButton onClick={() => irA("login")}>Iniciar sesion</PillButton>
              <PillButton onClick={() => irA("registro")}>Crear cuenta</PillButton>
            </div>
          </div>
        </GlassPanel>
      </CampoBackdrop>
    );
  }

  const esRegistro = vista === "registro";
  return (
    <CampoBackdrop>
      <GlassPanel className={PANEL_COMPLETO}>
        {/* overflow-y-auto: al aparecer el mensaje de error el formulario crece
            y sin esto el botón queda cortado contra el borde del panel. */}
        <div className="flex h-full flex-col overflow-y-auto px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.75rem,2vw,1.5rem)]">
          <h1 className={`shrink-0 pl-[clamp(0.5rem,2vw,1.75rem)] ${TITULO_GRANDE}`}>
            {esRegistro ? "Crear Cuenta" : "Iniciar sesion"}
          </h1>

          <form
            className="mx-auto my-auto flex w-full max-w-[816px] shrink-0 flex-col gap-[clamp(0.75rem,3.4vw,2.7rem)]"
            onSubmit={enviar}
            noValidate
          >
            <PillInput
              id="auth-email"
              etiqueta="Introduce tu e-mail"
              placeholder="Ej: tunombre@mail.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              // Sin type="email": la cuenta viaja como `username` y las cuentas
              // viejas del backend pueden no tener formato de mail.
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={enviando}
            />

            <PillInput
              id="auth-password"
              etiqueta="Introduce tu contraseña"
              placeholder="********"
              type={mostrarPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={esRegistro ? "new-password" : "current-password"}
              required
              disabled={enviando}
              accion={
                <button
                  type="button"
                  className="foco-campo cursor-pointer rounded border-0 bg-transparent text-[clamp(0.7rem,1.4vw,1.1rem)] text-white underline hover:text-lima"
                  onClick={() => setMostrarPassword((valor) => !valor)}
                >
                  {mostrarPassword ? "Ocultar" : "Mostrar"}
                </button>
              }
            />

            {error && (
              <p
                role="alert"
                className="rounded-2xl border-2 border-white/70 bg-red-900/40 px-[clamp(0.75rem,2vw,1.5rem)] py-[clamp(0.5rem,1.2vw,0.9rem)] text-center text-[clamp(0.85rem,1.9vw,1.5rem)] text-white"
              >
                {error}
              </p>
            )}

            <div className="flex justify-center">
              <PillButton type="submit" disabled={enviando}>
                {enviando
                  ? esRegistro
                    ? "Creando cuenta…"
                    : "Entrando…"
                  : esRegistro
                    ? "Crear cuenta"
                    : "Iniciar sesion"}
              </PillButton>
            </div>
          </form>

          <p className="texto-foto shrink-0 text-center text-[clamp(0.85rem,2.66vw,2.125rem)] font-medium tracking-[-0.05em] text-white">
            {esRegistro ? "Ya tienes una cuenta? Inicia sesion " : "No tienes una cuenta? Crea una "}
            <button
              type="button"
              className="foco-campo cursor-pointer rounded border-0 bg-transparent p-0 text-inherit underline hover:text-lima"
              onClick={() => irA(esRegistro ? "login" : "registro")}
            >
              aqui.
            </button>
          </p>
        </div>
      </GlassPanel>
    </CampoBackdrop>
  );
}
