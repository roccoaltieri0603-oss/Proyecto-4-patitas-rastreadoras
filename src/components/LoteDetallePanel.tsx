import { useState } from "react";
import type { Lote } from "../types";
import type { ResultadoClimaLote } from "../clima/types";
import type { ResultadoLote } from "../copernicus/types";
import type { HistorialLote, UsoLote } from "../api/historial";

interface Props {
  lote: Lote;
  resultadoSatelital?: ResultadoLote;
  resultadoClima?: ResultadoClimaLote;
  historial: HistorialLote | null;
  cargando: boolean;
  error: string | null;
  registrandoUso: boolean;
  onRegistrarUso: (fecha: string) => Promise<void>;
}

function fecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function edadTimestamp(iso: string): string {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  return dias === 0 ? "hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

function diasDesdeFechaCalendario(iso: string, hoy = new Date()): number {
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  const fechaHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const fechaObjetivo = new Date(anio, mes - 1, dia);
  return Math.max(0, Math.round((fechaHoy.getTime() - fechaObjetivo.getTime()) / 86400000));
}

function edadFechaCalendario(iso: string): string {
  const dias = diasDesdeFechaCalendario(iso);
  return dias === 0 ? "hoy" : `hace ${dias} días`;
}

function ultimoUso(usos: UsoLote[]): UsoLote | null {
  return usos[0] ?? null;
}

function proximaOptica(ultima: string): string {
  const fechaUltima = new Date(`${ultima}T12:00:00Z`);
  const estimada = new Date(fechaUltima.getTime() + 5 * 86400000);
  return estimada.toISOString().slice(0, 10);
}

function milimetros(valor: number | null): string {
  return valor === null ? "sin dato" : `${valor.toFixed(1)} mm`;
}

export default function LoteDetallePanel({ lote, resultadoSatelital, resultadoClima, historial, cargando, error, registrandoUso, onRegistrarUso }: Props) {
  const [fechaUso, setFechaUso] = useState("");
  const uso = ultimoUso(historial?.usos ?? []);
  const satelite2 = historial?.satelite.find((item) => item.fuente === "sentinel-2");
  const satelite1 = historial?.satelite.find((item) => item.fuente === "sentinel-1");
  const clima = historial?.clima[0];

  async function registrar() {
    if (!fechaUso) return;
    await onRegistrarUso(fechaUso);
    setFechaUso("");
  }

  return <div className="panel lote-detalle-panel">
    <h3>Datos del lote</h3>
    <p className="muted small">Lote {lote.numero}{lote.apodo ? ` · ${lote.apodo}` : ""} · {lote.activo ? "Activo" : "Inactivo"}</p>
    {cargando && <p className="muted small">Cargando historial...</p>}
    {error && <p className="auth-error">{error}</p>}
    {!cargando && !error && historial && <>
      <p className="muted small"><strong>Última actualización persistida</strong><br />{satelite2 ? `Óptica: ${fecha(satelite2.observedAt)} · ${edadTimestamp(satelite2.consultedAt)}` : "Óptica: sin datos"}<br />{satelite1 ? `Radar: ${fecha(satelite1.observedAt)} · ${edadFechaCalendario(satelite1.observedAt)}` : "Radar: sin datos"}<br />{clima ? `Clima: ${edadTimestamp(clima.consultedAt)}` : "Clima: sin datos"}<br />{satelite2 ? `Próxima óptica estimada: ${fecha(proximaOptica(satelite2.observedAt))}` : "Próxima óptica estimada: sin datos"}</p>
      {resultadoSatelital?.estado === "ok" && <p className="muted small">Condición actual: NDVI {resultadoSatelital.condicion.ndvi.mediana.toFixed(2)} · NDMI {resultadoSatelital.condicion.ndmi.mediana.toFixed(2)} · EVI {resultadoSatelital.condicion.evi.mediana.toFixed(2)} · NDWI {resultadoSatelital.condicion.ndwi.mediana.toFixed(2)}</p>}
      {resultadoSatelital?.estado === "radar" && <p className="muted small">Radar actual: RVI {resultadoSatelital.condicion.rvi.mediana.toFixed(2)}{resultadoSatelital.optico ? ` · Óptica NDVI ${resultadoSatelital.optico.ndvi.mediana.toFixed(2)}` : ""}</p>}
      {resultadoClima?.estado === "ok" && <p className="muted small">Clima actual: {milimetros(resultadoClima.clima.lluviaUltimos7Dias)} últimos 7 días · {milimetros(resultadoClima.clima.lluviaProximosDias)} próximos.</p>}
      <details><summary>Historial satelital ({historial.satelite.length})</summary><ul className="historial-list">{historial.satelite.slice(0, 8).map((item) => <li key={item.id}>{fecha(item.observedAt)} · {item.fuente}{item.fuente === "sentinel-1" ? ` · RVI ${item.rvi.mediana?.toFixed(2) ?? "sin dato"}` : ` · NDVI ${item.ndvi.mediana?.toFixed(2) ?? "sin dato"} · NDMI ${item.ndmi.mediana?.toFixed(2) ?? "sin dato"} · EVI ${item.evi.mediana?.toFixed(2) ?? "sin dato"} · NDWI ${item.ndwi.mediana?.toFixed(2) ?? "sin dato"}`}</li>)}</ul></details>
      <details><summary>Historial clima ({historial.clima.length})</summary><ul className="historial-list">{historial.clima.slice(0, 8).map((item) => <li key={item.id}>{new Date(item.consultedAt).toLocaleString("es-AR")} · {item.lluviaUltimos7Dias ?? "sin dato"} mm<ul>{item.dias.slice(0, 12).map((dia) => <li key={`${item.id}-${dia.fecha}`}>{fecha(dia.fecha)} · {dia.lluviaMm ?? "sin dato"} mm</li>)}</ul></li>)}</ul></details>
      <details open><summary>Descanso y uso ({historial.usos.length})</summary><p className="muted small">Último uso: {uso ? `${fecha(uso.fecha)} · ${edadFechaCalendario(uso.fecha)}` : "Sin registrar"}</p>{uso && <p className="muted small">Descanso actual: {diasDesdeFechaCalendario(uso.fecha)} días</p>}<ul className="historial-list">{historial.usos.slice(0, 8).map((item) => <li key={item.id}>{fecha(item.fecha)} · uso registrado</li>)}</ul><div className="button-row"><input type="date" value={fechaUso} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setFechaUso(event.target.value)} disabled={registrandoUso} /><button className="btn btn-secondary" onClick={registrar} disabled={!fechaUso || registrandoUso}>{registrandoUso ? "Guardando..." : "Registrar uso"}</button></div></details>
    </>}
  </div>;
}
