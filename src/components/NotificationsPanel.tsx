import type { Notificacion } from "../api/notificaciones";
import type { Lote } from "../types";

interface Props {
  lotes: Lote[];
  items: Notificacion[];
  noLeidas: number;
  offset: number;
  total: number;
  hayMas: boolean;
  limit: number;
  cargando: boolean;
  accionando: boolean;
  error: string | null;
  onRetry: () => void;
  onMarcarLeida: (id: string) => void;
  onMarcarTodas: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
}

function fechaHora(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha no disponible" : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export default function NotificationsPanel(props: Props) {
  return <section className="panel notifications-panel" aria-labelledby="notifications-title">
    <div className="notifications-header">
      <div><h3 id="notifications-title">Notificaciones</h3><p className="muted">{props.noLeidas} sin leer</p></div>
      {props.noLeidas > 0 && <button className="btn-link" onClick={props.onMarcarTodas} disabled={props.accionando}>Marcar todas como leídas</button>}
    </div>

    {props.error && <div className="notifications-error" role="alert"><span>{props.error}</span><button className="btn-link" onClick={props.onRetry}>Reintentar</button></div>}
    {props.cargando && props.items.length === 0 && <p aria-live="polite">Cargando notificaciones...</p>}
    {!props.cargando && !props.error && props.items.length === 0 && <p className="notifications-empty">No tenés notificaciones.</p>}

    {props.items.length > 0 && <ul className="notifications-list">
      {props.items.map((item) => {
        const lote = item.loteId ? props.lotes.find((actual) => actual.id === item.loteId) : undefined;
        return <li key={item.id} className={`notification-item ${item.leida ? "leida" : "no-leida"}`}>
          <article>
            <div className="notification-title-row"><strong>{item.titulo}</strong><span className="notification-status">{item.leida ? "Leída" : "● No leída"}</span></div>
            <p>{item.mensaje}</p>
            <div className="notification-meta"><time dateTime={item.createdAt}>{fechaHora(item.createdAt)}</time>{lote && <span>Lote {lote.numero}{lote.apodo ? ` · ${lote.apodo}` : ""}</span>}</div>
            {!item.leida && <button className="btn-link" onClick={() => props.onMarcarLeida(item.id)} disabled={props.accionando}>Marcar como leída</button>}
          </article>
        </li>;
      })}
    </ul>}

    {props.total > props.limit && <div className="notifications-pagination">
      <button className="btn btn-secondary btn-sm" onClick={props.onAnterior} disabled={props.offset === 0 || props.cargando}>Anterior</button>
      <span>{props.offset + 1}–{Math.min(props.offset + props.items.length, props.total)} de {props.total}</span>
      <button className="btn btn-secondary btn-sm" onClick={props.onSiguiente} disabled={!props.hayMas || props.cargando}>Siguiente</button>
    </div>}
  </section>;
}
