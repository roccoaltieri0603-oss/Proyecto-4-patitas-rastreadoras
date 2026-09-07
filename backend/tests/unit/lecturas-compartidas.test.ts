import { beforeEach, expect, test, vi } from 'vitest';
const db=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../src/base-datos/pool.js',()=>({pool:db}));
import { lecturasCompartidas } from '../../src/services/lecturas-compartidas.js';
const stats=Object.fromEntries(['ndvi','ndmi','ndwi','evi','rvi'].flatMap(i=>['media','mediana','min','max','desvio'].map(k=>[`${i}_${k}`,0.5])));
beforeEach(()=>vi.clearAllMocks());
test('lee únicamente el establecimiento indicado y no escribe',async()=>{
  db.query.mockResolvedValue({rows:[]});expect(await lecturasCompartidas('campo')).toEqual({satelite:[],clima:{}});
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('establecimiento_id = $1'),['campo']);
  expect(db.query).toHaveBeenCalledOnce();
});
test('radar más reciente y óptica se devuelven separados sin score radar',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:'l'}]}).mockResolvedValueOnce({rows:[{...stats,lote_id:'l',fuente:'sentinel-2',observed_at:'2026-01-01',puntaje:60,categoria:'buena',cobertura_valida:0.9},{...stats,lote_id:'l',fuente:'sentinel-1',observed_at:'2026-01-02'}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
  const r=await lecturasCompartidas('campo');expect(r.satelite[0]).toMatchObject({estado:'radar',optico:{puntaje:60},condicion:{fecha:'2026-01-02'}});
  expect((r.satelite[0] as {condicion:unknown}).condicion).not.toHaveProperty('puntaje');
  expect(db.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
test('estadística parcial no se rellena con cero',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:'l'}]}).mockResolvedValueOnce({rows:[{...stats,lote_id:'l',fuente:'sentinel-2',observed_at:'2026-01-01',puntaje:60,categoria:'buena',cobertura_valida:0.9,ndvi_min:null}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
  expect((await lecturasCompartidas('campo')).satelite[0].estado).toBe('sin-datos');
});
test('clima mantiene ausencia de datos y usa timestamp persistido',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:'l'}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'c',lote_id:'l',consulted_at:'2026-01-01T12:00:00Z',categoria:null,lluvia_ultimos_7_dias:null,lluvia_proximos_dias:0}]}).mockResolvedValueOnce({rows:[{consulta_clima_id:'c',fecha:'2026-01-01',lluvia_mm:null,temp_min:null,temp_max:20,es_pronostico:true}]});
  expect((await lecturasCompartidas('campo')).clima.l).toMatchObject({estado:'ok',categoria:null,clima:{consultadoEn:Date.parse('2026-01-01T12:00:00Z'),lluviaUltimos7Dias:null,lluviaProximosDias:0,hoy:null,dias:[{lluviaMm:null,tempMin:null,tempMax:20}]}});
});
