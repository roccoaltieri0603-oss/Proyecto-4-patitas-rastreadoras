import { FormEvent, useState } from "react";
import { ApiError, login, register, type UsuarioAutenticado } from "../api/auth";
import CampoBackdrop from "../components/ui/CampoBackdrop";
import GlassPanel from "../components/ui/GlassPanel";
import IconoOjo from "../components/ui/IconoOjo";
import PillButton from "../components/ui/PillButton";
import PillInput from "../components/ui/PillInput";
import RodeoLogo from "../components/ui/RodeoLogo";

interface PropiedadesPantallaIngreso {
  onAuthenticated: (user: UsuarioAutenticado) => void;
}

type Vista = "bienvenida" | "login" | "registro";

const TITULO_GRANDE =
  "texto-foto text-[length:clamp(1.5rem,calc(5.31*var(--figma)),4.25rem)] font-medium leading-tight tracking-[-0.05em] text-white";
const PANEL_COMPLETO = "inset-[clamp(10px,calc(1.95*var(--figma)),25px)]";

export default function PantallaIngreso({ onAuthenticated }: PropiedadesPantallaIngreso) {
  const [vista, setVista] = useState<Vista>("bienvenida");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function irA(siguiente: Vista) {
    setVista(siguiente);
    setError(null);
    setEmail("");
    setUsername("");
    setConfirmPassword("");
    setPassword("");
    setMostrarPassword(false);
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    const cuenta = email.trim();
    if (cuenta.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cuenta)) {
      setError("Ingresá un e-mail válido.");
      return;
    }
    if (vista === "registro" && !username.trim()) {
      setError("Ingresá tu usuario.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (vista === "registro" && password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      const user = vista === "login" ? await login(cuenta, password) : await register(cuenta, username.trim(), password);
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
        <div className="absolute top-[3.8%] left-1/2 flex w-[65vw] max-w-[832px] -translate-x-1/2 flex-col items-center gap-[clamp(0.75rem,calc(2.97*var(--figma)),2.4rem)]">
          <p className="texto-foto text-center text-[length:clamp(1.6rem,calc(6.02*var(--figma)),4.8rem)] font-medium leading-none tracking-[-0.05em] text-white">
            Bienvenido a
          </p>
          <RodeoLogo className="w-[clamp(13rem,calc(63.7*var(--figma)),51rem)]" />
        </div>

        <GlassPanel className="top-[44.2%] right-[clamp(10px,calc(1.95*var(--figma)),25px)] bottom-[clamp(10px,calc(2.6*var(--figma)),22px)] left-[clamp(10px,calc(1.95*var(--figma)),25px)]">
          {/* El ancho máximo sigue a --figma como la tipografía: sin él, en
              pantallas anchas las dos líneas escalonadas se van a los bordes
              opuestos del panel y queda un hueco en el medio. */}
          <div className="mx-auto flex h-full w-full max-w-[calc(118*var(--figma))] flex-col justify-center gap-[clamp(1.25rem,calc(5*var(--figma)),4rem)] px-[clamp(0.75rem,calc(1.7*var(--figma)),1.4rem)]">
            {/* El escalón es parte del diseño: la segunda línea arranca justo
                debajo de "inteligente". Con la grilla eso queda atado al texto y
                no al ancho del panel, así se ve igual en cualquier pantalla. */}
            <p className={`m-0 grid w-fit grid-cols-[auto_auto] gap-x-[0.25em] self-center ${TITULO_GRANDE}`}>
              <span>Pastoreo</span>
              <span>inteligente,</span>
              <span className="col-start-2">al alcance de tus manos</span>
            </p>
            <div className="flex flex-wrap justify-center gap-[clamp(0.75rem,calc(3.1*var(--figma)),2.5rem)]">
              <PillButton onClick={() => irA("login")}>Iniciar sesion</PillButton>
              <PillButton onClick={() => irA("registro")}>Crear cuenta</PillButton>
            </div>
          </div>
        </GlassPanel>
      </CampoBackdrop>
    );
  }

  const esRegistro = vista === "registro";
  // Un solo estado para los dos campos de contraseña: el ojito de cualquiera
  // de los dos muestra u oculta ambos.
  const botonOjo = (
    <button
      type="button"
      className="foco-campo flex cursor-pointer rounded-full border-0 bg-transparent p-0 text-white hover:text-lima"
      onClick={() => setMostrarPassword((valor) => !valor)}
      aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
      aria-pressed={mostrarPassword}
      disabled={enviando}
    >
      <IconoOjo tachado={mostrarPassword} className="size-[clamp(1.25rem,calc(3*var(--figma)),2.4rem)]" />
    </button>
  );
  return (
    <CampoBackdrop>
      <GlassPanel className={PANEL_COMPLETO}>
        {/* overflow-y-auto: crear cuenta tiene cuatro campos y, sumado al mensaje
            de error, no siempre entra en alto. Scrollea todo el contenido del
            panel; el my-auto del form lo centra cuando sobra lugar sin recortar
            el principio cuando falta. */}
        <div className="sin-barra-scroll flex h-full flex-col overflow-y-auto px-[clamp(1rem,calc(3*var(--figma)),2.5rem)] py-[clamp(0.75rem,calc(2*var(--figma)),1.5rem)]">
          <h1 className={`shrink-0 pl-[clamp(0.5rem,calc(2*var(--figma)),1.75rem)] ${TITULO_GRANDE}`}>
            {esRegistro ? "Crear Cuenta" : "Iniciar sesion"}
          </h1>

          <form
            className="mx-auto my-auto flex w-full max-w-[816px] shrink-0 flex-col gap-[clamp(0.75rem,calc(3.4*var(--figma)),2.7rem)]"
            onSubmit={enviar}
            noValidate
          >
            <PillInput
              id="auth-email"
              etiqueta="Introduce tu e-mail"
              placeholder="Ej: tunombre@mail.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={enviando}
            />

            {esRegistro && <PillInput
              id="auth-username"
              etiqueta="Usuario"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              disabled={enviando}
            />}

            <PillInput
              id="auth-password"
              etiqueta="Introduce tu contraseña"
              placeholder="********"
              type={mostrarPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={esRegistro ? "new-password" : "current-password"}
              minLength={8}
              required
              disabled={enviando}
              accion={botonOjo}
            />

            {esRegistro && <PillInput
              id="auth-confirm-password"
              etiqueta="Confirmar contraseña"
              type={mostrarPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={enviando}
              accion={botonOjo}
            />}

            {error && (
              <p
                role="alert"
                className="rounded-2xlborder-2 border-white/70 bg-red-900/40 px-[clamp(0.75rem,calc(2*var(--figma)),1.5rem)] py-[clamp(0.5rem,calc(1.2*var(--figma)),0.9rem)] text-center text-[length:clamp(0.85rem,calc(1.9*var(--figma)),1.5rem)] text-white"
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

          <p className="texto-foto shrink-0 text-center text-[length:clamp(0.85rem,calc(2.66*var(--figma)),2.125rem)] font-medium tracking-[-0.05em] text-white">
            {esRegistro ? "Ya tienes una cuenta? Inicia sesion " : "No tienes una cuenta? Crea una "}
            <button
              type="button"
              className="foco-campo cursor-pointer rounded border-0 bg-transparent p-0 text-inherit underline hover:text-lima"
              onClick={() => irA(esRegistro ? "login" : "registro")}
              disabled={enviando}
            >
              aqui.
            </button>
          </p>
        </div>
      </GlassPanel>
    </CampoBackdrop>
  );
}
