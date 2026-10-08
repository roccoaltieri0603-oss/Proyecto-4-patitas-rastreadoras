import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { buscarLugar, type LugarEncontrado } from "../../api/lugares";

const ZOOM_MAXIMO_AL_IR = 14;

/**
 * Buscador flotante para llevar el mapa a un lugar (ej. "La Pampa") antes de
 * dibujar el establecimiento. Busca al enviar, no mientras se escribe: el
 * servicio público de geocodificación no admite autocompletado.
 */
export default function BuscadorLugar() {
  const mapa = useMap();
  const contenedor = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<LugarEncontrado[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Que clicks, arrastres y scroll sobre el buscador no muevan el mapa.
  useEffect(() => {
    if (!contenedor.current) return;
    L.DomEvent.disableClickPropagation(contenedor.current);
    L.DomEvent.disableScrollPropagation(contenedor.current);
  }, []);

  async function buscar(evento: FormEvent) {
    evento.preventDefault();
    const consulta = texto.trim();
    if (consulta.length < 3) {
      setError("Escribí al menos 3 letras.");
      setResultados(null);
      return;
    }
    setBuscando(true);
    setError(null);
    try {
      const lugares = await buscarLugar(consulta);
      setResultados(lugares);
      if (lugares.length === 1) ir(lugares[0]);
    } catch (e) {
      setResultados(null);
      setError(e instanceof Error ? e.message : "No se pudo buscar el lugar.");
    } finally {
      setBuscando(false);
    }
  }

  function ir(lugar: LugarEncontrado) {
    const [sur, oeste, norte, este] = lugar.limites;
    mapa.flyToBounds(L.latLngBounds([sur, oeste], [norte, este]), { maxZoom: ZOOM_MAXIMO_AL_IR, duration: 1.2 });
    setResultados(null);
  }

  return (
    // El sidebar flota sobre la izquierda del mapa: se centra en el tramo visible
    // (a su derecha) y se deja lugar al zoom de la esquina.
    <div className="pointer-events-none absolute top-4 right-16 left-[calc(clamp(480px,46vw,600px)+1.5rem)] z-[1000] flex justify-center font-display max-md:left-4">
      <div ref={contenedor} className="pointer-events-auto w-full max-w-[38rem]">
        <form
          onSubmit={buscar}
          role="search"
          className="flex items-center gap-2 rounded-full border-2 border-white/85 bg-[rgba(31,51,25,0.78)] py-1.5 pr-1.5 pl-5 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-[18px] transition-colors focus-within:border-[var(--color-lima)]"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-none text-white/60">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
            <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscá dónde queda tu campo: provincia, ciudad o paraje"
            aria-label="Buscar un lugar en el mapa"
            maxLength={120}
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[0.95rem] text-white outline-none placeholder:text-white/55 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            disabled={buscando}
            className="flex h-11 flex-none cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-[var(--color-lima)] px-6 text-[0.95rem] font-bold text-[var(--color-campo-900)] shadow-[0_3px_10px_rgba(121,218,88,0.45)] transition-all duration-200 hover:enabled:-translate-y-0.5 hover:enabled:bg-[var(--color-verde-accion)] active:enabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {buscando && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="animate-spin">
                <path d="M13.5 8A5.5 5.5 0 1 1 11.8 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </form>

        {(error || resultados) && (
          <div className="mt-2 overflow-hidden rounded-3xl border-2 border-white/85 bg-[rgba(31,51,25,0.82)] text-sm text-white shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-[18px]" role="status">
            {error && <p className="m-0 px-5 py-3 text-[#ffb4a8]">{error}</p>}
            {resultados && resultados.length === 0 && (
              <p className="m-0 px-5 py-3 text-white/75">Sin resultados en Argentina para “{texto.trim()}”.</p>
            )}
            {resultados && resultados.length > 1 && (
              <ul className="m-0 list-none p-1.5">
                {resultados.map((lugar) => (
                  <li key={`${lugar.latitud},${lugar.longitud}`}>
                    <button
                      type="button"
                      onClick={() => ir(lugar)}
                      className="w-full cursor-pointer rounded-2xl border-0 bg-transparent px-3.5 py-2.5 text-left text-white/90 transition-colors hover:bg-white/15"
                    >
                      {lugar.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
