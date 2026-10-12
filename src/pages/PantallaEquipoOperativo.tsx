import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstablecimiento } from '../hooks/useEstablecimiento';
import {
  CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN, actualizarPuesto, cambiarRolDeIntegrante,
  crearPuesto, designarResponsableGps, expulsarDePuesto, generarInvitacion,
  obtenerEquipo, transferirPrincipal,
  obtenerIngresosForzados, type IngresoForzado,
  type CapacidadPropietario, type PermisoAdmin, type PuestoOperativo, type Rol,
} from '../api/establecimientos';
import Button from '../components/ui/Button';
import ConfirmModal from '../components/ConfirmModal';

const etiquetaRol = (rol: Rol) => rol === 'PROPIETARIO' ? 'Propietario' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor';

export function EditorPuesto({ puesto, guardar, bloqueado }: {
  puesto: PuestoOperativo;
  guardar: (puesto: PuestoOperativo, permisos: PermisoAdmin[], capacidades: CapacidadPropietario[]) => Promise<void>;
  bloqueado: boolean;
}) {
  const [permisos, setPermisos] = useState<PermisoAdmin[]>(puesto.permisos);
  const [capacidades, setCapacidades] = useState<CapacidadPropietario[]>(puesto.capacidades);
  useEffect(() => { setPermisos(puesto.permisos); setCapacidades(puesto.capacidades); }, [puesto]);
  return <details className="mt-3 rounded-lg border border-gray-200 p-3" data-puesto-operativo-id={puesto.id}>
    <summary className="cursor-pointer font-medium">Opciones avanzadas · {puesto.nombre}</summary>
    <p className="mt-2 text-sm text-amber-900">Los cambios afectan solamente a los integrantes de este puesto ({puesto.nombre}); los otros puestos Administrador no cambian. No existen permisos individuales.</p>
    {puesto.rol === 'ADMINISTRADOR' && Object.entries(PERMISOS_ADMIN).map(([codigo, [, titulo]]) =>
      <label key={codigo} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" disabled={bloqueado}
        checked={permisos.includes(codigo as PermisoAdmin)} onChange={e => setPermisos(actuales => e.target.checked
          ? [...actuales, codigo as PermisoAdmin] : actuales.filter(p => p !== codigo))} />{titulo}</label>)}
    {puesto.rol === 'PROPIETARIO' && Object.entries(CAPACIDADES_PROPIETARIO).map(([codigo, titulo]) =>
      <label key={codigo} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" disabled={bloqueado}
        checked={capacidades.includes(codigo as CapacidadPropietario)} onChange={e => setCapacidades(actuales => e.target.checked
          ? [...actuales, codigo as CapacidadPropietario] : actuales.filter(p => p !== codigo))} />{titulo}</label>)}
    {puesto.rol === 'VISOR' && <p className="mt-2 text-sm text-gray-600">Este puesto no tiene opciones configurables por ahora.</p>}
    {puesto.rol !== 'VISOR' && <Button disabled={bloqueado} onClick={() => {
      if (window.confirm(`Los cambios de ${puesto.nombre} afectarán a todos sus integrantes. ¿Continuar?`)) void guardar(puesto, permisos, capacidades);
    }}>Guardar configuración de {puesto.nombre}</Button>}
  </details>;
}

export default function PantallaEquipoOperativo() {
  const { establecimientoId, establecimiento, membresia, recargar } = useEstablecimiento();
  const [puestos, setPuestos] = useState<PuestoOperativo[]>([]);
  const [gps, setGps] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [rol, setRol] = useState<Rol>('ADMINISTRADOR');
  const [destinoId, setDestinoId] = useState('');
  const [capacidadesInvitacion, setCapacidadesInvitacion] = useState<CapacidadPropietario[]>([]);
  const [codigo, setCodigo] = useState<{ valor: string; vence: string; destino: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [permisosNuevos, setPermisosNuevos] = useState<PermisoAdmin[]>([]);
  const [expulsion, setExpulsion] = useState<{ puesto: PuestoOperativo; userId: string; username: string } | null>(null);
  const [ingresosForzados, setIngresosForzados] = useState<IngresoForzado[]>([]);

  async function cargar() {
    const equipo = await obtenerEquipo(establecimientoId);
    setPuestos(equipo.puestos); setGps(equipo.responsableGpsPuestoId);
  }
  useEffect(() => { void cargar().catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar el equipo.')); }, [establecimientoId]);
  useEffect(() => { if (membresia?.principal) void obtenerIngresosForzados(establecimientoId).then(r => setIngresosForzados(r.ingresos)).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar el historial.')); }, [establecimientoId, membresia?.principal]);
  const porDefecto = puestos.find(p => p.rol === rol && p.predeterminado);
  const destino = puestos.find(p => p.id === destinoId && p.rol === rol) ?? porDefecto;
  async function ejecutar(accion: () => Promise<void>) {
    setOcupado(true); setError('');
    try { await accion(); await cargar(); await recargar(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.'); }
    finally { setOcupado(false); }
  }
  const puedeInvitar = membresia?.rol === 'PROPIETARIO' || Boolean(membresia?.permisos.some(p =>
    p === 'invitar_visores' || p === 'invitar_administradores'));
  const puedeGestionarPuesto = (puesto: PuestoOperativo) => membresia?.rol === 'PROPIETARIO' ||
    puesto.rol === 'VISOR' && Boolean(membresia?.permisos.includes('gestionar_visores')) ||
    puesto.rol === 'ADMINISTRADOR' && Boolean(membresia?.permisos.includes('gestionar_administradores'));

  return <main className="min-h-screen bg-gray-100 p-4 sm:p-8"><div className="mx-auto flex max-w-4xl flex-col gap-4">
    <Link to={`/establecimientos/${establecimientoId}`} className="font-bold text-brand">← Volver al mapa</Link>
    <h1 className="text-2xl font-bold">Equipo · {establecimiento?.nombre}</h1>
    <p className="text-sm text-gray-600">Cuenta activa: {membresia?.nombreOperativo ?? etiquetaRol(membresia?.rol ?? 'VISOR')}</p>
    {error && <p role="alert" className="rounded bg-red-100 p-3 text-red-900">{error}</p>}
    {puedeInvitar && <section className="rounded-xl bg-white p-4 shadow"><Button onClick={() => setAgregando(!agregando)}>Agregar miembro</Button>
      {agregando && <div className="mt-4 flex flex-col gap-3"><label>Rol
        <select className="ml-2 rounded border p-2" value={rol} onChange={e => { setRol(e.target.value as Rol); setDestinoId(''); }}>
          <option value="PROPIETARIO">Propietario</option><option value="ADMINISTRADOR">Administrador</option><option value="VISOR">Visor</option>
        </select></label>
        {rol !== 'PROPIETARIO' && <p className="text-sm">La invitación dará acceso al puesto seleccionado: <strong>{destino?.nombre ?? 'No hay un puesto disponible'}</strong>, con sus permisos actuales.</p>}
        <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Opciones avanzadas</summary>
          {rol !== 'PROPIETARIO' && <label className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center">Puesto concreto
            <select className="w-full rounded border p-2 sm:ml-2 sm:w-auto" value={destino?.id ?? ''} onChange={e => setDestinoId(e.target.value)}>
              {puestos.filter(p => p.rol === rol).map(p => <option key={p.id} value={p.id}>{p.nombre}{p.predeterminado ? ' (predeterminado)' : ''}</option>)}
            </select></label>}
          {rol === 'PROPIETARIO' && Object.entries(CAPACIDADES_PROPIETARIO).map(([clave, titulo]) =>
            <label key={clave} className="flex items-center gap-2"><input type="checkbox" checked={capacidadesInvitacion.includes(clave as CapacidadPropietario)}
              onChange={e => setCapacidadesInvitacion(actual => e.target.checked ? [...actual, clave as CapacidadPropietario] : actual.filter(p => p !== clave))} />{titulo}</label>)}
        </details>
        <Button disabled={ocupado || (rol !== 'PROPIETARIO' && !destino)} onClick={() => void ejecutar(async () => {
          const respuesta = await generarInvitacion(establecimientoId, rol === 'PROPIETARIO'
            ? { rol, capacidades: capacidadesInvitacion } : { puestoOperativoId: destino!.id });
          setCodigo({ valor: respuesta.invitacion.codigo, vence: respuesta.invitacion.expiresAt,
            destino: rol === 'PROPIETARIO' ? 'Propietario' : destino!.nombre });
          setCopiado(false);
          setAgregando(false);
        })}>Generar código</Button>
      </div>}
    </section>}
    {codigo && <section className="rounded-xl border border-green-300 bg-white p-4"><h2 className="font-semibold">Código de un solo uso · {codigo.destino}</h2>
      <input aria-label="Código generado" readOnly value={codigo.valor} className="w-full rounded border p-2 font-mono" onFocus={e => e.target.select()} />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(codigo.valor); setCopiado(true); }
          catch { setCopiado(false); setError('No se pudo copiar automáticamente. Seleccioná el código y copialo manualmente.'); } }}>
          {copiado ? 'Copiado' : 'Copiar código'}
        </Button>
        <p className="text-sm">Vence a las {new Date(codigo.vence).toLocaleTimeString('es-AR')}. El servidor conserva sólo su hash.</p>
      </div></section>}
    {membresia?.rol === 'PROPIETARIO' && <section className="rounded-xl bg-white p-4"><h2 className="font-semibold">Responsable del GPS simulado</h2>
      <p className="text-sm">La alerta se entrega al puesto, aunque no haya nadie conectado.</p>
      <select aria-label="Puesto responsable del GPS simulado" className="rounded border p-2" value={gps ?? ''} disabled={ocupado}
        onChange={e => void ejecutar(() => designarResponsableGps(establecimientoId, e.target.value || null))}>
        <option value="">Sin responsable</option>{puestos.filter(p => p.rol === 'ADMINISTRADOR').map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select></section>}
    <div className="flex flex-col gap-3">{puestos.map(puesto => <section key={puesto.id} data-puesto-operativo-id={puesto.id} className="rounded-xl bg-white p-4 shadow">
      <h2 className="font-bold">{puesto.nombre}</h2><p className="text-sm text-gray-600">{etiquetaRol(puesto.rol)} · {puesto.integrantes.length} integrante(s)</p>
      <ul className="list-disc pl-5">{puesto.integrantes.map(persona => <li key={persona.userId} className="py-1">
        <span>{persona.username}</span>
        {persona.ultimaActividadEn !== undefined && <span className="ml-2 text-xs text-gray-500">{persona.enLinea ? 'En línea' : persona.ultimaActividadEn ? `Última actividad: ${new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(persona.ultimaActividadEn))}` : 'Sin registro disponible'}</span>}
        {puedeGestionarPuesto(puesto) && persona.userId !== membresia?.userId && <span className="ml-2 inline-flex gap-2">
          <select aria-label={`Cambiar rol de ${persona.username}`} defaultValue="" disabled={ocupado} className="rounded border text-sm"
            onChange={e => { const nuevo = e.target.value as Rol; if (nuevo && window.confirm(`Cambiar a ${persona.username} de ${puesto.nombre} a ${etiquetaRol(nuevo)}?`))
              void ejecutar(() => cambiarRolDeIntegrante(establecimientoId, puesto.id, persona.userId, nuevo).then(() => undefined)); e.target.value = ''; }}>
            <option value="">Cambiar rol…</option>{(['PROPIETARIO','ADMINISTRADOR','VISOR'] as Rol[]).filter(r => r !== puesto.rol).map(r =>
              <option key={r} value={r}>{etiquetaRol(r)}</option>)}
          </select>
          <Button variant="danger" size="sm" disabled={ocupado} onClick={() => setExpulsion({ puesto, userId: persona.userId, username: persona.username })}>Expulsar</Button>
          {membresia?.principal && puesto.rol === 'PROPIETARIO' && <Button variant="secondary" size="sm" disabled={ocupado}
            onClick={() => { const confirmacion = window.prompt('Escribí TRANSFERIR para cambiar el propietario principal.');
              if (confirmacion === 'TRANSFERIR') void ejecutar(() => transferirPrincipal(establecimientoId, persona.userId, confirmacion)); }}>
            Transferir principal</Button>}
        </span>}
      </li>)}</ul>
      {puedeGestionarPuesto(puesto) && puesto.id !== membresia?.puestoOperativoId && <EditorPuesto puesto={puesto} bloqueado={ocupado}
        guardar={(p, permisos, capacidades) => ejecutar(() => actualizarPuesto(establecimientoId, p, { rol: p.rol, permisos, capacidades }))} />}
    </section>)}</div>
    {membresia?.rol === 'PROPIETARIO' && <details className="rounded-xl bg-white p-4"><summary className="cursor-pointer font-semibold">Opciones avanzadas · Crear otro puesto administrador</summary>
      <p className="text-sm">El puesto tendrá sus propios permisos, integrantes, sesión y bandeja.</p>
      <label>Nombre<input className="ml-2 rounded border p-2" value={nombreNuevo} onChange={e => setNombreNuevo(e.target.value)} maxLength={80} /></label>
      <div>{Object.entries(PERMISOS_ADMIN).map(([clave, [, titulo]]) => <label key={clave} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={permisosNuevos.includes(clave as PermisoAdmin)} onChange={e => setPermisosNuevos(actual =>
          e.target.checked ? [...actual, clave as PermisoAdmin] : actual.filter(p => p !== clave))} />{titulo}</label>)}</div>
      <Button disabled={ocupado || !nombreNuevo.trim()} onClick={() => void ejecutar(async () => {
        await crearPuesto(establecimientoId, nombreNuevo.trim(), permisosNuevos); setNombreNuevo(''); setPermisosNuevos([]);
      })}>Crear puesto</Button>
    </details>}
    {membresia?.principal && <details className="rounded-xl bg-white p-4"><summary className="cursor-pointer font-semibold">Historial de ingresos forzados ({ingresosForzados.length})</summary>
      {ingresosForzados.length ? <ul className="mt-2 list-none space-y-2 p-0">{ingresosForzados.map(item => <li key={item.id} className="border-b py-2 text-sm">
        {new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(item.ocurridaEn))} · {item.actor} desplazó a {item.afectado} del puesto {item.puesto}.
      </li>)}</ul> : <p className="mt-2 text-sm text-gray-600">Todavía no hay ingresos forzados registrados.</p>}
    </details>}
    {expulsion && <ConfirmModal title="Expulsar integrante" message={`${expulsion.username} perderá el acceso al puesto ${expulsion.puesto.nombre} del establecimiento ${establecimiento?.nombre ?? ''}. Si está utilizando ese puesto, su sesión operativa también se cerrará.`}
      confirmText="Expulsar integrante" onCancel={() => setExpulsion(null)} onConfirm={() => { const actual = expulsion; if (!actual) return; setExpulsion(null); void ejecutar(() => expulsarDePuesto(establecimientoId, actual.puesto.id, actual.userId)); }} />}
  </div></main>;
}
