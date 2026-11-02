-- Close the two gaps the roster lock of 20261102140000 left (issue #46).
--
-- 1. Activation. A roster write checks for a live legacy pool under the season's advisory lock, but the status flip
--    of the pool (PATCH /api/drafts/[id], pending -> in_progress) took no lock, so a join or removal that read the
--    pool as pending could commit after the pool went live and move everybody's seat. The flip now takes the same
--    lock (the draft__lock key) for the statement that makes the pool live, so the two serialize: a roster write
--    that holds the lock commits first and the draft starts on that roster; a draft that went live first makes the
--    roster write find it live and refuse. Only a legacy pool entering 'in_progress' pays for the lock.
-- 2. Substitution. A league-scope substitution moves a roster row with an UPDATE of season_participants.player_id,
--    which had no database guard (the route read the pool before it wrote). The same check now runs in a trigger
--    under the same lock, so an activation between the route's read and the swap is refused too:
--    SEASON_DRAFT_LOCKED (P0001, HTTP 409), as for a join or a removal. A league without a legacy pool takes no lock.
--
-- Two triggers on existing tables, none of them an INSERT trigger, so league_trash__inventory() needs no change
-- (a restore inserts season_participants before draft_pools and never updates either). Functions only: no table,
-- no data, RLS unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.draft_pools__serialize_activation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.engine = 'legacy' AND NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_draft_pools_serialize_activation BEFORE UPDATE OF status ON public.draft_pools
  FOR EACH ROW EXECUTE FUNCTION public.draft_pools__serialize_activation();

CREATE OR REPLACE FUNCTION public.season_participants__swap_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = NEW.season_id AND engine = 'legacy') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  IF public.season__legacy_draft_live(NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_DRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_season_participants_swap_guard BEFORE UPDATE OF player_id ON public.season_participants
  FOR EACH ROW WHEN (OLD.player_id IS DISTINCT FROM NEW.player_id)
  EXECUTE FUNCTION public.season_participants__swap_guard();

REVOKE ALL ON FUNCTION
  public.draft_pools__serialize_activation(),
  public.season_participants__swap_guard()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft_pools__serialize_activation(),
  public.season_participants__swap_guard()
TO service_role;

COMMIT;
