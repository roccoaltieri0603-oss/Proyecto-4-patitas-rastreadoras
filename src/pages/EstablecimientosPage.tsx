import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listarEstablecimientos, unirseConCodigo, type EstablecimientoResumen } from '../api/establecimientos';
import Button from '../components/ui/Button';
import CampoBackdrop from '../components/ui/CampoBackdrop';

export default function EstablecimientosPage({ username, onLogout }: { username: string; onLogout: () => Promise<void> }) {
  const [items, setItems] = useState<EstablecimientoResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [codigo, setCodigo] = useState('');
  const [unirse, setUnirse] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { let vigente = true; listarEstablecimientos().then(r => { if (vigente) setItems(r.establecimientos); }).catch(e => { if (vigente) setError(e.message); }).finally(() => { if (vigente) setCargando(false); }); return () => { vigente = false; }; }, []);
  return <CampoBackdrop><main className="absolute inset-0 overflow-y-auto p-4 sm:p-8"><div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl bg-white/95 p-5 shadow-xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-brand">Mis establecimientos</h1><Button variant="link" onClick={onLogout}>Cerrar sesión</Button></div>
    <p>Sesión activa: <strong>{username}</strong></p>
    {cargando ? <p>Cargando…</p> : items.length === 0 && <p>Creá un establecimiento o unite con un código de invitación.</p>}
    {items.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4"><div><h2 className="font-bold">{item.nombre}</h2><p>{item.membresia.principal ? 'Propietario principal' : item.membresia.rol === 'PROPIETARIO' ? 'Propietario' : item.membresia.rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor'}</p>{item.membresia.principal && !item.onboardingCompleted && <p className="text-sm text-gray-600">Configuración pendiente</p>}</div><Link to={`/establecimientos/${item.id}`} className="rounded-lg bg-brand px-4 py-3 text-white">Entrar</Link></article>)}
    <div className="flex flex-wrap gap-3"><Link to="/establecimientos/nuevo" className="rounded-lg bg-brand px-4 py-3 text-white">Crear establecimiento</Link><Button onClick={() => { setUnirse(!unirse); setError(''); }}>Unirme con código</Button></div>
    {unirse && <form className="flex flex-col gap-3" onSubmit={async e => { e.preventDefault(); setEnviando(true); setError(''); try { const r = await unirseConCodigo(codigo.trim()); navigate(`/establecimientos/${r.establecimientoId}`); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aceptar el código.'); } finally { setEnviando(false); } }}><label className="flex flex-col gap-1">Código de invitación<input required value={codigo} onChange={e => setCodigo(e.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={enviando} className="min-h-11 rounded border p-2" /></label><Button type="submit" disabled={enviando}>{enviando ? 'Uniéndote…' : 'Aceptar invitación'}</Button></form>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </div></main></CampoBackdrop>;
}
