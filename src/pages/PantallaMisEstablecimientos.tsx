import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { entrarPuesto, listarEstablecimientos, unirseConCodigo, type EstablecimientoResumen } from '../api/establecimientos';
import { ApiError } from '../api/client';
import { actualizarEstablecimiento } from '../api/rodeo';
import Button from '../components/ui/Button';
import CampoBackdrop from '../components/ui/CampoBackdrop';
import PromptModal from '../components/PromptModal';
import { useNotificacionesPersonales } from '../hooks/useNotificacionesPersonales';
import PersonalNotifications, { PersonalNotificationsControls } from '../components/PersonalNotifications';
import { referenciaPuesto } from '../utils/puestos';
import { agruparAvisosPersonales, agruparEstablecimientos } from '../utils/notificaciones-personales';

export default function PantallaMisEstablecimientos({ username, onLogout }: { username: string; onLogout: () => Promise<void> }) {
  const [items, setItems] = useState<EstablecimientoResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [codigo, setCodigo] = useState('');
  const [unirse, setUnirse] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [renombrando, setRenombrando] = useState<EstablecimientoResumen | null>(null);
  const [ocupada, setOcupada] = useState<EstablecimientoResumen | null>(null);
  const navigate = useNavigate();
  const notificacionesPersonales = useNotificacionesPersonales();
  const gruposEstablecimientos = agruparEstablecimientos(items);
  const avisosAgrupados = agruparAvisosPersonales(notificacionesPersonales.items,
    new Set(gruposEstablecimientos.map((grupo) => grupo.id)));
  useEffect(() => { let vigente = true; listarEstablecimientos().then(r => { if (vigente) setItems(r.establecimientos); }).catch(e => { if (vigente) setError(e.message); }).finally(() => { if (vigente) setCargando(false); }); return () => { vigente = false; }; }, []);
  async function ingresar(item: EstablecimientoResumen, forzar = false) {
    setError('');
    try {
      await entrarPuesto(item.id, item.membresia.puestoOperativoId, forzar);
      setOcupada(null);
      navigate(`/establecimientos/${item.id}`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'OPERATION_POST_BUSY') setOcupada(item);
      else setError(reason instanceof Error ? reason.message : 'No se pudo entrar al puesto.');
    }
  }
  return <CampoBackdrop><main className="absolute inset-0 overflow-y-auto p-4 sm:p-8"><div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl bg-white/95 p-5 shadow-xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-brand">Mis establecimientos</h1><Button variant="link" onClick={onLogout}>Cerrar sesión</Button></div>
    <p>Sesión activa: <strong>{username}</strong></p>
    {cargando ? <p>Cargando…</p> : items.length === 0 && <p>Creá un establecimiento o unite con un código de invitación.</p>}
    {gruposEstablecimientos.map(grupo => {
      const puestoRenombrable = grupo.membresias.find(membresia => membresia.rol === 'PROPIETARIO' || membresia.permisos.includes('renombrar_establecimiento'));
      return <article key={grupo.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{grupo.nombre}</h2>{grupo.membresias.some(m => m.principal) && !grupo.onboardingCompleted && <p className="text-sm text-gray-600">Configuración pendiente</p>}</div>
          {puestoRenombrable && <Button variant="secondary" size="sm" onClick={() => setRenombrando({ id: grupo.id, nombre: grupo.nombre,
            onboardingCompleted: grupo.onboardingCompleted, membresia: puestoRenombrable })}>Renombrar</Button>}
        </div>
        <ul className="flex list-none flex-col gap-2 p-0">{grupo.membresias.map(membresia => {
          const establecimiento = { id: grupo.id, nombre: grupo.nombre, onboardingCompleted: grupo.onboardingCompleted, membresia };
          return <li key={membresia.puestoOperativoId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
            <div><p className="font-medium">{membresia.nombreOperativo}</p><p className="text-sm text-gray-600">{membresia.rol}</p>
              <p className="font-mono text-xs text-gray-500" title={`ID completo del puesto: ${membresia.puestoOperativoId}`}>Puesto · {referenciaPuesto(membresia.puestoOperativoId)}</p></div>
            <Button onClick={() => void ingresar(establecimiento)}>Entrar</Button>
          </li>;
        })}</ul>
        <PersonalNotifications items={avisosAgrupados.visibles.get(grupo.id) ?? []} establecimientoNombre={grupo.nombre}
          accionando={notificacionesPersonales.accionando} marcarLeida={notificacionesPersonales.marcarLeida}
          eliminarLeida={notificacionesPersonales.eliminarLeida} />
      </article>;
    })}
    {!cargando && !error && [...avisosAgrupados.sinAcceso.entries()].map(([establecimientoId, avisos]) => <article key={establecimientoId}
      className="rounded-xl border border-gray-200 p-4"><PersonalNotifications items={avisos}
        establecimientoNombre={avisos[0]?.establecimientoNombre ?? 'Establecimiento'} sinAcceso
        accionando={notificacionesPersonales.accionando} marcarLeida={notificacionesPersonales.marcarLeida}
        eliminarLeida={notificacionesPersonales.eliminarLeida} /></article>)}
    {ocupada && <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4"><p>La cuenta {ocupada.membresia.nombreOperativo} (puesto · {referenciaPuesto(ocupada.membresia.puestoOperativoId)}) de {ocupada.nombre} ya está en uso.</p><div className="flex gap-2"><Button variant="secondary" onClick={() => setOcupada(null)}>Volver a mis establecimientos</Button><Button onClick={() => void ingresar(ocupada, true)}>Forzar ingreso</Button></div></section>}
    <div className="flex flex-wrap gap-3"><Link to="/establecimientos/nuevo" className="rounded-lg bg-brand px-4 py-3 text-white">Crear establecimiento</Link><Button onClick={() => { setUnirse(!unirse); setError(''); }}>Unirme con código</Button></div>
    {unirse && <form className="flex flex-col gap-3" onSubmit={async e => { e.preventDefault(); setEnviando(true); setError(''); try { const r = await unirseConCodigo(codigo); const listado = await listarEstablecimientos(); setItems(listado.establecimientos); const item = listado.establecimientos.find(x => x.membresia.puestoOperativoId === r.puestoOperativoId); if (item) await ingresar(item); else setError('La invitación se aceptó, pero no apareció el puesto en tu lista. Actualizá la pantalla antes de volver a usar el código.'); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aceptar el código.'); } finally { setEnviando(false); } }}><label className="flex flex-col gap-1">Código de invitación<input required value={codigo} onChange={e => setCodigo(e.target.value.replace(/\s/gu, ''))} autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={enviando} aria-describedby="ayuda-codigo-invitacion" className="min-h-11 rounded border p-2 font-mono" /></label><p id="ayuda-codigo-invitacion" className="text-sm text-gray-600">Pegá el código completo. Se descartan espacios y saltos de línea accidentales.</p><Button type="submit" disabled={enviando}>{enviando ? 'Uniéndote…' : 'Aceptar invitación'}</Button></form>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <PersonalNotificationsControls {...notificacionesPersonales} />
    {renombrando && <PromptModal title="Renombrar establecimiento" label="Nombre" initialValue={renombrando.nombre} onConfirm={async nombre => { try { await entrarPuesto(renombrando.id, renombrando.membresia.puestoOperativoId); await actualizarEstablecimiento(renombrando.id, { nombre }); setItems(actuales => actuales.map(item => item.id === renombrando.id ? { ...item, nombre } : item)); setRenombrando(null); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar el establecimiento.'); } }} onCancel={() => setRenombrando(null)} />}
  </div></main></CampoBackdrop>;
}
