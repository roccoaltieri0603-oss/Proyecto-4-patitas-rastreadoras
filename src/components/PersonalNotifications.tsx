import type { NotificacionPersonal } from '../api/notificaciones';
import { categoriaNotificacion, fechaAmigableNotificacion, fechaCompletaNotificacion } from '../utils/notification-presentation';
import Button from './ui/Button';

export default function PersonalNotifications({ items, establecimientoNombre, sinAcceso, accionando, marcarLeida, eliminarLeida }: {
  items: NotificacionPersonal[]; establecimientoNombre: string; sinAcceso?: boolean; accionando: boolean;
  marcarLeida: (id: string) => Promise<void>; eliminarLeida: (id: string) => Promise<void>;
}) {
  const visibles = items;
  if (visibles.length === 0) return null;
  return <section aria-label={`Avisos personales de ${establecimientoNombre}`} className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-4">
    <div><h3 className="font-semibold">Avisos personales</h3><p className="text-sm text-gray-600">{establecimientoNombre}{sinAcceso ? ' · ya no está en tu lista de establecimientos' : ''}</p>
      {sinAcceso && <p className="text-xs text-gray-500">Este aviso no restablece el acceso al establecimiento ni a sus puestos.</p>}</div>
    <ul className="flex list-none flex-col gap-2 p-0">{visibles.map((item) => {
      const categoria = categoriaNotificacion(item.tipo);
      return <li key={item.id} className={`rounded-lg border p-3 ${item.leida ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex items-start gap-2"><span aria-label={categoria.etiqueta} title={categoria.etiqueta} className="text-lg">{categoria.icono}</span>
          <div className="min-w-0 flex-1"><h4 className="font-semibold">{item.titulo}</h4><p className="text-sm text-gray-700">{item.mensaje}</p>
            <time className="text-xs text-gray-500" dateTime={item.createdAt} title={fechaCompletaNotificacion(item.createdAt)}>{fechaAmigableNotificacion(item.createdAt)}</time>
            <div className="mt-1 flex gap-3">{!item.leida && <button type="button" disabled={accionando} className="text-xs font-medium text-brand underline disabled:opacity-50" onClick={() => void marcarLeida(item.id)}>Marcar leído</button>}
              {item.leida && <button type="button" disabled={accionando} className="text-xs font-medium text-gray-600 underline disabled:opacity-50" onClick={() => void eliminarLeida(item.id)}>Ocultar</button>}</div>
          </div></div>
      </li>;
    })}</ul>
  </section>;
}

export function PersonalNotificationsControls({ noLeidas, offset, total, hayMas, limit, cargando, accionando, error,
  recargar, anterior, siguiente, marcarTodas }: {
  noLeidas: number; offset: number; total: number; hayMas: boolean; limit: number;
  cargando: boolean; accionando: boolean; error: string | null;
  recargar: () => Promise<void>; anterior: () => void; siguiente: () => void; marcarTodas: () => Promise<void>;
}) {
  if (total === 0 && !cargando && !error) return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={cargando || accionando} onClick={() => void recargar()}>{cargando ? 'Actualizando…' : 'Actualizar avisos'}</Button>
      {noLeidas > 0 && <Button size="sm" variant="secondary" disabled={cargando || accionando} onClick={() => void marcarTodas()}>Marcar todos como leídos</Button>}
      {cargando && <span aria-live="polite" className="text-sm text-gray-600">Cargando avisos…</span>}
      {error && <span role="alert" className="text-sm text-red-800">{error}</span>}
    </div>
    {total > limit && <div className="flex items-center justify-center gap-2.5 text-xs text-gray-500">
      <Button variant="secondary" size="sm" onClick={anterior} disabled={offset === 0 || cargando || accionando}>Anterior</Button>
      <span>{offset + 1}–{Math.min(offset + limit, total)} de {total}</span>
      <Button variant="secondary" size="sm" onClick={siguiente} disabled={!hayMas || cargando || accionando}>Siguiente</Button>
    </div>}
  </div>;
}
