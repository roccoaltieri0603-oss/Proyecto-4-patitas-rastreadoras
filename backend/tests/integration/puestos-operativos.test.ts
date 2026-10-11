import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Pool } from 'pg';
import { migrateTestDatabase, resetTestDatabase } from '../helpers/db.js';
import { establecimiento } from '../helpers/fixtures.js';

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
let pool: Pool;
let eid: string;
let ownerId: string;
let otherId: string;
let ownerPostId: string;
let adminPostId: string;
let entrarPuesto: typeof import('../../src/autenticacion/operativa.js').entrarPuesto;

integration('puestos operativos: restricciones PostgreSQL reales, sólo base desechable', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrateTestDatabase(pool); // assertTestDatabase comprueba identidad, permisos y marca antes de escribir.
    entrarPuesto = (await import('../../src/autenticacion/operativa.js')).entrarPuesto;
  });
  beforeEach(async () => {
    await resetTestDatabase(pool);
    const owner = await pool.query<{ id: string }>(
      "INSERT INTO usuarios (email, username, password_hash) VALUES ('owner@integration.test','owner_integration','hash') RETURNING id",
    );
    const other = await pool.query<{ id: string }>(
      "INSERT INTO usuarios (email, username, password_hash) VALUES ('other@integration.test','other_integration','hash') RETURNING id",
    );
    ownerId = owner.rows[0].id; otherId = other.rows[0].id;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await db.query<{ id: string }>(
        'INSERT INTO establecimientos (user_id, principal_user_id, nombre, polygon) VALUES ($1,$1,$2,$3) RETURNING id',
        [ownerId, 'Campo de integración', establecimiento],
      );
      eid = result.rows[0].id;
      await db.query("INSERT INTO membresias (establecimiento_id,user_id,rol) VALUES ($1,$2,'PROPIETARIO')", [eid, ownerId]);
      const posts = await db.query<{ id: string; rol: string }>(
        `INSERT INTO puestos_operativos (establecimiento_id,nombre,rol,propietario_user_id)
         VALUES ($1,'Propietario','PROPIETARIO',$2) RETURNING id,rol`, [eid, ownerId],
      );
      ownerPostId = posts.rows[0].id;
      adminPostId = (await db.query<{ id: string }>(
        "INSERT INTO puestos_operativos (establecimiento_id,nombre,rol) VALUES ($1,'Administrador','ADMINISTRADOR') RETURNING id", [eid],
      )).rows[0].id;
      await db.query('INSERT INTO integrantes_puesto (establecimiento_id,puesto_operativo_id,user_id) VALUES ($1,$2,$3)', [eid, adminPostId, otherId]);
      await db.query('INSERT INTO integrantes_puesto (establecimiento_id,puesto_operativo_id,user_id) VALUES ($1,$2,$3)', [eid, adminPostId, ownerId]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  });
  afterAll(async () => { await pool?.end(); });

  test('dos ingresos concurrentes no pueden tener sesiones activas del mismo puesto', async () => {
    const inserir = (userId: string) => pool.query(
      `INSERT INTO sesiones_operativas (establecimiento_id,puesto_operativo_id,user_id,token_hash,vence_en)
       VALUES ($1,$2,$3,$4,NOW() + INTERVAL '30 minutes') RETURNING id`,
      [eid, adminPostId, userId, `token-${userId}`],
    );
    const resultados = await Promise.allSettled([inserir(ownerId), inserir(otherId)]);
    expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter(r => r.status === 'rejected')).toHaveLength(1);
    const activa = await pool.query<{ id: string }>(
      'SELECT id FROM sesiones_operativas WHERE puesto_operativo_id = $1 AND terminada_en IS NULL', [adminPostId],
    );
    expect(activa.rows).toHaveLength(1);
    await pool.query("UPDATE sesiones_operativas SET terminada_en=NOW(), motivo_fin='forzado' WHERE id=$1", [activa.rows[0].id]);
    expect((await pool.query(
      `INSERT INTO sesiones_operativas (establecimiento_id,puesto_operativo_id,user_id,token_hash,vence_en)
       VALUES ($1,$2,$3,'nuevo-token',NOW() + INTERVAL '30 minutes') RETURNING id`, [eid, adminPostId, otherId],
    )).rows).toHaveLength(1);
  });

  test('dos takeovers concurrentes se serializan y sólo queda el último control vigente', async () => {
    const respuesta = () => ({ append: () => undefined, json: () => undefined });
    const solicitud = (userId: string, forzar: boolean) => ({
      usuario: { id: userId }, params: { establecimientoId: eid, puestoId: adminPostId },
      body: { forzar }, headers: {},
    });
    await entrarPuesto(solicitud(ownerId, false) as never, respuesta() as never);
    const resultados = await Promise.allSettled([
      entrarPuesto(solicitud(otherId, true) as never, respuesta() as never),
      entrarPuesto(solicitud(ownerId, true) as never, respuesta() as never),
    ]);
    expect(resultados.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const sesiones = await pool.query<{ user_id: string; motivo_fin: string | null }>(
      'SELECT user_id, motivo_fin FROM sesiones_operativas WHERE puesto_operativo_id=$1 ORDER BY iniciada_en,id', [adminPostId],
    );
    expect(sesiones.rows).toHaveLength(3);
    expect(sesiones.rows.filter(s => s.motivo_fin === null)).toHaveLength(1);
    expect(sesiones.rows.filter(s => s.motivo_fin === 'forzado')).toHaveLength(2);
  });

  test('una entrega sin notificación falla al COMMIT y no deja rastro; la entrega completa sí confirma', async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const evento = await db.query<{ id: string }>(
        `INSERT INTO eventos_establecimiento (establecimiento_id,tipo,actor_user_id,actor_puesto_operativo_id)
         VALUES ($1,'permisos_modificados',$2,$3) RETURNING id`, [eid, ownerId, ownerPostId],
      );
      await db.query(
        'INSERT INTO entregas_eventos_notificacion (evento_id,establecimiento_id,puesto_operativo_id) VALUES ($1,$2,$3)',
        [evento.rows[0].id, eid, adminPostId],
      );
      await expect(db.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK');
      expect((await pool.query('SELECT id FROM eventos_establecimiento WHERE id=$1', [evento.rows[0].id])).rows).toHaveLength(0);

      await db.query('BEGIN');
      const valido = await db.query<{ id: string }>(
        `INSERT INTO eventos_establecimiento (establecimiento_id,tipo,actor_user_id,actor_puesto_operativo_id)
         VALUES ($1,'permisos_modificados',$2,$3) RETURNING id`, [eid, ownerId, ownerPostId],
      );
      const entrega = await db.query<{ id: string }>(
        'INSERT INTO entregas_eventos_notificacion (evento_id,establecimiento_id,puesto_operativo_id) VALUES ($1,$2,$3) RETURNING id',
        [valido.rows[0].id, eid, adminPostId],
      );
      const aviso = await db.query<{ id: string }>(
        `INSERT INTO notificaciones (establecimiento_id,puesto_operativo_id,evento_id,tipo,titulo,mensaje)
         VALUES ($1,$2,$3,'permisos_modificados','Permisos','Cambio') RETURNING id`,
        [eid, adminPostId, valido.rows[0].id],
      );
      await db.query('UPDATE entregas_eventos_notificacion SET notificacion_id=$2 WHERE id=$1', [entrega.rows[0].id, aviso.rows[0].id]);
      await db.query('COMMIT');
      expect((await pool.query('SELECT id FROM entregas_eventos_notificacion WHERE evento_id=$1', [valido.rows[0].id])).rows).toHaveLength(1);
    } finally { db.release(); }
  });

  test('dos eventos pueden compartir una agrupación de puesto sin duplicar la fila', async () => {
    for (const indice of [1, 2]) await pool.query(
      `INSERT INTO notificaciones (establecimiento_id,puesto_operativo_id,agrupacion_clave,tipo,titulo,mensaje)
       VALUES ($1,$2,'grupo-lotes','cambios_limites','Límites','Cambio')
       ON CONFLICT (puesto_operativo_id,agrupacion_clave)
       WHERE agrupacion_clave IS NOT NULL AND puesto_operativo_id IS NOT NULL
       DO UPDATE SET mensaje=$3`, [eid, adminPostId, `Cambio ${indice}`],
    );
    const rows = await pool.query<{ mensaje: string }>(
      'SELECT mensaje FROM notificaciones WHERE establecimiento_id=$1 AND puesto_operativo_id=$2 AND agrupacion_clave=$3',
      [eid, adminPostId, 'grupo-lotes'],
    );
    expect(rows.rows).toEqual([{ mensaje: 'Cambio 2' }]);
  });
});
