import type { NotificacionPersonal } from '../api/notificaciones';
import { categoriaNotificacion, fechaAmigableNotificacion, fechaCompletaNotificacion } from '../utils/notification-presentation';
import Button from './ui/Button';

export default function PersonalNotifications({ items, noLeidas, offset, total, hayMas, limit, cargando, accionando, error, recargar, anterior, siguiente, marcarLeida, marcarTodas, eliminarLeida }: {
  items: NotificacionPersonal[]; noLeidas: number; offset: number; total: number; hayMas: boolean; limit: number;
  cargando: boolean; accionando: boolean; error: string | null;
  recargar: () => Promise<void>; marcarLeida: (id: string) => Promise<void>;
  marcarTodas: () => Promise<void>; eliminarLeida: (id: string) => Promise<void>;
  anterior: () => void; siguiente: () => void;
}) {
  return <section aria-labelledby="avisos-personales" className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="avisos-personales" className="font-bold">Avisos personales</h2><p className="text-sm text-gray-600">Privados para tu cuenta. No requieren entrar a un puesto.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={cargando || accionando} onClick={() => void recargar()}>{cargando ? 'Actualizando…' : 'Actualizar'}</Button>
        {noLeidas > 0 && <Button size="sm" variant="secondary" disabled={cargando || accionando} onClick={() => void marcarTodas()}>Marcar todos como leídos</Button>}
      </div>
    </div>
    {error && <div role="alert" className="flex items-center justify-between gap-2 text-sm text-red-800"><span>{error}</span><Button variant="link" disabled={cargando || accionando} onClick={() => void recargar()}>Reintentar</Button></div>}
    {cargando && <p aria-live="polite" className="text-sm text-gray-600">{items.length === 0 ? 'Cargando avisos…' : 'Actualizando avisos…'}</p>}
    {!cargando && !error && items.length === 0 && <p className="text-sm text-gray-600">Todavía no tenés avisos personales.</p>}
    <ul className="flex list-none flex-col gap-2 p-0">{items.map((item) => {
      const categoria = categoriaNotificacion(item.tipo);
      return <li key={item.id} className={`rounded-lg border p-3 ${item.leida ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex items-start gap-2"><span aria-label={categoria.etiqueta} title={categoria.etiqueta} className="text-lg">{categoria.icono}</span>
          <div className="min-w-0 flex-1"><h3 className="font-semibold">{item.titulo}</h3><p className="text-sm text-gray-700">{item.mensaje}</p>
            <time className="text-xs text-gray-500" dateTime={item.createdAt} title={fechaCompletaNotificacion(item.createdAt)}>{fechaAmigableNotificacion(item.createdAt)}</time>
            <div className="mt-1 flex gap-3">{!item.leida && <button type="button" disabled={accionando} className="text-xs font-medium text-brand underline disabled:opacity-50" onClick={() => void marcarLeida(item.id)}>Marcar leído</button>}
              {item.leida && <button type="button" disabled={accionando} className="text-xs font-medium text-gray-600 underline disabled:opacity-50" onClick={() => void eliminarLeida(item.id)}>Ocultar</button>}</div>
          </div></div>
      </li>;
    })}</ul>
    {total > limit && <div className="flex items-center justify-center gap-2.5 text-xs text-gray-500">
      <Button variant="secondary" size="sm" onClick={anterior} disabled={offset === 0 || cargando || accionando}>Anterior</Button>
      <span>{offset + 1}–{Math.min(offset + items.length, total)} de {total}</span>
      <Button variant="secondary" size="sm" onClick={siguiente} disabled={!hayMas || cargando || accionando}>Siguiente</Button>
    </div>}
  </section>;
}
