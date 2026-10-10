-- Reconciliación revisable para la base Neon auditada.
-- Este archivo NO ejecuta migraciones ni modifica filas de la aplicación.
-- Sólo registra el prefijo 001–007 después de verificar identidad, huella
-- exacta del esquema, precondiciones de datos e inexistencia del historial.
-- Ejecutar únicamente después de revisar proyecto/rama en Neon y aprobarlo.

BEGIN;
SELECT pg_advisory_xact_lock(721834920119::bigint);

DO $reconciliar$
DECLARE
  huella_actual TEXT;
BEGIN
  IF current_database() <> 'neondb' OR current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Destino inesperado: esta reconciliación fue preparada para neondb/neondb_owner.';
  END IF;
  IF current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'La conexión no permite escrituras; se cancela la reconciliación.';
  END IF;
  IF to_regclass('public.rodeo_schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe public.rodeo_schema_migrations; no se modifica un historial existente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'Falta pgcrypto, requerida por la migración 001.';
  END IF;

  SELECT md5(
    coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s', c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity), E'\n' ORDER BY c.relname, c.relkind)
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')), '')
    || E'\n--columns--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', table_name, column_name, udt_name, is_nullable,
                       coalesce(column_default, ''), is_generated, coalesce(generation_expression, ''), ordinal_position), E'\n' ORDER BY table_name, ordinal_position)
                  FROM information_schema.columns WHERE table_schema = 'public'), '')
    || E'\n--constraints--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', rel.relname, con.conname, con.contype, con.convalidated,
                       con.condeferrable, con.condeferred) || '|' || pg_get_constraintdef(con.oid, true), E'\n' ORDER BY rel.relname, con.conname)
                  FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
                  JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = 'public'), '')
    || E'\n--indexes--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s', tablename, indexname, indexdef), E'\n' ORDER BY tablename, indexname)
                  FROM pg_indexes WHERE schemaname = 'public'), '')
    || E'\n--index-health--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s', nt.nspname, ct.relname, ci.relname, ix.indisvalid, ix.indisready)
                   || '|' || pg_get_indexdef(ix.indexrelid), E'\n' ORDER BY ct.relname, ci.relname)
                  FROM pg_index ix JOIN pg_class ct ON ct.oid = ix.indrelid
                  JOIN pg_namespace nt ON nt.oid = ct.relnamespace
                  JOIN pg_class ci ON ci.oid = ix.indexrelid
                  JOIN pg_namespace ni ON ni.oid = ci.relnamespace
                 WHERE nt.nspname = 'public' AND ni.nspname = 'public'), '')
    || E'\n--triggers--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', rel.relname, t.tgname, t.tgenabled,
                       t.tgdeferrable, t.tginitdeferred, p.proname) || '|' || pg_get_triggerdef(t.oid) || '|' || p.prosrc,
                       E'\n' ORDER BY rel.relname, t.tgname)
                  FROM pg_trigger t JOIN pg_class rel ON rel.oid = t.tgrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
                  JOIN pg_proc p ON p.oid = t.tgfoid WHERE n.nspname = 'public' AND NOT t.tgisinternal), '')
    || E'\n--policies--\n'
    || coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s', schemaname, tablename, policyname, permissive,
                       roles, cmd, coalesce(qual, '')) || '|' || coalesce(with_check, ''), E'\n' ORDER BY schemaname, tablename, policyname)
                  FROM pg_policies WHERE schemaname = 'public'), '')
  ) INTO huella_actual;

  IF huella_actual <> 'cee833cbe41f5136bcdfcfdf785e9e81' THEN
    RAISE EXCEPTION 'La huella del esquema cambió desde la auditoría; no se registra ningún historial.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index WHERE (NOT indisvalid OR NOT indisready)
             AND indrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)) THEN
    RAISE EXCEPTION 'Hay índices inválidos o no listos en public.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE NOT convalidated
             AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)) THEN
    RAISE EXCEPTION 'Hay restricciones sin validar en public.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE email IS NULL)
     OR EXISTS (SELECT 1 FROM public.usuarios GROUP BY lower(email) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Precondición 005 incumplida: email nulo o duplicado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.establecimientos e
    LEFT JOIN public.membresias m
      ON m.establecimiento_id = e.id AND m.user_id = e.principal_user_id AND m.rol = 'PROPIETARIO'
    WHERE e.principal_user_id IS NULL OR m.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Precondición 006 incumplida: establecimiento sin propietario principal miembro.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultas_clima WHERE origen IS NULL OR origen NOT IN ('automatico', 'manual', 'legacy')) THEN
    RAISE EXCEPTION 'Precondición 003 incumplida: origen climático nulo o inesperado.';
  END IF;
END;
$reconciliar$;

-- Definición idéntica a asegurarRegistro() en migration-runner.ts.
CREATE TABLE public.rodeo_schema_migrations (
  nombre TEXT PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.rodeo_schema_migrations (nombre, checksum) VALUES
  ('001_initial_schema.sql', 'e4a720ae810c14af3ba599b312137b00debc4ef6b9e48e4b4829e052b7baf212'),
  ('002_lote_usos.sql', '10df785b7323354109983912ef03a26389ee1d390f86a17bbfa1fa69126b82ed'),
  ('003_clima_origen.sql', '18cbfc5240ea294032c44f187b9a25b05149d9b93cbe2e9482e950e8ec037fbf'),
  ('004_lotes_favoritos.sql', '7d1c35b67d6fc023d8ccef0268d568c1b780f839a18d451dfb509b4dd07976c7'),
  ('005_usuarios_email.sql', 'b810bfc2a108178160b1941b45816555765bcd56c776329d211ad8615ce2c031'),
  ('006_multiusuario.sql', '7ebad5af5652b8ac8600782d9689181b646990086619fe9064b15e74efe6f3c5'),
  ('007_invitaciones_constraints.sql', '464ecca2911f28427b92423fc01a9834909bf09e6d59d2cb417d07225e6041d0');

DO $validar_historial$
BEGIN
  IF (SELECT count(*) FROM public.rodeo_schema_migrations) <> 7
     OR (SELECT min(nombre) FROM public.rodeo_schema_migrations) <> '001_initial_schema.sql'
     OR (SELECT max(nombre) FROM public.rodeo_schema_migrations) <> '007_invitaciones_constraints.sql' THEN
    RAISE EXCEPTION 'El historial inicial no contiene exactamente el prefijo 001–007.';
  END IF;
END;
$validar_historial$;

COMMIT;
