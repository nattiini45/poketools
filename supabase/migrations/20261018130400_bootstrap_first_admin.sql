-- First-admin bootstrap (code review M7; lead decision 2026-10-18).
--
-- POST /api/bootstrap used to count players, then insert a new admin row in a separate statement. That never
-- worked on a normal first run (sign-in already creates the caller's players row, so the count is never 0) and
-- the count-then-insert pair raced. Eligibility is now "no admin exists", and the caller's EXISTING row is
-- promoted. The check and the promotion run in one transaction under a fixed advisory lock, so two concurrent
-- callers serialize and only the first one can promote.
--
-- Returns one of:
--   'promoted'          the player is now the first admin
--   'admin_exists'      some player already has is_admin = true (bootstrap is permanently off)
--   'player_not_found'  no players row with that id (the caller must sign out and in again)
--
-- Service-role only: EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role
-- (AGENTS.md "Never Do"; src/lib/supabase/__tests__/migration-api-grants.test.ts).
BEGIN;

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_player_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_first_admin: player id is required' USING ERRCODE = '22023';
  END IF;

  -- One fixed key: every bootstrap attempt serializes here, then re-reads the admin set.
  PERFORM pg_advisory_xact_lock(hashtext('public.bootstrap_first_admin'));

  IF EXISTS (SELECT 1 FROM public.players WHERE is_admin) THEN
    RETURN 'admin_exists';
  END IF;

  UPDATE public.players SET is_admin = true WHERE id = p_player_id;
  IF NOT FOUND THEN
    RETURN 'player_not_found';
  END IF;

  RETURN 'promoted';
END
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid) TO service_role;
COMMENT ON FUNCTION public.bootstrap_first_admin(uuid) IS
  'Service-role only. Promotes the caller''s players row to the first admin while no admin exists (POST /api/bootstrap).';

COMMIT;
