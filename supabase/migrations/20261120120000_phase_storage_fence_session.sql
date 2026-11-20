-- The phase storage fence (20261117102000_phase_storage_fence.sql) exempted every statement whose current_user is the
-- schema owner. PostgreSQL runs ON DELETE CASCADE / SET NULL actions as the referencing table's owner, so a cascade
-- from an API request (a service-role DELETE on players, seasons or tournaments) ran with current_user = postgres and
-- changed phase rows outside `phase` mode. In legacy mode the phase tables are normally empty and a row trigger has
-- nothing to fire on, but a rollback from phase to legacy leaves phase rows behind. The exemption now also requires the
-- session to have logged in as the owner, as the legacy write freeze does (20261120110000): an API request keeps
-- session_user = authenticator during the cascade, while the operator connection and the procedures it runs stay exempt.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_storage__guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  IF NOT (current_user = 'postgres' AND session_user = 'postgres') THEN
    v_mode := public.phase_storage_mode();
    IF v_mode IS DISTINCT FROM 'phase' THEN
      RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phase_storage__guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_storage__guard() TO service_role;

COMMIT;
