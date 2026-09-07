import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
const db=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../src/base-datos/pool.js',()=>({pool:{query:db.query,connect:async()=>db}}));
import { aceptarInvitacion, cambiarMiembro, crearInvitacion, transferirPrincipal } from '../../src/services/equipo.js';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const eid='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-000000000002',otro='00000000-0000-4000-8000-000000000003';
let actor: Membresia, objetivo: Membresia;
let invitacion: Record<string,unknown>;
let duplicada:boolean;
const codigo='a'.repeat(32);
beforeEach(()=>{
  vi.clearAllMocks();duplicada=false;
  actor={establecimientoId:eid,userId:uid,rol:'PROPIETARIO',principal:true,permisos:[],capacidades:[]};
  objetivo={...actor,userId:otro,principal:false};
  invitacion={id:'inv',establecimiento_id:eid,created_by:uid,rol:'VISOR',permisos:[],capacidades:[],used_at:null,vigente:true};
  db.query.mockImplementation(async(sql:string,params:unknown[]=[])=>{
    if(sql.startsWith('SELECT establecimiento_id FROM invitaciones'))return {rows:[{establecimiento_id:eid}]};
    if(sql.includes('FROM invitaciones')&&sql.includes('FOR UPDATE'))return {rows:[invitacion]};
    if(sql.includes('FROM establecimientos'))return {rows:[{id:eid}]};
    if(sql.includes('FROM membresias m'))return {rows:[params[1]===uid?actor:objetivo]};
    if(sql.startsWith('SELECT 1 FROM membresias'))return {rows:duplicada?[{}]:[]};
    if(sql.startsWith('INSERT INTO invitaciones'))return {rows:[{id:'inv',expires_at:'2026-09-06T17:10:00Z'}]};
    return {rows:[],rowCount:1};
  });
});
describe('invitaciones y transferencias sin DB externa',()=>{
  test('crea código de 192 bits, guarda sólo SHA-256 y registra creador/configuración',async()=>{
    const a=await crearInvitacion(eid,uid,{rol:'VISOR'}),b=await crearInvitacion(eid,uid,{rol:'VISOR'});
    expect(a.codigo).toMatch(/^[A-Za-z0-9_-]{32}$/);expect(a.codigo).not.toBe(b.codigo);
    const llamada=db.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO invitaciones'))!;
    expect(llamada[1]).toEqual([eid,uid,createHash('sha256').update(a.codigo).digest('hex'),'VISOR',[],[]]);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(a.codigo);
  });
  test.each([{used_at:new Date()},{vigente:false}])('rechaza usada o vencida %j sin INSERT ni consumo',async estado=>{
    Object.assign(invitacion,estado);
    await expect(aceptarInvitacion(otro,codigo)).rejects.toMatchObject({code:'INVALID_INVITATION'});
    expect(db.query.mock.calls.some(([s])=>/INSERT INTO membresias|UPDATE invitaciones/.test(s))).toBe(false);
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');expect(db.release).toHaveBeenCalledOnce();
  });
  test('código inválido no consulta DB ni revela establecimiento',async()=>{
    await expect(aceptarInvitacion(otro,'123')).rejects.toMatchObject({code:'INVALID_INVITATION'});expect(db.query).not.toHaveBeenCalled();
  });
  test('establecimiento indicado no coincide: no consume código',async()=>{
    await expect(aceptarInvitacion(otro,codigo,otro)).rejects.toMatchObject({code:'INVALID_INVITATION'});
    expect(db.query.mock.calls.some(([s])=>s.startsWith('UPDATE'))).toBe(false);
  });
  test('membresía duplicada no cambia rol ni consume invitación',async()=>{
    duplicada=true;
    await expect(aceptarInvitacion(otro,codigo)).rejects.toMatchObject({status:409,code:'ALREADY_MEMBER'});
    expect(db.query.mock.calls.some(([s])=>/INSERT INTO membresias|UPDATE invitaciones/.test(s))).toBe(false);
  });
  test('aceptación guarda membresía y consumo en la misma transacción con locks',async()=>{
    expect(await aceptarInvitacion(otro,codigo)).toBe(eid);
    const sql=db.query.mock.calls.map(([s])=>s);
    expect(sql[0]).toBe('BEGIN');expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.findIndex(s=>s.includes('FROM establecimientos')&&s.includes('FOR UPDATE'))).toBeLessThan(sql.findIndex(s=>s.includes('FROM invitaciones')&&s.includes('FOR UPDATE')));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO membresias'),[eid,otro,'VISOR',[],[]]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE invitaciones'),['inv',otro]);
  });
  test('fallo de INSERT revierte y no marca usada',async()=>{
    const anterior=db.query.getMockImplementation()!;
    db.query.mockImplementation(async(s,p)=>{if(s.startsWith('INSERT INTO membresias'))throw new Error('DB');return anterior(s,p);});
    await expect(aceptarInvitacion(otro,codigo)).rejects.toThrow('DB');
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');expect(db.query.mock.calls.some(([s])=>s.startsWith('UPDATE invitaciones'))).toBe(false);
  });
  test('pérdida de autoridad del creador invalida códigos pendientes',async()=>{
    actor={...actor,principal:false,rol:'VISOR'};
    await expect(aceptarInvitacion(otro,codigo)).rejects.toMatchObject({code:'INVALID_INVITATION'});
  });
  test('un fallo de consulta no se confunde con un código inválido',async()=>{
    const anterior=db.query.getMockImplementation()!;
    db.query.mockImplementation(async(s,p)=>{if(s.includes('FROM membresias m'))throw new Error('DB no disponible');return anterior(s,p);});
    await expect(aceptarInvitacion(otro,codigo)).rejects.toThrow('DB no disponible');
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([s])=>s.startsWith('UPDATE invitaciones'))).toBe(false);
  });
  test('transferir cambia raíz y limpia TODAS las capacidades del antiguo principal',async()=>{
    actor.capacidades=['crear_propietarios','eliminar_propietarios','modificar_propietarios','protegido','ignorar_proteccion','poderes_principal'];
    await transferirPrincipal(eid,uid,otro);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET principal_user_id = $2'),[eid,otro]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("SET capacidades = '{}'"),[eid,uid]);
    expect(db.query.mock.calls.some(([s])=>/DELETE|SET rol/.test(s))).toBe(false);
    expect(db.query).toHaveBeenLastCalledWith('COMMIT');
  });
  test.each(['VISOR','ADMINISTRADOR','PROPIETARIO'] as const)('sólo principal transfiere, no %s',async rol=>{
    actor={...actor,principal:false,rol,capacidades:rol==='PROPIETARIO'?['poderes_principal']:[]};
    await expect(transferirPrincipal(eid,uid,otro)).rejects.toMatchObject({status:403});
    expect(db.query.mock.calls.some(([s])=>s.startsWith('UPDATE'))).toBe(false);
  });
  test('destinatario debe ser otro propietario del mismo establecimiento',async()=>{
    objetivo.rol='ADMINISTRADOR';await expect(transferirPrincipal(eid,uid,otro)).rejects.toMatchObject({code:'OWNER_REQUIRED'});
    await expect(transferirPrincipal(eid,uid,uid)).rejects.toMatchObject({status:403});
  });
  test('cambio directo actualiza la membresía y no genera invitación',async()=>{
    objetivo.rol='VISOR';await cambiarMiembro(eid,uid,otro,{rol:'ADMINISTRADOR',permisos:['crear_lotes']});
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE membresias SET rol'),[eid,otro,'ADMINISTRADOR',['crear_lotes'],[]]);
    expect(db.query.mock.calls.some(([s])=>s.includes('invitaciones'))).toBe(false);
  });
});
