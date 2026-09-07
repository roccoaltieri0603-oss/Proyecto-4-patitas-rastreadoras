import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstablecimiento } from '../hooks/useEstablecimiento';
import { CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN, expulsarMiembro, generarInvitacion, modificarMiembro, obtenerEquipo, transferirPrincipal, type ConfiguracionMiembro, type Miembro, type PermisoAdmin, type Rol, type CapacidadPropietario } from '../api/establecimientos';
import { autorizarCambio, autorizarInvitacion, validarConfiguracion } from '../../backend/src/autorizacion/reglas';
import Button from '../components/ui/Button';

const vacia: ConfiguracionMiembro = { rol: 'VISOR', permisos: [], capacidades: [] };
export default function EquipoPage() {
  const { establecimientoId, membresia: actor, recargar, establecimiento } = useEstablecimiento();
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [objetivo, setObjetivo] = useState<Miembro | null>(null);
  const [config, setConfig] = useState<ConfiguracionMiembro>(vacia);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [invitacion, setInvitacion] = useState<{ codigo: string; expiresAt: string } | null>(null);
  const [confirmacion, setConfirmacion] = useState('');
  const [accion, setAccion] = useState<'guardar' | 'expulsar' | 'transferir'>('guardar');
  const [advertido, setAdvertido] = useState(false);
  const [copiado, setCopiado] = useState(false);
  async function cargar() { try { setMiembros((await obtenerEquipo(establecimientoId)).miembros); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el equipo.'); } }
  useEffect(() => { void cargar(); }, [establecimientoId]);
  useEffect(() => { setAbierto(false); }, [actor?.rol, actor?.principal, actor?.permisos.join(), actor?.capacidades.join()]);
  function autorizado(nueva: ConfiguracionMiembro | null, miembro = objetivo) {
    if (!actor) return false;
    try {
      if (miembro) autorizarCambio(actor, miembro, nueva ? validarConfiguracion(nueva) : null);
      else if (nueva) autorizarInvitacion(actor, validarConfiguracion(nueva)); else return false;
      return true;
    } catch { return false; }
  }
  function editar(miembro: Miembro | null, siguiente: typeof accion = 'guardar') {
    setObjetivo(miembro); setConfig(miembro ? { rol: miembro.rol, permisos: [...miembro.permisos], capacidades: [...miembro.capacidades] } : vacia);
    setAccion(siguiente); setAbierto(true); setAdvertido(false); setConfirmacion(''); setInvitacion(null); setError(''); setCopiado(false);
  }
  function todos() {
    if (!actor) return;
    const cualquiera = actor.rol === 'PROPIETARIO' || actor.permisos.includes(objetivo ? 'otorgar_cualquier_permiso' : 'crear_admin_cualquier_permiso');
    const otorgables = (Object.keys(PERMISOS_ADMIN) as PermisoAdmin[]).filter(p => cualquiera || actor.permisos.includes(p));
    // Conserva lo que el actor no puede revocar: seleccionar todos sólo agrega.
    const siguiente = { ...config, permisos: [...new Set([...config.permisos, ...otorgables])] };
    if (autorizado(siguiente)) setConfig(siguiente);
  }
  async function ejecutar() {
    setOcupado(true); setError('');
    try {
      if (accion === 'transferir' && objetivo) await transferirPrincipal(establecimientoId, objetivo.userId, confirmacion);
      else if (accion === 'expulsar' && objetivo) await expulsarMiembro(establecimientoId, objetivo.userId);
      else if (objetivo) await modificarMiembro(establecimientoId, objetivo.userId, config);
      else { setInvitacion((await generarInvitacion(establecimientoId, config)).invitacion); setAbierto(false); await cargar(); return; }
      setAbierto(false); await recargar(); await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setOcupado(false); }
  }
  const sensible = config.rol === 'PROPIETARIO' || config.permisos.length === Object.keys(PERMISOS_ADMIN).length;
  const puedeInvitar = [vacia, { ...vacia, rol: 'ADMINISTRADOR' as const }, { ...vacia, rol: 'PROPIETARIO' as const }].some(c => autorizado(c, null));
  return <main className="min-h-screen bg-gray-100 p-4 sm:p-8"><div className="mx-auto flex max-w-4xl flex-col gap-4">
    <Link to={`/establecimientos/${establecimientoId}`} className="font-bold text-brand">← Volver al mapa</Link>
    <h1 className="text-2xl font-bold">Equipo · {establecimiento?.nombre}</h1>
    {puedeInvitar && <Button onClick={() => editar(null)}>Generar código de invitación</Button>}
    <div className="flex flex-col gap-3">{miembros.map(m => <article key={m.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4"><div><strong>{m.username}</strong><p>{m.principal ? 'Propietario principal' : m.rol === 'ADMINISTRADOR' ? 'Administrador' : m.rol === 'VISOR' ? 'Visor' : 'Propietario'}</p>{m.capacidades.includes('protegido') && <p className="text-sm">Protegido contra expulsión</p>}{m.capacidades.includes('poderes_principal') && <p className="text-sm">Poderes de Propietario principal</p>}</div><div className="flex flex-wrap gap-2">
      {actor && !m.principal && m.userId !== actor.userId && (autorizado(m, m) || (m.rol === 'PROPIETARIO' && autorizado({ ...vacia }, m))) && <Button onClick={() => editar(m)}>Rol y permisos</Button>}
      {autorizado(null, m) && <Button variant="danger" onClick={() => editar(m, 'expulsar')}>Expulsar</Button>}
      {actor?.principal && !m.principal && m.rol === 'PROPIETARIO' && <Button variant="secondary" onClick={() => editar(m, 'transferir')}>Transferir propiedad principal</Button>}
    </div></article>)}</div>
    {invitacion && <section className="flex flex-col gap-3 rounded-xl border border-green-300 bg-white p-4"><h2 className="font-bold">Código de un solo uso</h2><input aria-label="Código generado" readOnly value={invitacion.codigo} className="w-full rounded border p-3 font-mono" onFocus={e => e.target.select()} /><p>Vence a las {new Date(invitacion.expiresAt).toLocaleTimeString()}. Dura 10 minutos desde su creación. Guardalo ahora; el servidor sólo conserva su hash.</p><Button onClick={async () => { try { await navigator.clipboard.writeText(invitacion.codigo); setCopiado(true); } catch { setError('Seleccioná y copiá el código del campo.'); } }}>{copiado ? 'Copiado' : 'Copiar código'}</Button></section>}
    {abierto && <section className="flex flex-col gap-4 rounded-xl border border-gray-300 bg-white p-5" aria-label="Configuración del miembro">
      <h2 className="text-xl font-bold">{objetivo ? objetivo.username : 'Nueva invitación'}</h2>
      {accion === 'guardar' ? <>
        <label className="flex flex-col gap-1">Rol<select className="min-h-11 rounded border p-2" value={config.rol} disabled={ocupado} onChange={e => { setConfig({ rol: e.target.value as Rol, permisos: [], capacidades: [] }); setAdvertido(false); }}>{(['VISOR','ADMINISTRADOR','PROPIETARIO'] as Rol[]).map(rol => <option key={rol} disabled={rol !== config.rol && !autorizado({ rol, permisos: [], capacidades: [] })} value={rol}>{rol === 'VISOR' ? 'Visor' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Propietario'}</option>)}</select></label>
        {config.rol === 'ADMINISTRADOR' && <><Button variant="secondary" disabled={ocupado} onClick={todos}>Seleccionar todos los permisos</Button>{[...new Set(Object.values(PERMISOS_ADMIN).map(v => v[0]))].map(grupo => <fieldset key={grupo} className="rounded-lg border p-3"><legend className="font-semibold">{grupo}</legend>{(Object.entries(PERMISOS_ADMIN) as [PermisoAdmin, readonly string[]][]).filter(([,v]) => v[0] === grupo).map(([p,v]) => {
          const siguiente = { ...config, permisos: config.permisos.includes(p) ? config.permisos.filter(x => x !== p) : [...config.permisos,p] };
          return <label key={p} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={config.permisos.includes(p)} disabled={ocupado || !autorizado(siguiente)} onChange={() => setConfig(siguiente)} />{v[1]}</label>;
        })}</fieldset>)}</>}
        {config.rol === 'PROPIETARIO' && <fieldset className="rounded-lg border p-3"><legend>Gobierno de otros propietarios</legend><p>Todos los propietarios tienen acceso operativo completo. Estas capacidades sólo regulan la gestión de otros propietarios.</p>{(Object.entries(CAPACIDADES_PROPIETARIO) as [CapacidadPropietario,string][]).map(([p,label]) => { const siguiente = { ...config, capacidades: config.capacidades.includes(p) ? config.capacidades.filter(x => x !== p) : [...config.capacidades,p] }; return <label key={p} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={config.capacidades.includes(p)} disabled={ocupado || !autorizado(siguiente)} onChange={() => setConfig(siguiente)} />{label}</label>; })}</fieldset>}
        {sensible && <label className="flex items-start gap-2 rounded-lg border-2 border-red-400 bg-red-50 p-4 text-red-900"><input type="checkbox" checked={advertido} onChange={e => setAdvertido(e.target.checked)} />{config.rol === 'PROPIETARIO' ? 'Entiendo que un Propietario tiene control operativo completo y que estas capacidades pueden darle autoridad sobre otros propietarios.' : 'Entiendo que estoy otorgando todos los permisos a un Administrador extremadamente poderoso.'}</label>}
      </> : <div className="flex flex-col gap-3 rounded-lg border-2 border-red-400 bg-red-50 p-4"><p>{accion === 'transferir' ? 'Vas a entregar la autoridad principal. Dejarás de ser el principal y conservarás tu membresía como Propietario normal, con acceso operativo completo pero sin ninguna capacidad especial de gobierno. Sólo el nuevo principal podrá transferir nuevamente o eliminar el establecimiento.' : 'Esta persona perderá el acceso al establecimiento. Sus datos e historial se conservarán.'}</p><label>Escribí {accion === 'transferir' ? 'TRANSFERIR' : 'EXPULSAR'} para confirmar<input className="mt-1 min-h-11 w-full rounded border bg-white p-2" value={confirmacion} onChange={e => setConfirmacion(e.target.value)} /></label></div>}
      <div className="flex flex-wrap gap-3"><Button disabled={ocupado || (accion === 'guardar' ? !autorizado(config) || sensible && !advertido : confirmacion !== (accion === 'transferir' ? 'TRANSFERIR' : 'EXPULSAR'))} onClick={ejecutar}>{ocupado ? 'Guardando…' : accion === 'guardar' ? objetivo ? 'Guardar cambios' : 'Generar código' : 'Confirmar'}</Button><Button variant="secondary" disabled={ocupado} onClick={() => setAbierto(false)}>Cancelar</Button></div>
    </section>}
    {error && <p role="alert" className="rounded-lg bg-red-100 p-3 text-red-800">{error}</p>}
  </div></main>;
}
