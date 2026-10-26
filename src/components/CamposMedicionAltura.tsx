import type { DatosMedicion, Instrumento, MedicionAltura } from "../api/mediciones";

/**
 * Campos de una medición de altura: instrumento, altura promedio y cantidad de
 * lecturas. Los usan "¿Cómo quedó el lote?" al sacar los animales y "Cargar
 * medición". Se guardan tal cual se midieron; los kilos los calcula la
 * estimación con la conversión de la pastura.
 */

export const ETIQUETA = "text-[0.72rem] font-bold tracking-[0.06em] text-gray-500 uppercase";
export const CAMPO = "mt-1 min-h-[38px] rounded-lg border border-gray-200 bg-white px-3 text-sm";
const LECTURAS_RECOMENDADAS = 20;

export interface ValoresMedicion {
  /** "" es "no se midió". */
  instrumento: Instrumento | "";
  altura: string;
  lecturas: string;
  mediosCm: boolean;
}

export const MEDICION_VACIA: ValoresMedicion = { instrumento: "", altura: "", lecturas: "", mediosCm: false };

export function valoresDeMedicion(medicion: MedicionAltura | null): ValoresMedicion {
  if (!medicion) return MEDICION_VACIA;
  return { instrumento: medicion.instrumento, altura: String(medicion.alturaPromedioCm), lecturas: String(medicion.cantidadLecturas), mediosCm: false };
}

/** Lo que el usuario puede corregir antes de mandar; el backend vuelve a validar todo. */
export function problemaMedicion(valores: ValoresMedicion): string | null {
  if (!valores.instrumento) return null;
  const altura = Number(valores.altura);
  const maximo = valores.mediosCm ? 300 : 150;
  if (valores.altura.trim() === "" || !(altura > 0) || altura > maximo) return `La altura promedio tiene que ser mayor que 0 y de hasta ${maximo} ${valores.mediosCm ? "medios centímetros" : "cm"}.`;
  const lecturas = Number(valores.lecturas);
  if (!Number.isInteger(lecturas) || lecturas < 1 || lecturas > 1000) return "Indicá cuántas lecturas promediaste (un número entero).";
  return null;
}

export function datosDeMedicion(valores: ValoresMedicion): Pick<DatosMedicion, "instrumento" | "alturaPromedioCm" | "cantidadLecturas" | "lecturaEnMediosCm"> | null {
  if (!valores.instrumento) return null;
  return {
    instrumento: valores.instrumento,
    alturaPromedioCm: Number(valores.altura),
    cantidadLecturas: Number(valores.lecturas),
    lecturaEnMediosCm: valores.instrumento === "plato" && valores.mediosCm,
  };
}

export function ComoMedir() {
  return <details className="text-[0.8rem] text-gray-600">
    <summary className="cursor-pointer">Cómo medir para que sirva</summary>
    <ul className="m-0 mt-1.5 list-disc pl-5">
      <li>Recorré el lote en zigzag, de punta a punta, y medí en {LECTURAS_RECOMENDADAS} lugares o más, sin elegir los mejores ni los peores. Anotá el promedio.</li>
      <li>El plato es más preciso que la regla: aprieta el pasto y mide altura y densidad juntas. Si tu plato cuenta medios centímetros (como el Filip's), marcá la casilla y se divide por 2.</li>
      <li>Con regla: apoyala parada en el suelo, sin hundirla, y leé hasta donde llega la mayoría de las hojas sin estirarlas, no la hoja más alta suelta.</li>
      <li>Hoy los kilos se calculan con plato en alfalfa, mezclas con alfalfa, avena y raigrás anual. Con regla, o en otras pasturas, la medición se guarda pero todavía no se pasa a kilos.</li>
    </ul>
  </details>;
}

export default function CamposMedicionAltura({ valores, onCambio, deshabilitado, permitirSinMedir }: {
  valores: ValoresMedicion;
  onCambio: (valores: ValoresMedicion) => void;
  deshabilitado: boolean;
  /** En "¿Cómo quedó el lote?" medir es opcional; en "Cargar medición", no. */
  permitirSinMedir: boolean;
}) {
  const lecturas = Number(valores.lecturas);
  return <div className="flex flex-col gap-2">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="flex flex-col">
        <span className={ETIQUETA}>Instrumento</span>
        <select className={CAMPO} value={valores.instrumento} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valores, instrumento: evento.target.value as Instrumento | "" })}>
          {permitirSinMedir && <option value="">No se midió</option>}
          {!permitirSinMedir && !valores.instrumento && <option value="" disabled>Elegí uno</option>}
          <option value="plato">Plato</option>
          <option value="regla">Regla</option>
        </select>
      </label>
      {valores.instrumento && <>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Altura promedio ({valores.mediosCm ? "medios cm" : "cm"})</span>
          <input className={CAMPO} type="number" inputMode="decimal" min={0} step={0.5} required value={valores.altura} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valores, altura: evento.target.value })} />
        </label>
        <label className="flex flex-col">
          <span className={ETIQUETA}>Lecturas promediadas</span>
          <input className={CAMPO} type="number" inputMode="numeric" min={1} step={1} required value={valores.lecturas} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valores, lecturas: evento.target.value })} />
        </label>
      </>}
    </div>
    {valores.instrumento === "plato" && <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={valores.mediosCm} disabled={deshabilitado} onChange={(evento) => onCambio({ ...valores, mediosCm: evento.target.checked })} />
      Mi plato cuenta medios centímetros (Filip's): dividir por 2
    </label>}
    {valores.instrumento && valores.lecturas.trim() !== "" && Number.isInteger(lecturas) && lecturas > 0 && lecturas < LECTURAS_RECOMENDADAS &&
      <p className="m-0 text-[0.8rem] text-amber-800">Con menos de {LECTURAS_RECOMENDADAS} lecturas se guarda igual, pero el promedio puede no representar el lote.</p>}
    <ComoMedir />
  </div>;
}
