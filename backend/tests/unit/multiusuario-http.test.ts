import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Membresia } from '../../src/autorizacion/catalogo.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), analizar: vi.fn(), clima: vi.fn(), ia: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: async () => ({ query: mock.query, release: mock.release }) } }));
vi.mock('../../src/configuracion/env.js', () => ({ env: { authJwtSecret: 'secreto-unitario-multiusuario-sin-base', cookieSameSite:'lax', cookieSecure:false } }));
vi.mock('../../src/copernicus/analizar.js', () => ({ analizadorSatelital: { analizarLotes:mock.analizar } }));
vi.mock('../../src/services/open-meteo.js', () => ({ openMeteo: { consultar:mock.clima } }));
vi.mock('../../src/services/ia-lotes.js', () => ({ iaLotes: { configurado:()=>true, segmentar:mock.ia } }));
import { establecimientosRouter } from '../../src/routes/establecimientos.js';
import { crearToken } from '../../src/autenticacion/session.js';
import { errorResponse } from '../../src/http/errors.js';
import { establecimiento, lote } from '../helpers/fixtures.js';

const eid='00000000-0000-4000-8000-000000000001', uid='00000000-0000-4000-8000-000000000002', lid='00000000-0000-4000-8000-000000000003';
let actor: Membresia | null;
let lotesPresentes = false;
const app=express(); app.use(express.json()); app.use('/api/establecimientos',establecimientosRouter);
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction) => { const r=errorResponse(error); res.status(r.status).json(r.body); });
const cookie=()=>`rodeo_session=${crearToken(uid)}`;
const url=(suffix='')=>`/api/establecimientos/${eid}${suffix}`;
beforeEach(() => {
  vi.clearAllMocks(); lotesPresentes=false;
  actor={establecimientoId:eid,userId:uid,rol:'VISOR',principal:false,permisos:[],capacidades:[]};
  mock.query.mockImplementation(async (sql:string, values:unknown[]=[]) => {
    if(sql.includes('FROM usuarios WHERE id')) return {rows:[{id:uid,email:'test@example.test',username:'Test',onboarding_completed_at:null}]};
    if(sql.includes('FROM membresias m JOIN establecimientos')) return {rows:actor && values[0]===eid ? [actor] : []};
    if(sql.startsWith('SELECT') && sql.includes('FROM establecimientos')) return {rows:[{id:eid,polygon:establecimiento,nombre:'Campo',onboarding_completed_at:null}]};
    if(sql.includes('FROM lotes') && sql.includes('m.user_id')) return {rows:values[0]===lid && values[2]===eid ? [{id:lid}] : []};
    if(sql.startsWith('SELECT 1 FROM lotes'))return {rows:lotesPresentes?[{id:lid}]:[]};
    if(sql.includes('FROM lotes'))return {rows:[]};
    return {rows:[],rowCount:0};
  });
});
describe('rutas reales con autenticación JWT y PostgreSQL simulado', () => {
  test('sin sesión 401; sin membresía 404; URL ajena 404', async () => {
    expect((await request(app).get(url())).status).toBe(401);
    actor=null; expect((await request(app).get(url()).set('Cookie',cookie())).status).toBe(404);
    expect((await request(app).get('/api/establecimientos/no-uuid').set('Cookie',cookie())).status).toBe(404);
  });
  test('Visor lee lotes y lecturas sin escrituras ni upstream', async () => {
    expect((await request(app).get(url('/lotes')).set('Cookie',cookie())).status).toBe(200);
    expect((await request(app).get(url('/lotes/lecturas')).set('Cookie',cookie())).body).toEqual({satelite:[],clima:{}});
    expect(mock.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
    expect(mock.analizar).not.toHaveBeenCalled(); expect(mock.clima).not.toHaveBeenCalled();
  });
  test.each([['post','/lotes',{}],['patch',`/lotes/${lid}`,{apodo:'Nuevo'}],['patch',`/lotes/${lid}`,{activo:false}],['delete',`/lotes/${lid}`,{}],['post','/lotes/satelite/actualizar',{loteIds:[lid]}],['post','/lotes/clima/actualizar',{loteIds:[lid],origen:'manual'}],['post','/ia/sugerir-lotes',{}],['post',`/lotes/${lid}/usos`,{fecha:'2026-01-01'}],['patch',`/lotes/${lid}/usos/${uid}`,{fecha:'2026-01-01'}],['delete',`/lotes/${lid}/usos/${uid}`,{}],['patch','',{nombre:'Otro'}],['patch','',{polygon:establecimiento}] ] as const)('Visor no escribe %s %s',async (method,path,body) => {
    const r=await request(app)[method](url(path)).set('Cookie',cookie()).send(body);
    expect(r.status).toBe(403); expect(mock.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  });
  test('favorito personal sí permite Visor y nunca cambia lote compartido',async () => {
    expect((await request(app).patch(url(`/lotes/${lid}/favorito`)).set('Cookie',cookie()).send({favorito:true})).status).toBe(200);
    expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO lotes_favoritos'),[uid,lid]);
    expect(mock.query.mock.calls.some(([sql])=>/UPDATE lotes SET/.test(sql))).toBe(false);
  });
  test('PATCH combinado exige todos los permisos',async () => {
    actor!.rol='ADMINISTRADOR';actor!.permisos=['editar_lotes'];
    const r=await request(app).patch(url(`/lotes/${lid}`)).set('Cookie',cookie()).send({apodo:'Nuevo',activo:false,polygon:lote(1,2)});
    expect(r.status).toBe(403);
    expect(mock.query.mock.calls.some(([sql])=>sql==='BEGIN')).toBe(false);
  });
  test('el permiso se vuelve a consultar en la siguiente acción sin cambiar JWT',async () => {
    actor!.rol='ADMINISTRADOR';actor!.permisos=['renombrar_establecimiento'];
    mock.query.mockImplementationOnce(async()=>({rows:[{id:uid,username:'Test',email:'test@example.test',onboarding_completed_at:null}]}));
    // Con autorización llega a validar el nombre; sin autorización se detiene antes.
    expect((await request(app).patch(url()).set('Cookie',cookie()).send({nombre:''})).status).toBe(400);
    actor!.permisos=[];
    expect((await request(app).patch(url()).set('Cookie',cookie()).send({nombre:''})).status).toBe(403);
  });
  test('Visor no puede escribir mediante PATCH vacío o campos desconocidos',async () => {
    for(const body of [{},{otraCosa:true}])expect((await request(app).patch(url()).set('Cookie',cookie()).send(body)).status).toBe(400);
    expect(mock.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
  });
  test('IA generar vs confirmar exige crear_lotes y usar_ia',async () => {
    actor!.rol='ADMINISTRADOR';actor!.permisos=['usar_ia'];
    expect((await request(app).post(url('/lotes')).set('Cookie',cookie()).send({polygon:lote(1,2),origen:'ia'})).status).toBe(403);
    actor!.permisos=['crear_lotes'];
    expect((await request(app).post(url('/ia/sugerir-lotes')).set('Cookie',cookie())).status).toBe(403);
    expect((await request(app).post(url('/lotes')).set('Cookie',cookie()).send({polygon:lote(1,2),origen:'ia'})).status).toBe(403);
    expect(mock.ia).not.toHaveBeenCalled();
  });
  test('IDs ajenos de lote o batch no llegan a proveedores',async () => {
    actor!.rol='PROPIETARIO';
    expect((await request(app).post(url('/lotes/satelite/actualizar')).set('Cookie',cookie()).send({loteIds:[uid]})).status).toBe(404);
    expect((await request(app).post(url(`/lotes/${uid}/clima/actualizar`)).set('Cookie',cookie()).send({origen:'manual'})).status).toBe(404);
    expect(mock.analizar).not.toHaveBeenCalled();expect(mock.clima).not.toHaveBeenCalled();
  });
  test('sólo principal llega al bloqueo de eliminación; nunca se borran establecimientos',async () => {
    for(const rol of ['VISOR','ADMINISTRADOR','PROPIETARIO'] as const){actor!.rol=rol; actor!.capacidades=rol==='PROPIETARIO'?['poderes_principal']:[];expect((await request(app).delete(url()).set('Cookie',cookie())).status).toBe(403);}
    actor!.principal=true; lotesPresentes=true;
    expect((await request(app).delete(url()).set('Cookie',cookie())).status).toBe(409);
    lotesPresentes=false;
    expect((await request(app).delete(url()).set('Cookie',cookie())).body.error.code).toBe('ESTABLISHMENT_DELETION_PENDING');
    expect(mock.query.mock.calls.some(([sql])=>/DELETE FROM establecimientos|UPDATE establecimientos/.test(sql))).toBe(false);
  });
  test('notificaciones filtran por usuario y establecimiento también en el conteo',async () => {
    mock.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(sql.includes('FROM usuarios WHERE id'))return {rows:[{id:uid,username:'Test',email:'t@example.test',onboarding_completed_at:null}]};
      if(sql.includes('FROM membresias m'))return {rows:[actor]};
      if(sql.includes('COUNT(*)')){expect(values).toEqual([uid,eid]);return {rows:[{total:'0'}]};}
      expect(values).toEqual([uid,20,0,eid]);return {rows:[]};
    });
    const r=await request(app).get(url('/notificaciones')).set('Cookie',cookie());expect(r.status).toBe(200);expect(r.body.noLeidas).toBe(0);
  });
});
