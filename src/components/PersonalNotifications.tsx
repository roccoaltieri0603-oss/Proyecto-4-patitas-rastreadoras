import type { NotificacionPersonal } from '../api/notificaciones';
import { categoriaNotificacion, fechaAmigableNotificacion, fechaCompletaNotificacion } from '../utils/notification-presentation';

/*
 * Se muestran dentro de la tarjeta de vidrio de Mis establecimientos, sobre la
 * foto: texto blanco y fondos translúcidos como el resto del frame. Los no
 * leídos se distinguen con un ámbar suave en vez del amarillo opaco anterior.
 */
const PILDORA =
  'foco-campo inline-flex h-[30px] cursor-pointer items-center justify-center rounded-full border-[1.5px] border-white/95 bg-white/4 px-3 text-[13px] leading-4 font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-50';
const LINK = 'foco-campo cursor-pointer rounded border-0 bg-transparent p-0 text-xs font-medium text-white underline hover:no-underline disabled:cursor-default disabled:opacity-50';

export default function PersonalNotifications({ items, establecimientoNombre, sinAcceso, accionando, marcarLeida, eliminarLeida }: {
  items: NotificacionPersonal[]; establecimientoNombre: string; sinAcceso?: boolean; accionando: boolean;
  marcarLeida: (id: string) => Promise<void>; eliminarLeida: (id: string) => Promise<void>;
}) {
  const visibles = items;
  if (visibles.length === 0) return null;
  return <section aria-label={`Avisos personales de ${establecimientoNombre}`}
    className={`flex flex-col gap-2 ${sinAcceso ? '' : 'border-t border-white/25 pt-[14px]'}`}>
    <div>
      <h3 className="m-0 text-base leading-5 font-semibold text-white">Avisos personales</h3>
      <p className="m-0 text-sm leading-[18px] text-white/75">{establecimientoNombre}{sinAcceso ? ' · ya no está en tu lista de establecimientos' : ''}</p>
      {sinAcceso && <p className="m-0 mt-0.5 text-xs text-white/65">Este aviso no restablece el acceso al establecimiento ni a sus puestos.</p>}
    </div>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">{visibles.map((item) => {
      const categoria = categoriaNotificacion(item.tipo);
      return <li key={item.id}
        className={`rounded-[18px] border py-3 pr-3 pl-4 ${item.leida ? 'border-transparent bg-white/12' : 'border-amber-200/70 bg-amber-300/20'}`}>
        <div className="flex items-start gap-2"><span aria-label={categoria.etiqueta} title={categoria.etiqueta} className="text-lg">{categoria.icono}</span>
          <div className="min-w-0 flex-1">
            <h4 className="m-0 text-[15px] leading-5 font-semibold text-white">{item.titulo}</h4>
            <p className="m-0 text-sm leading-[18px] text-white/85">{item.mensaje}</p>
            <time className="text-xs text-white/65" dateTime={item.createdAt} title={fechaCompletaNotificacion(item.createdAt)}>{fechaAmigableNotificacion(item.createdAt)}</time>
            <div className="mt-1 flex gap-3">
              {!item.leida && <button type="button" disabled={accionando} className={LINK} onClick={() => void marcarLeida(item.id)}>Marcar leído</button>}
              {item.leida && <button type="button" disabled={accionando} className={`${LINK} text-white/75`} onClick={() => void eliminarLeida(item.id)}>Ocultar</button>}
            </div>
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
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/25 pt-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={PILDORA} disabled={cargando || accionando} onClick={() => void recargar()}>{cargando ? 'Actualizando…' : 'Actualizar avisos'}</button>
      {noLeidas > 0 && <button type="button" className={PILDORA} disabled={cargando || accionando} onClick={() => void marcarTodas()}>Marcar todos como leídos</button>}
      {cargando && <span aria-live="polite" className="text-sm text-white/75">Cargando avisos…</span>}
      {error && <span role="alert" className="text-sm text-white">{error}</span>}
    </div>
    {total > limit && <div className="flex items-center justify-center gap-2.5 text-xs text-white/75">
      <button type="button" className={PILDORA} onClick={anterior} disabled={offset === 0 || cargando || accionando}>Anterior</button>
      <span>{offset + 1}–{Math.min(offset + limit, total)} de {total}</span>
      <button type="button" className={PILDORA} onClick={siguiente} disabled={!hayMas || cargando || accionando}>Siguiente</button>
    </div>}
  </div>;
}
