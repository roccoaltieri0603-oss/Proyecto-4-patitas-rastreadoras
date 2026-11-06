import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { entrarPuesto, listarEstablecimientos, unirseConCodigo, type EstablecimientoResumen } from '../api/establecimientos';
import { etiquetaRol } from '../utils/puestos';
import { ApiError } from '../api/client';
import { actualizarEstablecimiento } from '../api/rodeo';
import fondo from '../assets/establecimientos-fondo.jpg';
import PromptModal from '../components/PromptModal';
import { useNotificacionesPersonales } from '../hooks/useNotificacionesPersonales';
import PersonalNotifications, { PersonalNotificationsControls } from '../components/PersonalNotifications';
import { agruparAvisosPersonales, agruparEstablecimientos } from '../utils/notificaciones-personales';

/*
 * Frames "Mis establecimientos" y "… · unirme con código" del Figma (1280×832).
 * La tarjeta de vidrio mide 640 px de ancho y todo adentro va en las medidas
 * exactas del frame; debajo de `sm` sólo se achican el padding y el título.
 */
const BOTON_BASE =
  'foco-campo inline-flex cursor-pointer items-center justify-center rounded-full font-medium transition-colors disabled:cursor-default disabled:opacity-60';
/** "Login / Botón" blanco: 48 px, texto 18/22. */
const BOTON_CLARO = `${BOTON_BASE} h-12 border-0 bg-white/95 px-[26px] text-[18px] leading-[22px] text-landing-tinta no-underline hover:bg-white`;
/** "Login / Botón" con contorno: 52 px por el borde de 2 px. */
const BOTON_CONTORNO = `${BOTON_BASE} h-[52px] border-2 border-white/95 bg-white/4 px-[26px] text-[18px] leading-[22px] text-white hover:bg-white/10`;
/** "Renombrar": píldora chica con borde de 1,5 px. */
const PILDORA_CONTORNO = `${BOTON_BASE} h-[35px] border-[1.5px] border-white/95 bg-white/4 px-[14px] text-sm leading-[18px] text-white hover:bg-white/10`;
/** "Entrar": píldora chica blanca. */
const PILDORA_CLARA = `${BOTON_BASE} h-8 border-0 bg-white/95 px-[14px] text-sm leading-[18px] text-landing-tinta hover:bg-white`;

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
  async function aceptarInvitacion() {
    setEnviando(true); setError('');
    try {
      const r = await unirseConCodigo(codigo);
      const listado = await listarEstablecimientos();
      setItems(listado.establecimientos);
      const item = listado.establecimientos.find(x => x.membresia.puestoOperativoId === r.puestoOperativoId);
      if (item) await ingresar(item);
      else setError('La invitación se aceptó, pero no apareció el puesto en tu lista. Actualizá la pantalla antes de volver a usar el código.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aceptar el código.');
    } finally { setEnviando(false); }
  }

  return <main className="relative h-full min-h-screen w-full overflow-hidden bg-[#6f8ba3] font-display text-white">
    {/* La foto va en su propia capa fija: la tarjeta lleva backdrop-filter y,
        si el fondo scrollea con ella, el navegador lo vuelve a desenfocar en
        cada cuadro. */}
    <img src={fondo} alt="" className="pointer-events-none absolute inset-0 h-full w-full transform-gpu object-cover" />

    {/* min-h-full + items-center: centrada como en el frame cuando entra, y
        scrolleable sin recortar el principio cuando hay varios establecimientos. */}
    <div className="sin-barra-scroll absolute inset-0 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
        <div className="flex w-full max-w-[640px] flex-col gap-5 rounded-[32px] border border-white/25 bg-[rgba(168,190,196,0.22)] p-6 backdrop-blur-[20px] sm:rounded-[40px] sm:p-8">

          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h1 className="m-0 text-[32px] leading-[38px] font-medium tracking-[-0.02em] text-white sm:text-[40px] sm:leading-[46px]">
              Mis establecimientos
            </h1>
            <button type="button" onClick={onLogout}
              className="foco-campo cursor-pointer rounded border-0 bg-transparent p-0 text-[15px] leading-[18px] font-medium text-white underline hover:no-underline">
              Cerrar sesión
            </button>
          </header>

          <p className="m-0 text-base leading-5 text-white/85">Sesión activa: {username}</p>

          {cargando
            ? <p aria-live="polite" className="m-0 text-base leading-5 text-white/85">Cargando…</p>
            : items.length === 0 && !error && <p className="m-0 text-base leading-5 text-white/85">Creá un establecimiento o unite con un código de invitación.</p>}

          {gruposEstablecimientos.map(grupo => {
            const puestoRenombrable = grupo.membresias.find(membresia => membresia.rol === 'PROPIETARIO' || membresia.permisos.includes('renombrar_establecimiento'));
            return <article key={grupo.id}
              className="flex flex-col gap-[14px] rounded-3xl border border-white/40 bg-white/14 py-[18px] pr-[18px] pl-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="m-0 text-2xl leading-[30px] font-semibold tracking-[-0.01em] text-white">{grupo.nombre}</h2>
                  {grupo.membresias.some(m => m.principal) && !grupo.onboardingCompleted &&
                    <p className="m-0 text-sm leading-[18px] text-white/75">Configuración pendiente</p>}
                </div>
                {puestoRenombrable && <button type="button" className={PILDORA_CONTORNO}
                  onClick={() => setRenombrando({ id: grupo.id, nombre: grupo.nombre, onboardingCompleted: grupo.onboardingCompleted, membresia: puestoRenombrable })}>
                  Renombrar
                </button>}
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">{grupo.membresias.map(membresia => {
                const establecimiento = { id: grupo.id, nombre: grupo.nombre, onboardingCompleted: grupo.onboardingCompleted, membresia };
                return <li key={membresia.puestoOperativoId}
                  className="flex min-h-[66px] items-center justify-between gap-3 rounded-[18px] bg-white/12 py-3 pr-3 pl-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="m-0 text-[17px] leading-[22px] font-medium text-white">{membresia.nombreOperativo}</p>
                    <p className="m-0 text-sm leading-[18px] text-white/75">{etiquetaRol(membresia.rol)}</p>
                  </div>
                  <button type="button" className={PILDORA_CLARA} onClick={() => void ingresar(establecimiento)}>Entrar</button>
                </li>;
              })}</ul>
              <PersonalNotifications items={avisosAgrupados.visibles.get(grupo.id) ?? []} establecimientoNombre={grupo.nombre}
                accionando={notificacionesPersonales.accionando} marcarLeida={notificacionesPersonales.marcarLeida}
                eliminarLeida={notificacionesPersonales.eliminarLeida} />
            </article>;
          })}

          {!cargando && !error && [...avisosAgrupados.sinAcceso.entries()].map(([establecimientoId, avisos]) => <article key={establecimientoId}
            className="rounded-3xl border border-white/40 bg-white/14 py-[18px] pr-[18px] pl-5"><PersonalNotifications items={avisos}
              establecimientoNombre={avisos[0]?.establecimientoNombre ?? 'Establecimiento'} sinAcceso
              accionando={notificacionesPersonales.accionando} marcarLeida={notificacionesPersonales.marcarLeida}
              eliminarLeida={notificacionesPersonales.eliminarLeida} /></article>)}

          {ocupada && <section role="alert" className="flex flex-col gap-3 rounded-3xl border border-amber-200/70 bg-amber-300/20 py-[18px] pr-[18px] pl-5">
            <p className="m-0 text-base leading-5 text-white">La cuenta {ocupada.membresia.nombreOperativo} de {ocupada.nombre} ya está en uso.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PILDORA_CONTORNO} onClick={() => setOcupada(null)}>Volver a mis establecimientos</button>
              <button type="button" className={`${PILDORA_CLARA} h-[35px]`} onClick={() => void ingresar(ocupada, true)}>Forzar ingreso</button>
            </div>
          </section>}

          <div className="flex flex-wrap items-start gap-3">
            <Link to="/establecimientos/nuevo" className={BOTON_CLARO}>Crear establecimiento</Link>
            <button type="button" aria-expanded={unirse} aria-controls="form-unirse"
              className={unirse ? BOTON_CLARO : BOTON_CONTORNO}
              onClick={() => { setUnirse(!unirse); setError(''); }}>
              Unirme con código
            </button>
          </div>

          {unirse && <form id="form-unirse" className="flex flex-col" onSubmit={e => { e.preventDefault(); void aceptarInvitacion(); }}>
            <label htmlFor="codigo-invitacion" className="text-base leading-5 font-medium text-white">Código de invitación</label>
            <input id="codigo-invitacion" required value={codigo} onChange={e => setCodigo(e.target.value.replace(/\s/gu, ''))}
              placeholder="Pegá el código completo" autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={enviando}
              aria-describedby="ayuda-codigo-invitacion"
              className="campo-acceso mt-2 h-[50px] w-full rounded-full border-2 border-white/95 bg-white/8 px-5 text-base leading-5 text-white outline-none transition-colors placeholder:text-white/70 focus:border-verde-accion disabled:opacity-60" />
            <p id="ayuda-codigo-invitacion" className="m-0 mt-2 text-[13px] leading-[18px] text-white/75">Se descartan espacios y saltos de línea accidentales.</p>
            {/* 6 px y no 20: en el frame la ayuda desborda la caja de 90 px del
                campo y el botón queda pegado a ella. */}
            <button type="submit" disabled={enviando} className={`${BOTON_CLARO} mt-1.5 w-full`}>
              {enviando ? 'Uniéndote…' : 'Aceptar invitación'}
            </button>
          </form>}

          {error && <p role="alert" className="m-0 rounded-2xl border border-red-300/60 bg-red-500/20 px-4 py-2.5 text-sm leading-[19px] text-white">{error}</p>}

          <PersonalNotificationsControls {...notificacionesPersonales} />
        </div>
      </div>
    </div>

    {renombrando && <PromptModal title="Renombrar establecimiento" label="Nombre" initialValue={renombrando.nombre} onConfirm={async nombre => { try { await entrarPuesto(renombrando.id, renombrando.membresia.puestoOperativoId); await actualizarEstablecimiento(renombrando.id, { nombre }); setItems(actuales => actuales.map(item => item.id === renombrando.id ? { ...item, nombre } : item)); setRenombrando(null); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar el establecimiento.'); } }} onCancel={() => setRenombrando(null)} />}
  </main>;
}
