import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useEstablecimiento } from "../../hooks/useEstablecimiento";

/**
 * Cáscara de las pantallas de datos (ficha de lote, registro de usos, ganado,
 * equipo). Antes cada una repetía su propio fondo gris y sus propias constantes
 * de estilo; el rediseño las unifica en el degradado de marca.
 *
 * El degradado va en una capa fija detrás del contenido: si fuera el fondo del
 * <main> se estiraría con el scroll y el verde terminaría en cualquier lado.
 */

export const TARJETA = "rounded-2xl border border-white/70 bg-white/85 shadow-[0_4px_16px_rgba(30,58,95,0.07)] backdrop-blur-[2px]";
export const VOLANTA = "mb-1 text-[0.72rem] font-extrabold uppercase tracking-[0.1em] text-[#2f855a]";
export const TITULO_SECCION = "m-0 text-[1.05rem] font-semibold text-gray-900";
export const APAGADO = "text-[0.9rem] text-gray-500";
export const PASTILLA_VERDE =
  "foco-campo inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[var(--color-verde-accion)] px-5 py-2.5 text-[0.9rem] font-medium text-gray-900 transition-colors duration-150 hover:bg-[var(--color-lima)] disabled:cursor-not-allowed disabled:opacity-50";
export const PASTILLA_CLARA =
  "foco-campo inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[0.85rem] font-medium text-gray-900 transition-colors duration-150 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

const FONDO =
  "radial-gradient(120% 95% at 0% 100%, rgba(121, 218, 88, 0.38) 0%, rgba(121, 218, 88, 0) 58%)," +
  "radial-gradient(115% 95% at 100% 100%, rgba(255, 222, 103, 0.42) 0%, rgba(255, 222, 103, 0) 58%)," +
  "linear-gradient(180deg, #e9eef4 0%, #f1f4f1 55%, #f4f2e8 100%)";

/** Capa de fondo compartida. También la usan los estados de carga y error. */
function Fondo() {
  return <div aria-hidden="true" className="fixed inset-0 -z-10" style={{ background: FONDO }} />;
}

interface PantallaDatosProps {
  volanta: string;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Botón de acción de la esquina superior derecha (Descargar Excel, Agregar miembro...). */
  accion?: ReactNode;
  /** Bloque extra debajo del título, antes del contenido (avisos, rótulos). */
  encabezadoExtra?: ReactNode;
  children: ReactNode;
}

export default function PantallaDatos({ volanta, titulo, subtitulo, accion, encabezadoExtra, children }: PantallaDatosProps) {
  const { establecimientoId } = useEstablecimiento();

  return (
    <>
      <Fondo />
      {/* pb-28: el dock flota fijo abajo y taparía el último bloque sin este aire. */}
      <main className="min-h-screen px-4 pt-7 pb-28 text-gray-800 md:px-[clamp(16px,4vw,64px)]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
          <header className="flex flex-col gap-3">
            <Link to={`/establecimientos/${establecimientoId}`} className="foco-campo w-fit text-[0.85rem] text-gray-500 no-underline hover:text-gray-700">
              ← Volver al mapa
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={VOLANTA}>{volanta}</p>
                <h1 className="m-0 text-[clamp(1.9rem,4vw,2.6rem)] leading-tight font-bold tracking-[-0.02em] text-gray-900">{titulo}</h1>
                {subtitulo && <p className="mt-1 mb-0 text-[0.92rem] text-gray-500">{subtitulo}</p>}
              </div>
              {accion}
            </div>
            {encabezadoExtra}
          </header>
          {children}
        </div>
      </main>
    </>
  );
}

/**
 * Carga y error de las pantallas de datos. Los cuatro archivos tenían la misma
 * copia de este bloque.
 */
export function EstadoDePantalla({ children, role }: { children: ReactNode; role?: "alert" }) {
  return (
    <>
      <Fondo />
      <main role={role} className="grid min-h-screen place-content-center justify-items-center gap-2.5 p-6 text-center text-gray-800">
        {children}
      </main>
    </>
  );
}
