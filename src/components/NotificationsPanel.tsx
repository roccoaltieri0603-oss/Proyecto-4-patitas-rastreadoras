import type { Notificacion } from "../api/notificaciones";
import type { Lote } from "../types";
import Button from "./ui/Button";
import Panel from "./ui/Panel";

interface NotificationsPanelProps {
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

export default function NotificationsPanel(props: NotificationsPanelProps) {
  return <Panel aria-labelledby="notifications-title">
    <div className="flex items-start justify-between gap-2.5">
      <div><h3 id="notifications-title" className="m-0 text-base">Notificaciones</h3><p className="m-0 text-sm text-gray-500">{props.noLeidas} sin leer</p></div>
      {props.noLeidas > 0 && <Button variant="link" onClick={props.onMarcarTodas} disabled={props.accionando}>Marcar todas como leídas</Button>}
    </div>

    {props.error && <div className="flex justify-between gap-2 rounded-md border border-red-300 bg-red-100 p-2.5 text-sm text-red-800" role="alert"><span>{props.error}</span><Button variant="link" onClick={props.onRetry}>Reintentar</Button></div>}
    {props.cargando && props.items.length === 0 && <p aria-live="polite">Cargando notificaciones...</p>}
    {!props.cargando && !props.error && props.items.length === 0 && <p className="px-2 py-4.5 text-center text-gray-500">No tenés notificaciones.</p>}

    {props.items.length > 0 && <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {props.items.map((item) => {
        const lote = item.loteId ? props.lotes.find((actual) => actual.id === item.loteId) : undefined;
        return <li key={item.id} className={`rounded-lg border border-gray-200 bg-white p-2.5 ${item.leida ? "opacity-75" : "border-l-4 border-l-amber-500 bg-amber-50"}`}>
          <article className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2"><strong className="text-sm text-gray-800">{item.titulo}</strong><span className={`text-xs font-bold ${item.leida ? "text-gray-500" : "text-amber-800"}`}>{item.leida ? "Leída" : "● No leída"}</span></div>
            <p className="text-[0.84rem]">{item.mensaje}</p>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-gray-500"><time dateTime={item.createdAt}>{fechaHora(item.createdAt)}</time>{lote && <span>Lote {lote.numero}{lote.apodo ? ` · ${lote.apodo}` : ""}</span>}</div>
            {!item.leida && <Button variant="link" onClick={() => props.onMarcarLeida(item.id)} disabled={props.accionando}>Marcar como leída</Button>}
          </article>
        </li>;
      })}
    </ul>}

    {props.total > props.limit && <div className="flex items-center justify-center gap-2.5 text-xs text-gray-500">
      <Button variant="secondary" size="sm" onClick={props.onAnterior} disabled={props.offset === 0 || props.cargando}>Anterior</Button>
      <span>{props.offset + 1}–{Math.min(props.offset + props.items.length, props.total)} de {props.total}</span>
      <Button variant="secondary" size="sm" onClick={props.onSiguiente} disabled={!props.hayMas || props.cargando}>Siguiente</Button>
    </div>}
  </Panel>;
}
