import { useId, useState } from "react";
import { ApiError } from "../api/client";
import { buscarLocalidades, type Localidad } from "../api/localidades";

interface BuscadorLocalidadProps {
  /** Se llama con la localidad elegida para que el mapa vuele hasta ahí. */
  onLocalidad: (localidad: Localidad) => void;
}

/**
 * Buscador de localidad del paso 1 del onboarding.
 *
 * Flota sobre el mapa, arriba y centrado sobre el espacio que deja la sidebar,
 * como en el Figma. Sirve para una sola cosa: llevar el mapa cerca del campo
 * antes de que el usuario dibuje su límite. No guarda nada.
 *
 * El botón "Continuar" aparece recién cuando hay texto escrito, igual que en el
 * diseño: sin nada que buscar no hay acción posible.
 *
 * Nunca inventa una coordenada. Si Nominatim no devuelve resultados se dice que
 * no se encontró y el mapa se queda donde estaba; no se cae a una posición por
 * defecto ni se adivina la provincia.
 */
export default function BuscadorLocalidad({ onLocalidad }: BuscadorLocalidadProps) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [encontrada, setEncontrada] = useState<Localidad | null>(null);

  const hayTexto = texto.trim().length > 0;

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!hayTexto || buscando) return;

    setBuscando(true);
    setError(null);
    setEncontrada(null);
    try {
      const resultados = await buscarLocalidades(texto);
      const primera = resultados[0];
      if (!primera) {
        setError("No encontramos esa localidad. Probá agregando la provincia o el país.");
        return;
      }
      // Nominatim ordena por relevancia: la primera es la mejor coincidencia.
      // Se muestra su nombre completo abajo para que el usuario confirme que el
      // mapa fue al lugar correcto y no a un homónimo de otra provincia.
      setEncontrada(primera);
      onLocalidad(primera);
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : "No se pudo buscar la localidad.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    // Se ancla al espacio libre que deja la sidebar flotante del onboarding
    // (mismo `clamp` de ancho que usa `Sidebar.tsx`) en vez de centrarse en la
    // pantalla: centrado quedaría medio tapado por el degradado oscuro.
    <form
      onSubmit={buscar}
      className="absolute top-[clamp(1rem,2.5vw,2rem)] right-[clamp(1rem,2vw,2rem)] left-[calc(clamp(280px,33.8vw,433px)+2rem)] z-[1000] flex max-w-[44rem] flex-col gap-[clamp(0.5rem,1vw,0.9rem)] rounded-[clamp(14px,1.6vw,20px)] bg-[var(--color-vidrio)] p-[clamp(0.75rem,1.4vw,1.15rem)] backdrop-blur-[6px]"
    >
      <label
        htmlFor={id}
        className="texto-foto px-[clamp(0.4rem,0.8vw,0.65rem)] text-[clamp(0.95rem,1.6vw,1.35rem)] font-medium tracking-[-0.03em] text-white"
      >
        Introduce la localidad donde se encuentra tu campo
      </label>

      <div className="flex items-center gap-[clamp(0.5rem,1vw,0.9rem)]">
        <input
          id={id}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          disabled={buscando}
          autoComplete="off"
          placeholder="Ej: Campana, Buenos Aires, Argentina"
          className="campo-pill foco-campo h-[clamp(2.2rem,3.1vw,2.8rem)] min-w-0 flex-1 rounded-full border-2 border-white bg-black/25 px-[clamp(0.9rem,1.5vw,1.3rem)] text-[clamp(0.85rem,1.3vw,1.05rem)] font-medium tracking-[-0.03em] text-white outline-none placeholder:text-white/60 disabled:opacity-60"
        />
        {/* El botón aparece sólo con texto escrito, como en el diseño. */}
        {hayTexto && (
          <button
            type="submit"
            disabled={buscando}
            className="texto-foto foco-campo h-[clamp(2.2rem,3.1vw,2.8rem)] flex-none cursor-pointer rounded-full border-2 border-[var(--color-verde-accion)] bg-[color-mix(in_srgb,var(--color-verde-accion)_60%,transparent)] px-[clamp(1rem,2vw,1.8rem)] text-[clamp(0.85rem,1.3vw,1.05rem)] font-medium tracking-[-0.03em] text-white transition-colors enabled:hover:bg-[color-mix(in_srgb,var(--color-verde-accion)_80%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buscando ? "Buscando..." : "Continuar"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="texto-foto m-0 px-[clamp(0.4rem,0.8vw,0.65rem)] text-[clamp(0.75rem,1.1vw,0.9rem)] text-white"
        >
          {error}
        </p>
      )}

      {encontrada && !error && (
        <p className="texto-foto m-0 px-[clamp(0.4rem,0.8vw,0.65rem)] text-[clamp(0.75rem,1.1vw,0.9rem)] text-white/80">
          Mapa centrado en {encontrada.nombre}
        </p>
      )}
    </form>
  );
}
