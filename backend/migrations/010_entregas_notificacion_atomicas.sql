DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.entregas_eventos_notificacion
     WHERE notificacion_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay entregas históricas sin notificación; requieren reconciliación antes de aplicar 010.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.exigir_entrega_con_notificacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.entregas_eventos_notificacion e
     WHERE e.evento_id = NEW.evento_id
       AND e.user_id = NEW.user_id
       AND e.notificacion_id IS NULL
  ) THEN
    RAISE EXCEPTION 'La entrega del evento debe vincularse a una notificacion antes del COMMIT.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'entregas_eventos_notificacion_completas'
       AND tgrelid = 'public.entregas_eventos_notificacion'::regclass
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE CONSTRAINT TRIGGER entregas_eventos_notificacion_completas
      AFTER INSERT OR UPDATE OF notificacion_id ON public.entregas_eventos_notificacion
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.exigir_entrega_con_notificacion()';
  END IF;
END;
$$;
