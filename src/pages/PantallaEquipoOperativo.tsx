import { useEffect, useState } from 'react';
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
import PromptModal from '../components/PromptModal';
import PantallaDatos, { TARJETA, PASTILLA_VERDE, PASTILLA_CLARA, TITULO_SECCION, APAGADO } from '../components/ui/PantallaDatos';

const etiquetaRol = (rol: Rol) => rol === 'PROPIETARIO' ? 'Propietario' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor';

const CAMPO = 'rounded-lg border border-gray-200 bg-white p-2 text-sm';
const RESUMEN_DETALLE = 'foco-campo flex cursor-pointer items-center gap-2 font-medium text-gray-900';

const contarIntegrantes = (cantidad: number) => `${cantidad} ${cantidad === 1 ? 'integrante' : 'integrantes'}`;

/** Iniciales para el avatar del integrante. Sale del username, no se inventa un nombre. */
function iniciales(username: string): string {
  const partes = username.trim().split(/[\s._-]+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

function fechaLarga(iso: string, estilo: 'full' | 'medium' = 'medium'): string {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: estilo, timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso));
}

function Casilla({ etiqueta, marcada, bloqueada, onCambiar }: {
  etiqueta: string; marcada: boolean; bloqueada: boolean; onCambiar: (valor: boolean) => void;
}) {
  return <label className={`flex min-h-9 items-center gap-2 text-sm ${marcada ? 'text-gray-900' : 'text-gray-400'}`}>
    <input type="checkbox" className="h-4 w-4 accent-[var(--color-campo-600)]" disabled={bloqueada}
      checked={marcada} onChange={e => onCambiar(e.target.checked)} />
    {etiqueta}
  </label>;
}

export function EditorPuesto({ puesto, guardar, bloqueado, expandido = false }: {
  puesto: PuestoOperativo;
  guardar: (puesto: PuestoOperativo, permisos: PermisoAdmin[], capacidades: CapacidadPropietario[]) => Promise<void>;
  bloqueado: boolean;
  /** El puesto administrador muestra sus permisos a la vista; el resto, plegados. */
  expandido?: boolean;
}) {
  const [permisos, setPermisos] = useState<PermisoAdmin[]>(puesto.permisos);
  const [capacidades, setCapacidades] = useState<CapacidadPropietario[]>(puesto.capacidades);
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => { setPermisos(puesto.permisos); setCapacidades(puesto.capacidades); }, [puesto]);

  const cuerpo = <>
    <p className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
      <span aria-hidden="true" className="mr-1.5 text-amber-500">●</span>
      Los cambios afectan solamente a los integrantes de este puesto ({puesto.nombre}); los otros puestos
      Administrador no cambian. No existen permisos individuales.
    </p>
    {puesto.rol !== 'VISOR' && <p className="mt-4 mb-1 text-[0.72rem] font-bold tracking-[0.06em] text-[#2f855a] uppercase">Permisos del puesto</p>}
    <div className="grid gap-x-6 sm:grid-cols-2">
      {puesto.rol === 'ADMINISTRADOR' && Object.entries(PERMISOS_ADMIN).map(([codigo, [, titulo]]) =>
        <Casilla key={codigo} etiqueta={titulo} bloqueada={bloqueado} marcada={permisos.includes(codigo as PermisoAdmin)}
          onCambiar={marcada => setPermisos(actuales => {
            let siguiente = marcada ? [...actuales, codigo as PermisoAdmin] : actuales.filter(p => p !== codigo);
            if (codigo === 'modificar_dispositivos_gps' && marcada && !siguiente.includes('ver_dispositivos_gps')) siguiente = [...siguiente, 'ver_dispositivos_gps'];
            if (codigo === 'ver_dispositivos_gps' && !marcada) siguiente = siguiente.filter(p => p !== 'modificar_dispositivos_gps');
            return [...new Set(siguiente)];
          })} />)}
      {puesto.rol === 'PROPIETARIO' && Object.entries(CAPACIDADES_PROPIETARIO).map(([codigo, titulo]) =>
        <Casilla key={codigo} etiqueta={titulo} bloqueada={bloqueado} marcada={capacidades.includes(codigo as CapacidadPropietario)}
          onCambiar={marcada => setCapacidades(actuales => marcada
            ? [...actuales, codigo as CapacidadPropietario] : actuales.filter(p => p !== codigo))} />)}
    </div>
    {puesto.rol === 'VISOR' && <p className="mt-2 text-sm text-gray-600">Este puesto no tiene opciones configurables por ahora.</p>}
    {puesto.rol !== 'VISOR' && <button type="button" className={`${PASTILLA_VERDE} mt-4`} disabled={bloqueado} onClick={() => setConfirmando(true)}>
      Guardar configuración
    </button>}
    {confirmando && <ConfirmModal
      title={`Guardar configuración de ${puesto.nombre}`}
      message={`Los cambios de ${puesto.nombre} afectarán a todos sus integrantes.`}
      confirmText="Guardar configuración"
      confirmVariant="primary"
      onCancel={() => setConfirmando(false)}
      onConfirm={() => { setConfirmando(false); void guardar(puesto, permisos, capacidades); }} />}
  </>;

  if (expandido) return <div data-puesto-operativo-id={puesto.id}>{cuerpo}</div>;

  return <details className="mt-3 rounded-xl border border-gray-200 p-3" data-puesto-operativo-id={puesto.id}>
    <summary className={RESUMEN_DETALLE}>Opciones avanzadas · {puesto.nombre}</summary>
    <div className="mt-3">{cuerpo}</div>
  </details>;
}

interface TarjetaPuestoProps {
  puesto: PuestoOperativo;
  /** El administrador muestra sus permisos desplegados; los demás, plegados. */
  expandido: boolean;
  gestionable: boolean;
  ocupado: boolean;
  esPrincipal: boolean;
  userIdPropio?: string;
  puestoPropioId?: string;
  onCambiarRol: (cambio: { puesto: PuestoOperativo; userId: string; username: string; nuevo: Rol }) => void;
  onExpulsar: (expulsion: { puesto: PuestoOperativo; userId: string; username: string }) => void;
  onTransferir: (transferencia: { userId: string; username: string }) => void;
  onGuardar: (puesto: PuestoOperativo, permisos: PermisoAdmin[], capacidades: CapacidadPropietario[]) => Promise<void>;
}

function TarjetaPuesto({ puesto, expandido, gestionable, ocupado, esPrincipal, userIdPropio, puestoPropioId, onCambiarRol, onExpulsar, onTransferir, onGuardar }: TarjetaPuestoProps) {
  return <section data-puesto-operativo-id={puesto.id} className={`${TARJETA} p-5`}>
    <div className="flex flex-wrap items-center gap-2">
      <h2 className={TITULO_SECCION}>{puesto.nombre}</h2>
      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[0.74rem] text-gray-500">{contarIntegrantes(puesto.integrantes.length)}</span>
    </div>

    {puesto.integrantes.length === 0
      ? <p className={`${APAGADO} mt-3`}>
          Todavía no hay integrantes en este puesto. Generá un código desde <strong>Agregar miembro</strong> para sumar a alguien.
        </p>
      : <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {puesto.integrantes.map(persona => <li key={persona.userId} className="rounded-xl bg-gray-50/80 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-campo-100)] text-[0.8rem] font-semibold text-[var(--color-campo-700)]">
              {iniciales(persona.username)}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-gray-900">{persona.username}</strong>
              <span className="block truncate text-[0.78rem] text-gray-500">{puesto.nombre}</span>
            </span>
            {persona.ultimaActividadEn !== undefined && (persona.enLinea
              ? <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[0.72rem] font-semibold text-green-800">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-600" />En línea
                </span>
              : <span className="text-[0.74rem] text-gray-400">
                  {persona.ultimaActividadEn ? `Última actividad: ${fechaLarga(persona.ultimaActividadEn)}` : 'Sin registro disponible'}
                </span>)}
          </div>
          {gestionable && persona.userId !== userIdPropio && <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label={`Cambiar rol de ${persona.username}`} value="" disabled={ocupado} className={CAMPO}
              onChange={e => { const nuevo = e.target.value as Rol; if (nuevo) onCambiarRol({ puesto, userId: persona.userId, username: persona.username, nuevo }); e.target.value = ''; }}>
              <option value="">Cambiar rol…</option>{(['PROPIETARIO', 'ADMINISTRADOR', 'VISOR'] as Rol[]).filter(r => r !== puesto.rol).map(r =>
                <option key={r} value={r}>{etiquetaRol(r)}</option>)}
            </select>
            <Button variant="danger" size="sm" disabled={ocupado} onClick={() => onExpulsar({ puesto, userId: persona.userId, username: persona.username })}>Expulsar</Button>
            {esPrincipal && puesto.rol === 'PROPIETARIO' && <Button variant="secondary" size="sm" disabled={ocupado}
              onClick={() => onTransferir({ userId: persona.userId, username: persona.username })}>Transferir principal</Button>}
          </div>}
        </li>)}
      </ul>}

    {gestionable && puesto.id !== puestoPropioId && <div className={expandido ? 'mt-4' : ''}>
      <EditorPuesto puesto={puesto} bloqueado={ocupado} expandido={expandido} guardar={onGuardar} />
    </div>}
  </section>;
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
  const [cambioDeRol, setCambioDeRol] = useState<{ puesto: PuestoOperativo; userId: string; username: string; nuevo: Rol } | null>(null);
  const [transferencia, setTransferencia] = useState<{ userId: string; username: string } | null>(null);
  const [ingresosForzados, setIngresosForzados] = useState<IngresoForzado[]>([]);
  // Sin esto la pantalla aparece vacía mientras llega el equipo y parece rota.
  const [cargandoEquipo, setCargandoEquipo] = useState(true);

  async function cargar() {
    try {
      const equipo = await obtenerEquipo(establecimientoId);
      setPuestos(equipo.puestos); setGps(equipo.responsableGpsPuestoId);
    } finally { setCargandoEquipo(false); }
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

  // La columna ancha es para los puestos administradores, que son los que
  // tienen la grilla de permisos; propietario y visores van a la izquierda.
  const puestosAdministradores = puestos.filter(p => p.rol === 'ADMINISTRADOR');
  const puestosLaterales = puestos.filter(p => p.rol !== 'ADMINISTRADOR');

  // Definida fuera del render (ver TarjetaPuesto, abajo): si viviera acá dentro,
  // cada re-render del equipo remontaría el editor y borraría las casillas a
  // medio tildar.
  const tarjeta = (puesto: PuestoOperativo, expandido: boolean) => <TarjetaPuesto
    key={puesto.id}
    puesto={puesto}
    expandido={expandido}
    gestionable={puedeGestionarPuesto(puesto)}
    ocupado={ocupado}
    esPrincipal={Boolean(membresia?.principal)}
    userIdPropio={membresia?.userId}
    puestoPropioId={membresia?.puestoOperativoId}
    onCambiarRol={setCambioDeRol}
    onExpulsar={setExpulsion}
    onTransferir={setTransferencia}
    onGuardar={(p, permisos, capacidades) => ejecutar(() => actualizarPuesto(establecimientoId, p, { rol: p.rol, permisos, capacidades }))}
  />;

  return <PantallaDatos
    volanta="Equipo"
    titulo={`Equipo · ${establecimiento?.nombre ?? ''}`}
    subtitulo={`Cuenta activa: ${membresia?.nombreOperativo ?? etiquetaRol(membresia?.rol ?? 'VISOR')}`}
    accion={puedeInvitar && <button type="button" className={PASTILLA_VERDE} onClick={() => setAgregando(!agregando)}>Agregar miembro</button>}
    encabezadoExtra={error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : undefined}
  >
    {puedeInvitar && agregando && <section className={`${TARJETA} p-5`}>
      <h2 className={TITULO_SECCION}>Agregar miembro</h2>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">Rol
          <select className={CAMPO} value={rol} onChange={e => { setRol(e.target.value as Rol); setDestinoId(''); }}>
            <option value="PROPIETARIO">Propietario</option><option value="ADMINISTRADOR">Administrador</option><option value="VISOR">Visor</option>
          </select></label>
        {rol !== 'PROPIETARIO' && <p className="m-0 text-sm text-gray-600">La invitación dará acceso al puesto seleccionado: <strong>{destino?.nombre ?? 'No hay un puesto disponible'}</strong>, con sus permisos actuales.</p>}
        <details className="rounded-xl border border-gray-200 p-3"><summary className={RESUMEN_DETALLE}>Opciones avanzadas</summary>
          {rol !== 'PROPIETARIO' && <label className="mt-2 flex flex-col gap-1 text-sm sm:flex-row sm:items-center">Puesto concreto
            <select className={`${CAMPO} w-full sm:ml-2 sm:w-auto`} value={destino?.id ?? ''} onChange={e => setDestinoId(e.target.value)}>
              {puestos.filter(p => p.rol === rol).map(p => <option key={p.id} value={p.id}>{p.nombre}{p.predeterminado ? ' (predeterminado)' : ''}</option>)}
            </select></label>}
          {rol === 'PROPIETARIO' && <div className="mt-2 grid gap-x-6 sm:grid-cols-2">{Object.entries(CAPACIDADES_PROPIETARIO).map(([clave, titulo]) =>
            <Casilla key={clave} etiqueta={titulo} bloqueada={false} marcada={capacidadesInvitacion.includes(clave as CapacidadPropietario)}
              onCambiar={marcada => setCapacidadesInvitacion(actual => marcada ? [...actual, clave as CapacidadPropietario] : actual.filter(p => p !== clave))} />)}</div>}
        </details>
        <button type="button" className={`${PASTILLA_VERDE} w-fit`} disabled={ocupado || (rol !== 'PROPIETARIO' && !destino)} onClick={() => void ejecutar(async () => {
          const respuesta = await generarInvitacion(establecimientoId, rol === 'PROPIETARIO'
            ? { rol, capacidades: capacidadesInvitacion } : { puestoOperativoId: destino!.id });
          setCodigo({ valor: respuesta.invitacion.codigo, vence: respuesta.invitacion.expiresAt,
            destino: rol === 'PROPIETARIO' ? 'Propietario' : destino!.nombre });
          setCopiado(false);
          setAgregando(false);
        })}>Generar código</button>
      </div>
    </section>}

    {codigo && <section className={`${TARJETA} border-green-300 p-5`}>
      <h2 className={TITULO_SECCION}>Código de un solo uso · {codigo.destino}</h2>
      <input aria-label="Código generado" readOnly value={codigo.valor} className="mt-3 w-full rounded-lg border border-gray-200 p-2 font-mono" onFocus={e => e.target.select()} />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button type="button" className={PASTILLA_CLARA} onClick={async () => { try { await navigator.clipboard.writeText(codigo.valor); setCopiado(true); }
          catch { setCopiado(false); setError('No se pudo copiar automáticamente. Seleccioná el código y copialo manualmente.'); } }}>
          {copiado ? 'Copiado' : 'Copiar código'}
        </button>
        <p className="m-0 text-sm text-gray-600">Vence a las {new Date(codigo.vence).toLocaleTimeString('es-AR')}. El servidor conserva sólo su hash.</p>
      </div>
    </section>}

    {cargandoEquipo && <p className={APAGADO}>Cargando el equipo...</p>}

    <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-4">
        {membresia?.rol === 'PROPIETARIO' && <section className={`${TARJETA} p-5`}>
          <h2 className={TITULO_SECCION}>Responsable del marcador de demostración anterior</h2>
          <p className={`${APAGADO} mt-1`}>Esta asignación global conserva compatibilidad con el marcador compartido anterior. Los GPS personales se asignan por dispositivo en «Mis dispositivos».</p>
          <label className="mt-3 block text-[0.72rem] font-bold tracking-[0.06em] text-gray-400 uppercase">Responsable
            <select aria-label="Puesto responsable del GPS simulado" className={`${CAMPO} mt-1 w-full font-normal normal-case`} value={gps ?? ''} disabled={ocupado}
              onChange={e => void ejecutar(() => designarResponsableGps(establecimientoId, e.target.value || null))}>
              <option value="">Sin responsable</option>{puestosAdministradores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        </section>}
        {puestosLaterales.map(puesto => tarjeta(puesto, false))}
      </div>
      <div className="flex flex-col gap-4">
        {puestosAdministradores.map(puesto => tarjeta(puesto, true))}
      </div>
    </div>

    {membresia?.rol === 'PROPIETARIO' && <details className={`${TARJETA} p-5`}>
      <summary className={RESUMEN_DETALLE}>Opciones avanzadas · Crear otro puesto administrador</summary>
      <p className={`${APAGADO} mt-2`}>El puesto tendrá sus propios permisos, integrantes, sesión y bandeja.</p>
      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">Nombre
        <input className={CAMPO} value={nombreNuevo} onChange={e => setNombreNuevo(e.target.value)} maxLength={80} /></label>
      <p className="mt-3 text-sm text-gray-600">Para modificar GPS también se necesita habilitar su lectura. El propietario puede dejar sólo lectura.</p>
      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">{Object.entries(PERMISOS_ADMIN).map(([clave, [, titulo]]) =>
        <Casilla key={clave} etiqueta={titulo} bloqueada={false} marcada={permisosNuevos.includes(clave as PermisoAdmin)}
          onCambiar={marcada => setPermisosNuevos(actual => {
            let siguiente = marcada ? [...actual, clave as PermisoAdmin] : actual.filter(p => p !== clave);
            if (clave === 'modificar_dispositivos_gps' && marcada && !siguiente.includes('ver_dispositivos_gps')) siguiente = [...siguiente, 'ver_dispositivos_gps'];
            if (clave === 'ver_dispositivos_gps' && !marcada) siguiente = siguiente.filter(p => p !== 'modificar_dispositivos_gps');
            return [...new Set(siguiente)];
          })} />)}</div>
      <button type="button" className={`${PASTILLA_VERDE} mt-3`} disabled={ocupado || !nombreNuevo.trim()} onClick={() => void ejecutar(async () => {
        await crearPuesto(establecimientoId, nombreNuevo.trim(), permisosNuevos); setNombreNuevo(''); setPermisosNuevos([]);
      })}>Crear puesto</button>
    </details>}

    {membresia?.principal && <details className={`${TARJETA} p-5`}>
      <summary className={RESUMEN_DETALLE}>
        <span className="flex-1">Historial de ingresos forzados</span>
        <span className="text-[0.78rem] font-normal text-gray-400">
          {ingresosForzados.length === 0
            ? 'Sin registros'
            : `${ingresosForzados.length} ${ingresosForzados.length === 1 ? 'registro' : 'registros'} · ${fechaLarga(ingresosForzados[0].ocurridaEn)}`}
        </span>
      </summary>
      {ingresosForzados.length
        ? <ul className="mt-3 list-none space-y-2 p-0">{ingresosForzados.map(item => <li key={item.id} className="border-b border-gray-200 py-2 text-sm">
            {fechaLarga(item.ocurridaEn, 'full')} · {item.actor} desplazó a {item.afectado} del puesto {item.puesto}.
          </li>)}</ul>
        : <p className={`${APAGADO} mt-2`}>Todavía no hay ingresos forzados registrados.</p>}
    </details>}

    {expulsion && <ConfirmModal title="Expulsar integrante" message={`${expulsion.username} perderá el acceso al puesto ${expulsion.puesto.nombre} del establecimiento ${establecimiento?.nombre ?? ''}. Si está utilizando ese puesto, su sesión operativa también se cerrará.`}
      confirmText="Expulsar integrante" onCancel={() => setExpulsion(null)} onConfirm={() => { const actual = expulsion; if (!actual) return; setExpulsion(null); void ejecutar(() => expulsarDePuesto(establecimientoId, actual.puesto.id, actual.userId)); }} />}

    {cambioDeRol && <ConfirmModal title="Cambiar rol del integrante"
      message={`${cambioDeRol.username} pasará de ${cambioDeRol.puesto.nombre} a ${etiquetaRol(cambioDeRol.nuevo)}.`}
      confirmText="Cambiar rol" confirmVariant="primary" onCancel={() => setCambioDeRol(null)}
      onConfirm={() => { const actual = cambioDeRol; if (!actual) return; setCambioDeRol(null); void ejecutar(() => cambiarRolDeIntegrante(establecimientoId, actual.puesto.id, actual.userId, actual.nuevo).then(() => undefined)); }} />}

    {transferencia && <PromptModal title="Transferir propiedad principal"
      label={`Escribí TRANSFERIR para que ${transferencia.username} pase a ser el propietario principal.`}
      confirmText="Transferir" onCancel={() => setTransferencia(null)}
      onConfirm={valor => { const actual = transferencia; if (!actual) return;
        if (valor !== 'TRANSFERIR') { setError('Para transferir hay que escribir TRANSFERIR exactamente.'); return; }
        setTransferencia(null); void ejecutar(() => transferirPrincipal(establecimientoId, actual.userId, valor)); }} />}
  </PantallaDatos>;
}
