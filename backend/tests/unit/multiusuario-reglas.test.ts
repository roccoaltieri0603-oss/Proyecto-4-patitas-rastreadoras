import { describe, expect, test } from 'vitest';
import { autorizarCambio, autorizarInvitacion, exigir, validarConfiguracion } from '../../src/autorizacion/reglas.js';
import { CAPACIDADES_PROPIETARIO, PERMISOS_ADMIN, puede, type Membresia, type PermisoAdmin } from '../../src/autorizacion/catalogo.js';

const visor: Membresia = { establecimientoId: 'campo-a', userId: 'actor', rol: 'VISOR', principal: false, permisos: [], capacidades: [] };
const admin = (...permisos: PermisoAdmin[]): Membresia => ({ ...visor, rol: 'ADMINISTRADOR', permisos });
const propietario: Membresia = { ...visor, rol: 'PROPIETARIO' };
const principal = { ...propietario, principal: true };
const otro = (m: Membresia): Membresia => ({ ...m, userId: 'otro' });
const prohibida = (f: () => void) => expect(f).toThrow(expect.objectContaining({ status: 403 }));

describe('operaciones por membresía', () => {
  test.each(Object.keys(PERMISOS_ADMIN) as PermisoAdmin[])('Visor no escribe %s; Admin necesita permiso; Propietario operativo no necesita checkboxes', p => {
    expect(puede(null,p)).toBe(false); prohibida(() => exigir(visor,p)); prohibida(() => exigir(admin(),p));
    expect(() => exigir(admin(p),p)).not.toThrow(); expect(() => exigir(propietario,p)).not.toThrow();
  });
  test.each([visor,admin('gestionar_administradores'),propietario,principal])('nadie autoedita su membresía %#', actor => prohibida(() => autorizarCambio(actor,actor,actor)));
  test.each([visor,admin(...Object.keys(PERMISOS_ADMIN) as PermisoAdmin[]),propietario,{...propietario,capacidades:['poderes_principal'] as const}])('principal intocable %#', actor => prohibida(() => autorizarCambio({...actor,capacidades:[...actor.capacidades]},otro(principal),visor)));
  test('no permite objetivos de otro establecimiento', () => prohibida(() => autorizarCambio(principal,{...otro(visor),establecimientoId:'campo-b'},visor)));
});

describe('administradores', () => {
  test('gestionar y generar códigos son independientes', () => {
    expect(() => autorizarInvitacion(admin('invitar_administradores'),admin())).not.toThrow();
    prohibida(() => autorizarCambio(admin('invitar_administradores'),otro(admin()),admin()));
    prohibida(() => autorizarInvitacion(admin('gestionar_administradores'),admin()));
  });
  test('nunca crea o gestiona propietarios aun con todos los permisos', () => {
    const actor = admin(...Object.keys(PERMISOS_ADMIN) as PermisoAdmin[]);
    prohibida(() => autorizarInvitacion(actor,propietario)); prohibida(() => autorizarCambio(actor,otro(propietario),visor));
    prohibida(() => autorizarCambio(actor,otro(visor),propietario));
  });
  test('sólo modifica permisos propios; conserva permisos ajenos sin tocarlos', () => {
    const actor=admin('gestionar_administradores','crear_lotes'), objetivo=otro(admin('crear_lotes','eliminar_lotes'));
    expect(() => autorizarCambio(actor,objetivo,admin('eliminar_lotes'))).not.toThrow();
    prohibida(() => autorizarCambio(actor,objetivo,admin('crear_lotes')));
    prohibida(() => autorizarCambio(actor,objetivo,admin('crear_lotes','eliminar_lotes','usar_ia')));
  });
  test('revocar cualquier no otorga; otorgar cualquier no revoca', () => {
    expect(() => autorizarCambio(admin('gestionar_administradores','revocar_cualquier_permiso'),otro(admin('usar_ia')),admin())).not.toThrow();
    prohibida(() => autorizarCambio(admin('gestionar_administradores','revocar_cualquier_permiso'),otro(admin()),admin('usar_ia')));
    expect(() => autorizarCambio(admin('gestionar_administradores','otorgar_cualquier_permiso'),otro(admin()),admin('usar_ia'))).not.toThrow();
    prohibida(() => autorizarCambio(admin('gestionar_administradores','otorgar_cualquier_permiso'),otro(admin('usar_ia')),admin()));
  });
  test('excepción de invitación no amplía gestión', () => {
    const actor=admin('invitar_administradores','crear_admin_cualquier_permiso');
    expect(() => autorizarInvitacion(actor,admin(...Object.keys(PERMISOS_ADMIN) as PermisoAdmin[]))).not.toThrow();
    prohibida(() => autorizarCambio(actor,otro(admin()),admin('crear_lotes')));
    prohibida(() => autorizarInvitacion(admin('invitar_administradores','gestionar_administradores','otorgar_cualquier_permiso'),admin('usar_ia')));
  });
  test.each(['revocar_cualquier_permiso','otorgar_cualquier_permiso','crear_admin_cualquier_permiso'])('valida dependencia %s', p => {
    expect(() => validarConfiguracion({rol:'ADMINISTRADOR',permisos:[p]})).toThrow(expect.objectContaining({code:'PERMISSION_DEPENDENCY'}));
  });
  test.each([null,{}, {rol:'OPERADOR'}, {rol:'VISOR',permisos:['crear_lotes']}, {rol:'ADMINISTRADOR',capacidades:['protegido']}, {rol:'PROPIETARIO',capacidades:['inexistente']}, {rol:'ADMINISTRADOR',permisos:['__proto__']}])('rechaza configuración inválida %j', config => expect(() => validarConfiguracion(config)).toThrow());
  test('degradar o expulsar exige poder revocar TODOS los permisos', () => {
    const objetivo=otro(admin('crear_lotes','usar_ia'));
    for(const siguiente of [visor,null]) {
      prohibida(() => autorizarCambio(admin('gestionar_administradores','crear_lotes'),objetivo,siguiente));
      expect(() => autorizarCambio(admin('gestionar_administradores','revocar_cualquier_permiso'),objetivo,siguiente)).not.toThrow();
    }
  });
  test('promover Visor exige ambas gestiones y límites de otorgamiento', () => {
    prohibida(() => autorizarCambio(admin('gestionar_visores'),otro(visor),admin()));
    prohibida(() => autorizarCambio(admin('gestionar_administradores'),otro(visor),admin()));
    const actor=admin('gestionar_visores','gestionar_administradores','crear_lotes');
    expect(() => autorizarCambio(actor,otro(visor),admin('crear_lotes'))).not.toThrow();
    prohibida(() => autorizarCambio(actor,otro(visor),admin('usar_ia')));
  });
});

describe('gobierno de propietarios', () => {
  test('acumular capacidades normales no equivale a poderes explícitos', () => {
    const actor={...propietario,capacidades:(Object.keys(CAPACIDADES_PROPIETARIO) as Membresia['capacidades']).filter(p => p !== 'poderes_principal')};
    prohibida(() => autorizarCambio(actor,otro(propietario),{...propietario,capacidades:['poderes_principal']}));
    prohibida(() => autorizarCambio(actor,otro(propietario),{...propietario,capacidades:['protegido']}));
  });
  test('crear propietarios es independiente de modificar sus capacidades', () => {
    expect(() => autorizarInvitacion({...propietario,capacidades:['crear_propietarios']},propietario)).not.toThrow();
    prohibida(() => autorizarInvitacion(propietario,propietario));
  });
  test('propietario normal modifica sólo capacidades que posee y nunca protección', () => {
    const actor={...propietario,capacidades:['modificar_propietarios','crear_propietarios'] as Membresia['capacidades']};
    expect(() => autorizarCambio(actor,otro(propietario),{...propietario,capacidades:['crear_propietarios']})).not.toThrow();
    prohibida(() => autorizarCambio(actor,otro(propietario),{...propietario,capacidades:['ignorar_proteccion']}));
    prohibida(() => autorizarCambio(actor,otro(propietario),{...propietario,capacidades:['protegido']}));
  });
  test.each([visor,admin('crear_lotes'),null])('protección bloquea degradación/expulsión %#', siguiente => {
    const objetivo=otro({...propietario,capacidades:['protegido']});
    prohibida(() => autorizarCambio({...propietario,capacidades:['eliminar_propietarios']},objetivo,siguiente));
    expect(() => autorizarCambio({...propietario,capacidades:['eliminar_propietarios','ignorar_proteccion']},objetivo,siguiente)).not.toThrow();
    expect(() => autorizarCambio({...propietario,capacidades:['poderes_principal']},objetivo,siguiente)).not.toThrow();
    expect(() => autorizarCambio(principal,objetivo,siguiente)).not.toThrow();
  });
  test('sólo principal otorga o quita poderes, incluso por degradación', () => {
    const delegado={...propietario,capacidades:['poderes_principal'] as Membresia['capacidades']};
    prohibida(() => autorizarCambio(delegado,otro(propietario),delegado));
    prohibida(() => autorizarCambio(delegado,otro(delegado),propietario));
    prohibida(() => autorizarCambio(delegado,otro(delegado),visor));
    expect(() => autorizarCambio(principal,otro(delegado),propietario)).not.toThrow();
  });
});
