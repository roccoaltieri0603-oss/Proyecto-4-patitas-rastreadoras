import type { Lote } from "../types";
import type { CondicionLote, ProyeccionTendencia, ResultadoLote } from "../copernicus/types";
import {
  COLOR_CATEGORIA,
  COLOR_RADAR,
  COLOR_SIN_DATOS,
  DIAS_VENTANA_VISIBLE,
  ETIQUETA_CATEGORIA,
} from "../copernicus/presentacion";
import TendenciaChart from "./TendenciaChart";
import Button from "./ui/Button";
import Panel from "./ui/Panel";
import {
  BADGE_RECOMENDADO,
  CATEGORIA_CHIP,
  MUTED,
  MUTED_SMALL,
  RANKING_HEADER,
  RANKING_LIST,
  RANKING_NOMBRE,
  RANKING_PUESTO,
  RANKING_PUNTAJE,
  RANKING_PUNTAJE_SIN_DATOS,
  RANKING_SIN_DATOS_TEXTO,
  RANKING_SUB,
  VALORES_COBERTURA,
  VALORES_INLINE,
  antiguedadClass,
  rankingItemClass,
} from "./ui/ranking";

interface CondicionPanelProps {
  lotesActivos: Lote[];
  resultados: Record<string, ResultadoLote>;
  analizando: boolean;
  ultimoAnalisis: number | null;
  errorGlobal: string | null;
  credencialesOk: boolean | null;
  selectedLoteId: string | null;
  onAnalizar: () => void;
  onSelectLote: (id: string) => void;
}

function nombreLote(lote: Lote): string {
  return lote.apodo ? `Lote ${lote.numero} — ${lote.apodo}` : `Lote ${lote.numero}`;
}

function formatoIndice(valor: number): string {
  return valor.toFixed(2);
}

function fechaLegible(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]}`;
}

function antiguedad(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/** Naranja/rojo cuando el dato ya tiene varios días encima. */
function claseAntiguedad(dias: number): "fresco" | "tibio" | "viejo" {
  if (dias <= 7) return "fresco";
  if (dias <= 14) return "tibio";
  return "viejo";
}

/** Compara la última mediana de NDVI contra la anterior de la serie. */
function tendenciaNdvi(condicion: CondicionLote): { texto: string; signo: string } | null {
  const serie = condicion.tendencia;
  if (serie.length < 2) return null;
  const delta = serie[serie.length - 1].ndvi - serie[serie.length - 2].ndvi;
  if (Math.abs(delta) < 0.02) return { texto: "estable", signo: "→" };
  return delta > 0
    ? { texto: `+${delta.toFixed(2)} vs. ${fechaLegible(serie[serie.length - 2].fecha)}`, signo: "↑" }
    : { texto: `${delta.toFixed(2)} vs. ${fechaLegible(serie[serie.length - 2].fecha)}`, signo: "↓" };
}

/**
 * Texto de la proyección lineal que calcula el backend sobre el puntaje
 * histórico, o null si no vino (hacen falta al menos tres fechas despejadas).
 */
function textoProyeccion(proyeccion: ProyeccionTendencia): string {
  if (proyeccion.direccion === "estable") {
    return "Tendencia de fondo: estable en las últimas lecturas.";
  }

  const base = `Tendencia de fondo: ${proyeccion.direccion} ~${Math.abs(proyeccion.pendienteSemanal).toFixed(0)} puntos/semana`;
  if (!proyeccion.proximoCambio) return `${base}.`;

  const { categoria, dias } = proyeccion.proximoCambio;
  return `${base}. A ese ritmo, entraría en categoría "${ETIQUETA_CATEGORIA[categoria]}" en ~${dias} días.`;
}

function DetalleCondicion({ condicion }: { condicion: CondicionLote }) {
  const tendencia = tendenciaNdvi(condicion);
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-gray-200 pt-2.5">
      <dl className="m-0 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[0.7rem] font-bold tracking-[0.05em] text-gray-500">NDVI</dt>
          <dd className="mt-px text-[1.05rem] font-semibold text-gray-800 tabular-nums">{formatoIndice(condicion.ndvi.mediana)}</dd>
          <span className="block text-[0.68rem] leading-[1.3] text-gray-400">
            vigor · rango {formatoIndice(condicion.ndvi.min)}–
            {formatoIndice(condicion.ndvi.max)}
          </span>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[0.7rem] font-bold tracking-[0.05em] text-gray-500">NDMI</dt>
          <dd className="mt-px text-[1.05rem] font-semibold text-gray-800 tabular-nums">{formatoIndice(condicion.ndmi.media)}</dd>
          <span className="block text-[0.68rem] leading-[1.3] text-gray-400">humedad de la vegetación</span>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[0.7rem] font-bold tracking-[0.05em] text-gray-500">EVI</dt>
          <dd className="mt-px text-[1.05rem] font-semibold text-gray-800 tabular-nums">{formatoIndice(condicion.evi.media)}</dd>
          <span className="block text-[0.68rem] leading-[1.3] text-gray-400">vegetación (corregido)</span>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[0.7rem] font-bold tracking-[0.05em] text-gray-500">NDWI</dt>
          <dd className="mt-px text-[1.05rem] font-semibold text-gray-800 tabular-nums">{formatoIndice(condicion.ndwi.media)}</dd>
          <span className="block text-[0.68rem] leading-[1.3] text-gray-400">agua libre / anegamiento</span>
        </div>
      </dl>

      <p className={MUTED_SMALL}>
        Sentinel-2 del {fechaLegible(condicion.fecha)}
        {tendencia && (
          <>
            {" · NDVI "}
            {tendencia.signo} {tendencia.texto}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1">
        <p className="m-0 text-[0.7rem] font-bold tracking-[0.03em] text-gray-500">Evolución (últimas fechas despejadas)</p>
        <TendenciaChart tendencia={condicion.tendencia} />
        {condicion.proyeccion && (
          <p
            className={MUTED_SMALL}
            title="Proyección lineal simple sobre los puntajes históricos del lote — no es un modelo calibrado ni entrenado, sólo la recta que mejor ajusta los puntos de arriba."
          >
            {textoProyeccion(condicion.proyeccion)}
          </p>
        )}
      </div>

      {condicion.alertas.length > 0 && (
        <ul className="m-0 flex flex-col gap-[3px] pl-[18px]">
          {condicion.alertas.map((alerta) => (
            <li key={alerta} className="text-[0.78rem] leading-[1.35] text-amber-800">{alerta}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CondicionPanel({
  lotesActivos,
  resultados,
  analizando,
  ultimoAnalisis,
  errorGlobal,
  credencialesOk,
  selectedLoteId,
  onAnalizar,
  onSelectLote,
}: CondicionPanelProps) {
  // Mejor puntaje primero; los lotes sin dato quedan al final.
  const ranking = [...lotesActivos].sort((a, b) => {
    const ra = resultados[a.id];
    const rb = resultados[b.id];
    const pa = ra?.estado === "ok" ? ra.condicion.puntaje : -1;
    const pb = rb?.estado === "ok" ? rb.condicion.puntaje : -1;
    if (pa !== pb) return pb - pa;
    return a.numero - b.numero;
  });

  const hayResultados = Object.keys(resultados).length > 0;
  const mejor = ranking.find((l) => resultados[l.id]?.estado === "ok");
  const avisoClass = "m-0 rounded-md border border-amber-300 bg-amber-100 p-2.5 text-[0.82rem] leading-normal text-amber-800 [&_code]:rounded [&_code]:bg-black/[0.07] [&_code]:px-1 [&_code]:text-[0.78rem]";

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base">Condición para pastoreo</h3>
        <Button
          variant="primary"
          size="sm"
          onClick={onAnalizar}
          disabled={analizando || lotesActivos.length === 0}
        >
          {analizando ? "Consultando…" : hayResultados ? "Actualizar" : "Analizar"}
        </Button>
      </div>

      {credencialesOk === false && (
        <p className={avisoClass}>
          Copernicus no está configurado. Agregá las variables del servicio en{" "}
          <code>backend/.env</code> y reiniciá el backend.
        </p>
      )}

      {lotesActivos.length === 0 ? (
        <p className={MUTED}>
          No hay lotes activos. Activá al menos uno para consultar su condición.
        </p>
      ) : (
        <p className={MUTED_SMALL}>
          Sentinel-2 L2A · última pasada despejada de los últimos {DIAS_VENTANA_VISIBLE} días · con
          respaldo Sentinel-1 (radar) si no hay óptica reciente ·{" "}
          {lotesActivos.length} lote{lotesActivos.length > 1 ? "s" : ""} activo
          {lotesActivos.length > 1 ? "s" : ""}.
        </p>
      )}

      {errorGlobal && <p className={avisoClass}>{errorGlobal}</p>}

      {ultimoAnalisis && !analizando && (
        <p className={MUTED_SMALL}>
          Consultado a las{" "}
          {new Date(ultimoAnalisis).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      {hayResultados && (
        <ol className={RANKING_LIST}>
          {ranking.map((lote, indice) => {
            const resultado = resultados[lote.id];
            const seleccionado = lote.id === selectedLoteId;
            const esOk = resultado?.estado === "ok";
            const esRadar = resultado?.estado === "radar";
            const color = esOk
              ? COLOR_CATEGORIA[resultado.condicion.categoria]
              : esRadar
                ? COLOR_RADAR
                : COLOR_SIN_DATOS;

            return (
              <li
                key={lote.id}
                className={rankingItemClass(seleccionado)}
                onClick={() => onSelectLote(lote.id)}
              >
                <div className={RANKING_HEADER}>
                  <span className={RANKING_PUESTO}>{indice + 1}</span>
                  <span className={RANKING_NOMBRE}>{nombreLote(lote)}</span>
                  {esOk ? (
                    <span className={RANKING_PUNTAJE} style={{ background: color }}>
                      {resultado.condicion.puntaje}
                    </span>
                  ) : esRadar ? (
                    <span className={RANKING_PUNTAJE} style={{ background: color }} title="Radar Sentinel-1, no comparable con el puntaje óptico">
                      SAR
                    </span>
                  ) : (
                    <span className={RANKING_PUNTAJE_SIN_DATOS}>—</span>
                  )}
                </div>

                {esOk ? (
                  <>
                    <div className={RANKING_SUB}>
                      <span className={CATEGORIA_CHIP} style={{ color }}>
                        {ETIQUETA_CATEGORIA[resultado.condicion.categoria]}
                      </span>
                      {lote.id === mejor?.id && (
                        <span className={BADGE_RECOMENDADO}>Recomendado</span>
                      )}
                      <span className={antiguedadClass(claseAntiguedad(resultado.condicion.diasDesde))}>
                        {fechaCorta(resultado.condicion.fecha)} ·{" "}
                        {antiguedad(resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    {/* Los valores van siempre a la vista, no sólo al seleccionar. */}
                    <div className={VALORES_INLINE}>
                      <span>
                        <b>NDVI</b> {formatoIndice(resultado.condicion.ndvi.mediana)}
                      </span>
                      <span>
                        <b>NDMI</b> {formatoIndice(resultado.condicion.ndmi.media)}
                      </span>
                      <span>
                        <b>EVI</b> {formatoIndice(resultado.condicion.evi.media)}
                      </span>
                      <span className={VALORES_COBERTURA}>
                        {Math.round(resultado.condicion.coberturaValida * 100)}% despejado
                      </span>
                    </div>

                    {seleccionado && <DetalleCondicion condicion={resultado.condicion} />}
                  </>
                ) : esRadar ? (
                  <>
                    <div className={RANKING_SUB}>
                      <span className={CATEGORIA_CHIP} style={{ color }}>
                        Radar Sentinel-1
                      </span>
                      <span className={antiguedadClass(claseAntiguedad(resultado.condicion.diasDesde))}>
                        {fechaCorta(resultado.condicion.fecha)} ·{" "}
                        {antiguedad(resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    <div className={VALORES_INLINE}>
                      <span>
                        <b>RVI</b> {formatoIndice(resultado.condicion.rvi.mediana)}
                      </span>
                      <span className={VALORES_COBERTURA}>
                        vegetación por radar, no comparable con NDVI
                      </span>
                    </div>

                    <p className={`${MUTED_SMALL} ${RANKING_SIN_DATOS_TEXTO}`}>{resultado.mensaje}</p>

                    {resultado.optico && (
                      <>
                        <div className={RANKING_SUB}>
                          <span className={CATEGORIA_CHIP}>
                            Óptica Sentinel-2 ({ETIQUETA_CATEGORIA[resultado.optico.categoria]}
                            {" · "}
                            {resultado.optico.puntaje})
                          </span>
                          <span className={antiguedadClass(claseAntiguedad(resultado.optico.diasDesde))}>
                            {fechaCorta(resultado.optico.fecha)} ·{" "}
                            {antiguedad(resultado.optico.diasDesde)}
                          </span>
                        </div>

                        <div className={VALORES_INLINE}>
                          <span>
                            <b>NDVI</b> {formatoIndice(resultado.optico.ndvi.mediana)}
                          </span>
                          <span>
                            <b>NDMI</b> {formatoIndice(resultado.optico.ndmi.media)}
                          </span>
                          <span>
                            <b>EVI</b> {formatoIndice(resultado.optico.evi.media)}
                          </span>
                          <span className={VALORES_COBERTURA}>
                            {Math.round(resultado.optico.coberturaValida * 100)}% despejado
                          </span>
                        </div>

                        {seleccionado && <DetalleCondicion condicion={resultado.optico} />}
                      </>
                    )}
                  </>
                ) : (
                  <p className={`${MUTED_SMALL} ${RANKING_SIN_DATOS_TEXTO}`}>
                    {resultado?.mensaje ?? "Sin consultar."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hayResultados && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 text-[0.72rem] text-gray-500">
          <span className="font-semibold">Color en el mapa:</span>
          {(["excelente", "buena", "regular", "baja"] as const).map((categoria) => (
            <span key={categoria} className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_CATEGORIA[categoria] }} />
              {ETIQUETA_CATEGORIA[categoria]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_RADAR }} />
            Radar (respaldo)
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_SIN_DATOS }} />
            Sin dato
          </span>
        </div>
      )}
    </Panel>
  );
}
