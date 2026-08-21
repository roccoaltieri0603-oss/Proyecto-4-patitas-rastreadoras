import type { Lote } from "../types";
import type { CondicionLote, ResultadoLote } from "../copernicus/types";
import {
  COLOR_CATEGORIA,
  COLOR_RADAR,
  COLOR_SIN_DATOS,
  DIAS_VENTANA_VISIBLE,
  ETIQUETA_CATEGORIA,
} from "../copernicus/presentacion";
import TendenciaChart from "./TendenciaChart";

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
function claseAntiguedad(dias: number): string {
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

function DetalleCondicion({ condicion }: { condicion: CondicionLote }) {
  const tendencia = tendenciaNdvi(condicion);
  return (
    <div className="condicion-detalle">
      <dl className="indices-grid">
        <div className="indice">
          <dt>NDVI</dt>
          <dd>{formatoIndice(condicion.ndvi.mediana)}</dd>
          <span className="indice-hint">
            vigor · rango {formatoIndice(condicion.ndvi.min)}–
            {formatoIndice(condicion.ndvi.max)}
          </span>
        </div>
        <div className="indice">
          <dt>NDMI</dt>
          <dd>{formatoIndice(condicion.ndmi.media)}</dd>
          <span className="indice-hint">humedad de la vegetación</span>
        </div>
        <div className="indice">
          <dt>EVI</dt>
          <dd>{formatoIndice(condicion.evi.media)}</dd>
          <span className="indice-hint">vegetación (corregido)</span>
        </div>
        <div className="indice">
          <dt>NDWI</dt>
          <dd>{formatoIndice(condicion.ndwi.media)}</dd>
          <span className="indice-hint">agua libre / anegamiento</span>
        </div>
      </dl>

      <p className="muted small">
        Sentinel-2 del {fechaLegible(condicion.fecha)}
        {tendencia && (
          <>
            {" · NDVI "}
            {tendencia.signo} {tendencia.texto}
          </>
        )}
      </p>

      <div className="tendencia-bloque">
        <p className="tendencia-titulo">Evolución (últimas fechas despejadas)</p>
        <TendenciaChart tendencia={condicion.tendencia} />
      </div>

      {condicion.alertas.length > 0 && (
        <ul className="alertas">
          {condicion.alertas.map((alerta) => (
            <li key={alerta}>{alerta}</li>
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

  return (
    <div className="panel condicion-panel">
      <div className="lotes-header">
        <h3>Condición para pastoreo</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={onAnalizar}
          disabled={analizando || lotesActivos.length === 0}
        >
          {analizando ? "Consultando…" : hayResultados ? "Actualizar" : "Analizar"}
        </button>
      </div>

      {credencialesOk === false && (
        <p className="condicion-aviso">
          Copernicus no está configurado. Agregá las variables del servicio en{" "}
          <code>backend/.env</code> y reiniciá el backend.
        </p>
      )}

      {lotesActivos.length === 0 ? (
        <p className="muted">
          No hay lotes activos. Activá al menos uno para consultar su condición.
        </p>
      ) : (
        <p className="muted small">
          Sentinel-2 L2A · última pasada despejada de los últimos {DIAS_VENTANA_VISIBLE} días · con
          respaldo Sentinel-1 (radar) si no hay óptica reciente ·{" "}
          {lotesActivos.length} lote{lotesActivos.length > 1 ? "s" : ""} activo
          {lotesActivos.length > 1 ? "s" : ""}.
        </p>
      )}

      {errorGlobal && <p className="condicion-aviso">{errorGlobal}</p>}

      {ultimoAnalisis && !analizando && (
        <p className="muted small">
          Consultado a las{" "}
          {new Date(ultimoAnalisis).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      {hayResultados && (
        <ol className="ranking">
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
                className={`ranking-item ${seleccionado ? "selected" : ""}`}
                onClick={() => onSelectLote(lote.id)}
              >
                <div className="ranking-cabecera">
                  <span className="ranking-puesto">{indice + 1}</span>
                  <span className="ranking-nombre">{nombreLote(lote)}</span>
                  {esOk ? (
                    <span className="ranking-puntaje" style={{ background: color }}>
                      {resultado.condicion.puntaje}
                    </span>
                  ) : esRadar ? (
                    <span className="ranking-puntaje" style={{ background: color }} title="Radar Sentinel-1, no comparable con el puntaje óptico">
                      SAR
                    </span>
                  ) : (
                    <span className="ranking-puntaje sin-datos">—</span>
                  )}
                </div>

                {esOk ? (
                  <>
                    <div className="ranking-sub">
                      <span className="categoria-chip" style={{ color }}>
                        {ETIQUETA_CATEGORIA[resultado.condicion.categoria]}
                      </span>
                      {lote.id === mejor?.id && (
                        <span className="badge-recomendado">Recomendado</span>
                      )}
                      <span
                        className={`antiguedad ${claseAntiguedad(resultado.condicion.diasDesde)}`}
                      >
                        {fechaCorta(resultado.condicion.fecha)} ·{" "}
                        {antiguedad(resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    {/* Los valores van siempre a la vista, no sólo al seleccionar. */}
                    <div className="valores-inline">
                      <span>
                        <b>NDVI</b> {formatoIndice(resultado.condicion.ndvi.mediana)}
                      </span>
                      <span>
                        <b>NDMI</b> {formatoIndice(resultado.condicion.ndmi.media)}
                      </span>
                      <span>
                        <b>EVI</b> {formatoIndice(resultado.condicion.evi.media)}
                      </span>
                      <span className="cobertura">
                        {Math.round(resultado.condicion.coberturaValida * 100)}% despejado
                      </span>
                    </div>

                    {seleccionado && <DetalleCondicion condicion={resultado.condicion} />}
                  </>
                ) : esRadar ? (
                  <>
                    <div className="ranking-sub">
                      <span className="categoria-chip" style={{ color }}>
                        Radar Sentinel-1
                      </span>
                      <span
                        className={`antiguedad ${claseAntiguedad(resultado.condicion.diasDesde)}`}
                      >
                        {fechaCorta(resultado.condicion.fecha)} ·{" "}
                        {antiguedad(resultado.condicion.diasDesde)}
                      </span>
                    </div>

                    <div className="valores-inline">
                      <span>
                        <b>RVI</b> {formatoIndice(resultado.condicion.rvi.mediana)}
                      </span>
                      <span className="cobertura">
                        vegetación por radar, no comparable con NDVI
                      </span>
                    </div>

                    <p className="muted small ranking-sin-datos">{resultado.mensaje}</p>

                    {resultado.optico && (
                      <>
                        <div className="ranking-sub">
                          <span className="categoria-chip">
                            Óptica Sentinel-2 ({ETIQUETA_CATEGORIA[resultado.optico.categoria]}
                            {" · "}
                            {resultado.optico.puntaje})
                          </span>
                          <span
                            className={`antiguedad ${claseAntiguedad(resultado.optico.diasDesde)}`}
                          >
                            {fechaCorta(resultado.optico.fecha)} ·{" "}
                            {antiguedad(resultado.optico.diasDesde)}
                          </span>
                        </div>

                        <div className="valores-inline">
                          <span>
                            <b>NDVI</b> {formatoIndice(resultado.optico.ndvi.mediana)}
                          </span>
                          <span>
                            <b>NDMI</b> {formatoIndice(resultado.optico.ndmi.media)}
                          </span>
                          <span>
                            <b>EVI</b> {formatoIndice(resultado.optico.evi.media)}
                          </span>
                          <span className="cobertura">
                            {Math.round(resultado.optico.coberturaValida * 100)}% despejado
                          </span>
                        </div>

                        {seleccionado && <DetalleCondicion condicion={resultado.optico} />}
                      </>
                    )}
                  </>
                ) : (
                  <p className="muted small ranking-sin-datos">
                    {resultado?.mensaje ?? "Sin consultar."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hayResultados && (
        <div className="leyenda">
          <span className="leyenda-titulo">Color en el mapa:</span>
          {(["excelente", "buena", "regular", "baja"] as const).map((categoria) => (
            <span key={categoria} className="leyenda-item">
              <i style={{ background: COLOR_CATEGORIA[categoria] }} />
              {ETIQUETA_CATEGORIA[categoria]}
            </span>
          ))}
          <span className="leyenda-item">
            <i style={{ background: COLOR_RADAR }} />
            Radar (respaldo)
          </span>
          <span className="leyenda-item">
            <i style={{ background: COLOR_SIN_DATOS }} />
            Sin dato
          </span>
        </div>
      )}
    </div>
  );
}
