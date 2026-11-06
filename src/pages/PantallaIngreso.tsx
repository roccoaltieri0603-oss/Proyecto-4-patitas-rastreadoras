import { type FormEvent, type InputHTMLAttributes, type ReactNode, useState } from "react";
import { ApiError, login, register, type UsuarioAutenticado } from "../api/auth";
import fotoIngreso from "../assets/ingreso-vaca.jpg";
import logoRodeo from "../assets/rodeo-logo.svg";
import marcaRodeo from "../assets/rodeo-marca.svg";
import IconoOjo from "../components/ui/IconoOjo";

interface PropiedadesPantallaIngreso {
  onAuthenticated: (user: UsuarioAutenticado) => void;
}

type Vista = "login" | "registro";

/*
 * Medidas del frame "login" del Figma (1280×832). Se respetan en píxeles: la
 * columna del formulario mide 400 px de ancho en cualquier pantalla y la foto
 * ocupa el 39,22 % del ancho (502 de 1280). Debajo de `md` la foto se oculta y
 * el formulario queda solo sobre el fondo oscuro.
 *
 * Los espacios entre bloques son los "Espacio" del auto layout. Cada campo del
 * frame mide 90 px aunque su contenido visible mide 78 (la ayuda está oculta):
 * esos 12 px de más se suman al espacio que sigue al campo.
 */
const BOTON_CLARO =
  "foco-campo flex h-12 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-white/95 px-[26px] text-[18px] leading-[22px] font-medium text-landing-tinta transition-colors hover:bg-white disabled:cursor-default disabled:opacity-60";
const BOTON_CONTORNO =
  "foco-campo flex h-[52px] w-full cursor-pointer items-center justify-center rounded-full border-2 border-white/95 bg-white/4 px-[26px] text-[18px] leading-[22px] font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-60";
const LINK_VERDE =
  "foco-campo cursor-pointer rounded border-0 bg-transparent p-0 font-medium text-verde-accion hover:underline disabled:cursor-default";

interface CampoAccesoProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  etiqueta: string;
  /** Control dentro de la píldora, a la derecha (el ojito de la contraseña). */
  accion?: ReactNode;
  className?: string;
}

/** "Login / Campo de texto" del Figma: etiqueta arriba y caja píldora de 50 px. */
function CampoAcceso({ id, etiqueta, accion, className = "", ...rest }: CampoAccesoProps) {
  return (
    <div className={`flex w-full flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-base leading-5 font-medium text-white">
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`campo-acceso h-[50px] w-full rounded-full border-2 border-white/95 bg-white/8 pl-5 text-base leading-5 font-normal text-white outline-none transition-colors placeholder:text-white/70 focus:border-verde-accion disabled:opacity-60 ${
            accion ? "pr-12" : "pr-5"
          }`}
          {...rest}
        />
        {accion && <div className="absolute top-1/2 right-4 flex -translate-y-1/2">{accion}</div>}
      </div>
    </div>
  );
}

export default function PantallaIngreso({ onAuthenticated }: PropiedadesPantallaIngreso) {
  const [vista, setVista] = useState<Vista>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function irA(siguiente: Vista) {
    setVista(siguiente);
    setError(null);
    setAviso(null);
    setEmail("");
    setUsername("");
    setConfirmPassword("");
    setPassword("");
    setMostrarPassword(false);
  }

  // Ni la recuperación de contraseña ni el pedido de demo existen todavía en
  // el backend. Los botones están porque son parte del diseño, pero avisan en
  // vez de simular un envío que no ocurre.
  function avisarNoDisponible(que: string) {
    setError(null);
    setAviso(`${que} todavía no está disponible.`);
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    setAviso(null);
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

  const esRegistro = vista === "registro";
  // Un solo estado para los dos campos de contraseña: el ojito de cualquiera
  // de los dos muestra u oculta ambos.
  const botonOjo = (
    <button
      type="button"
      className="foco-campo flex cursor-pointer rounded-full border-0 bg-transparent p-0 text-white/70 hover:text-verde-accion"
      onClick={() => setMostrarPassword((valor) => !valor)}
      aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
      aria-pressed={mostrarPassword}
      disabled={enviando}
    >
      <IconoOjo tachado={mostrarPassword} className="size-5" />
    </button>
  );

  return (
    <main className="relative flex h-full min-h-screen w-full overflow-hidden bg-landing-oscuro font-display text-white">
      {/* Luz ambiente: 700×700 en (700, −300) del frame, verde al 10 % con blur de 110 px. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-300px] left-[54.69%] size-[700px] bg-[rgba(150,235,125,0.1)] blur-[110px]"
      />

      <div className="relative hidden w-[39.22%] shrink-0 md:block">
        {/* En el frame la foto mide 502×891 con top −54: sobran 59 px de alto y
            se corren 54 hacia arriba, de ahí el 91,5 % vertical. */}
        <img src={fotoIngreso} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_91.5%]" />
        <img src={marcaRodeo} alt="" className="absolute top-7 left-7 h-auto w-[46px]" />
      </div>

      {/* overflow-y-auto + m-auto: centra el formulario cuando sobra alto y lo
          deja scrollear sin recortar el principio cuando falta (el registro
          tiene cuatro campos). El pl de 54 px ubica la columna en x = 718 como
          en el frame. */}
      <section className="sin-barra-scroll relative flex h-screen flex-1 flex-col overflow-y-auto px-6 py-10 md:pr-0 md:pl-[54px]">
        <form className="m-auto flex w-full max-w-[400px] flex-col" onSubmit={enviar} noValidate>
          <h1 className="m-0 text-[34px] leading-[45px] font-medium tracking-[-0.04em] text-white/70">
            {esRegistro ? "Creá tu cuenta en" : "Bienvenido a"}
          </h1>
          <img src={logoRodeo} alt="RODEO" className="mt-[10px] h-auto w-[300px] max-w-full" />
          <p className="m-0 mt-5 text-base leading-[1.4] text-white/60">
            {esRegistro
              ? "Registrate para cargar tus lotes, tu ganado y seguir el estado de tus pasturas."
              : "Ingresá a tu cuenta para ver tus lotes, tu ganado y el estado de tus pasturas."}
          </p>

          <CampoAcceso
            id="auth-email"
            className="mt-9"
            etiqueta="E-mail"
            placeholder="tunombre@mail.com"
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

          {esRegistro && (
            <CampoAcceso
              id="auth-username"
              className="mt-[30px]"
              etiqueta="Usuario"
              placeholder="tunombre"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={enviando}
            />
          )}

          <CampoAcceso
            id="auth-password"
            className="mt-[30px]"
            etiqueta="Contraseña"
            placeholder="••••••••"
            type={mostrarPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={esRegistro ? "new-password" : "current-password"}
            minLength={8}
            required
            disabled={enviando}
            accion={botonOjo}
          />

          {esRegistro && (
            <CampoAcceso
              id="auth-confirm-password"
              className="mt-[30px]"
              etiqueta="Confirmar contraseña"
              placeholder="••••••••"
              type={mostrarPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={enviando}
              accion={botonOjo}
            />
          )}

          {!esRegistro && (
            <div className="mt-[22px] text-right text-sm leading-[19px]">
              <button
                type="button"
                className={LINK_VERDE}
                onClick={() => avisarNoDisponible("La recuperación de contraseña")}
                disabled={enviando}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="m-0 mt-5 rounded-2xl border border-red-300/60 bg-red-500/15 px-4 py-2.5 text-center text-sm leading-[19px] text-white"
            >
              {error}
            </p>
          )}
          {aviso && (
            <p
              role="status"
              className="m-0 mt-5 rounded-2xl border border-white/30 bg-white/8 px-4 py-2.5 text-center text-sm leading-[19px] text-white/80"
            >
              {aviso}
            </p>
          )}

          <button type="submit" className={`${BOTON_CLARO} ${esRegistro ? "mt-10" : "mt-7"}`} disabled={enviando}>
            {enviando
              ? esRegistro
                ? "Creando cuenta…"
                : "Entrando…"
              : esRegistro
                ? "Crear cuenta"
                : "Iniciar sesión"}
          </button>

          {!esRegistro && (
            <button
              type="button"
              className={`${BOTON_CONTORNO} mt-[14px]`}
              onClick={() => avisarNoDisponible("El pedido de demo")}
              disabled={enviando}
            >
              Solicitá una demo
            </button>
          )}

          <p className="m-0 mt-7 text-center text-sm leading-[19px] text-white">
            {esRegistro ? "¿Ya tenés cuenta? " : "¿No tenés cuenta? "}
            <button
              type="button"
              className="foco-campo cursor-pointer rounded border-0 bg-transparent p-0 text-sm leading-[19px] font-normal text-verde-accion underline hover:no-underline disabled:cursor-default"
              onClick={() => irA(esRegistro ? "login" : "registro")}
              disabled={enviando}
            >
              {esRegistro ? "Iniciá sesión" : "Creá una"}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
