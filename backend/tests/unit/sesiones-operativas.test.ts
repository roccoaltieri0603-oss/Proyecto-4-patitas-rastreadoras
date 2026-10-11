import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request, Response } from 'express';

const eid = '00000000-0000-4000-8000-000000000001';
const puestoId = '00000000-0000-4000-8000-000000000002';
const pedro = '00000000-0000-4000-8000-000000000003';
const juan = '00000000-0000-4000-8000-000000000004';

interface Sesion { id: string; user_id: string; token_hash: string; vence_en: Date; terminada_en: Date | null }
let sesion: Sesion | null;
let secuencia: number;
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../../src/base-datos/pool.js', () => ({ pool: { query: mock.query, connect: async () => ({ query: mock.query, release: mock.release }) } }));
vi.mock('../../src/configuracion/env.js', () => ({ env: { authJwtSecret: 'secreto-unitario-sesiones-operativas', cookieSameSite: 'lax', cookieSecure: false } }));
import { entrarPuesto, requiereSesionOperativa, revocarAlCerrarSesion } from '../../src/autenticacion/operativa.js';
import { crearToken } from '../../src/autenticacion/session.js';
import { asyncHandler } from '../../src/http/async-handler.js';

function peticion(userId: string, cookie = '', forzar = false): Request {
  return { usuario: { id: userId }, params: { establecimientoId: eid, puestoId },
    body: { forzar }, headers: { cookie }, path: '/lotes', method: 'GET',
    get: (_header: string) => undefined } as unknown as Request;
}
function respuesta() {
  const cookies: string[] = [];
  return { cookies, append: vi.fn((_name: string, value: string) => { cookies.push(value); }),
    json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn(), once: vi.fn() };
}
function cookieOperativa(res: ReturnType<typeof respuesta>): string {
  return res.cookies.find(c => c.startsWith('rodeo_operativa='))!.split(';')[0];
}

beforeEach(() => {
  vi.clearAllMocks(); sesion = null; secuencia = 0;
  mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM puestos_operativos p') && sql.includes('FOR UPDATE OF p')) {
      return { rows: [pedro, juan].includes(String(values[2])) ? [{ id: puestoId, nombre: 'Administrador', rol: 'ADMINISTRADOR' }] : [] };
    }
    if (sql.includes('FROM sesiones_operativas') && sql.includes('FOR UPDATE')) return { rows: sesion && !sesion.terminada_en ? [sesion] : [] };
    if (sql.startsWith('SELECT puesto_operativo_id FROM sesiones_operativas')) {
      return { rows: sesion && !sesion.terminada_en && sesion.id === values[0] &&
        sesion.token_hash === values[1] && (values.length < 3 || sesion.user_id === values[2])
        ? [{ puesto_operativo_id: puestoId }] : [] };
    }
    if (sql.startsWith('SELECT id FROM puestos_operativos')) return { rows: [{ id: puestoId }] };
    if (sql.startsWith('UPDATE sesiones_operativas SET terminada_en')) {
      if (sesion && (sql.includes('WHERE id = $1') ? sesion.id === values[0] : true)) sesion.terminada_en = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO sesiones_operativas')) {
      sesion = { id: `00000000-0000-4000-8000-${String(++secuencia).padStart(12, '0')}`,
        user_id: String(values[2]), token_hash: String(values[3]),
        vence_en: new Date(Date.now() + 30 * 60_000), terminada_en: null };
      return { rows: [{ id: sesion.id, vence_en: sesion.vence_en }] };
    }
    if (sql.includes('INSERT INTO auditoria_operativa')) return { rows: [] };
    if (sql.includes('SELECT s.id, p.id AS puesto_operativo_id')) {
      return { rows: sesion && !sesion.terminada_en && sesion.id === values[0] &&
        sesion.token_hash === values[1] && sesion.user_id === values[2] ? [{
          id: sesion.id, puesto_operativo_id: puestoId, establecimiento_id: eid,
          nombre: 'Administrador', rol: 'ADMINISTRADOR', permisos: ['crear_lotes'], capacidades: [],
          principal: false, ultima_actividad_en: new Date(),
        }] : [] };
    }
    if (sql.includes('UPDATE sesiones_operativas SET ultima_actividad_en')) return { rows: [] };
    throw new Error(`Consulta no prevista: ${sql}`);
  });
});

describe('sesión operativa exclusiva', () => {
  test('el primer ingreso crea credencial opaca y el segundo encuentra el puesto ocupado', async () => {
    const primero = respuesta();
    await entrarPuesto(peticion(pedro), primero as unknown as Response);
    expect(cookieOperativa(primero)).toMatch(/^rodeo_operativa=[0-9a-f-]+\.[a-f0-9]{64}$/);
    expect(sesion?.token_hash).not.toContain(cookieOperativa(primero).split('.')[1]);
    await expect(entrarPuesto(peticion(juan), respuesta() as unknown as Response))
      .rejects.toMatchObject({ status: 409, code: 'OPERATION_POST_BUSY' });
    expect(sesion?.user_id).toBe(pedro);
  });

  test('forzar revoca el acceso anterior en el backend y conserva la sesión personal', async () => {
    const primero = respuesta(); await entrarPuesto(peticion(pedro), primero as unknown as Response);
    const segundo = respuesta(); await entrarPuesto(peticion(juan, '', true), segundo as unknown as Response);
    const errorAnterior = vi.fn();
    await requiereSesionOperativa(peticion(pedro, cookieOperativa(primero)), respuesta() as unknown as Response, errorAnterior);
    expect(errorAnterior).toHaveBeenCalledWith(expect.objectContaining({ code: 'OPERATION_SESSION_LOST' }));
    const escrituraAnterior = peticion(pedro, cookieOperativa(primero));
    escrituraAnterior.method = 'PATCH';
    const errorEscritura = vi.fn();
    await requiereSesionOperativa(escrituraAnterior, respuesta() as unknown as Response, errorEscritura);
    expect(errorEscritura).toHaveBeenCalledWith(expect.objectContaining({ code: 'OPERATION_SESSION_LOST' }));
    const correcto = vi.fn();
    const nuevo = peticion(juan, cookieOperativa(segundo));
    await requiereSesionOperativa(nuevo, respuesta() as unknown as Response, correcto);
    expect(correcto).toHaveBeenCalledWith();
    expect(nuevo.membresia?.puestoOperativoId).toBe(puestoId);
    expect(nuevo.membresia?.permisos).toEqual(['crear_lotes']);
  });

  test('una sesión vencida deja ingresar sin forzar', async () => {
    await entrarPuesto(peticion(pedro), respuesta() as unknown as Response);
    sesion!.vence_en = new Date(Date.now() - 1000);
    await entrarPuesto(peticion(juan), respuesta() as unknown as Response);
    expect(sesion?.user_id).toBe(juan);
  });

  test('una petición protegida retiene el bloqueo del puesto hasta terminar la respuesta', async () => {
    const ingreso = respuesta(); await entrarPuesto(peticion(pedro), ingreso as unknown as Response);
    const req = peticion(pedro, cookieOperativa(ingreso)); req.method = 'PATCH';
    const res = respuesta(); const next = vi.fn();
    await requiereSesionOperativa(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
    const consultas = mock.query.mock.calls.map(([sql]) => String(sql));
    expect(consultas).toContain('SELECT id FROM puestos_operativos WHERE id = $1 AND establecimiento_id = $2 FOR SHARE');
    expect(consultas.at(-1)).not.toBe('COMMIT');
    const terminar = res.once.mock.calls.find(([evento]) => evento === 'finish')?.[1] as (() => void) | undefined;
    expect(terminar).toBeTypeOf('function');
    terminar?.();
    await vi.waitFor(() => expect(mock.release).toHaveBeenCalled());
  });

  test('una conexión abortada conserva el bloqueo hasta que termine el controlador asíncrono', async () => {
    const ingreso = respuesta(); await entrarPuesto(peticion(pedro), ingreso as unknown as Response);
    mock.release.mockClear();
    const req = peticion(pedro, cookieOperativa(ingreso)); req.method = 'PATCH';
    const res = { ...respuesta(), destroyed: false };
    const next = vi.fn();
    await requiereSesionOperativa(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
    let completar!: () => void;
    const pendiente = new Promise<void>(resolve => { completar = resolve; });
    asyncHandler(async () => pendiente)(req, res as unknown as Response, next);
    const cerrar = res.once.mock.calls.find(([evento]) => evento === 'close')?.[1] as (() => void) | undefined;
    res.destroyed = true;
    cerrar?.();
    await Promise.resolve();
    expect(mock.release).not.toHaveBeenCalled();
    completar();
    await vi.waitFor(() => expect(mock.release).toHaveBeenCalledTimes(1));
  });

  test('logout operativo exige el mismo usuario personal y hash de credencial', async () => {
    const res = respuesta(); await entrarPuesto(peticion(pedro), res as unknown as Response);
    const token = cookieOperativa(res).split('=')[1].split('.');
    const logout = peticion(pedro, `rodeo_session=${crearToken(pedro)}; ${cookieOperativa(res)}`);
    delete logout.usuario; // /api/auth/logout conserva la semántica idempotente, sin middleware obligatorio.
    await revocarAlCerrarSesion(logout);
    const llamada = mock.query.mock.calls.find(([sql]) => String(sql).includes('motivo_fin = $4'))!;
    expect(llamada[1]).toEqual([token[0], createHash('sha256').update(token[1]).digest('hex'), pedro, 'logout']);
  });
});
