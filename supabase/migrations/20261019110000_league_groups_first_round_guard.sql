-- League groups, part 4: the first round of a mirrored phase is written only from the current league groups
-- (round-4 gate minor; lead decisions round 5; follows 20261018202100).
--
-- Before a table phase's first round, ensurePhaseGroupsFromLeague (src/lib/tournament/group-rounds.ts) rebuilds the
-- phase groups from the league groups (tournament_groups.season_group_id set), and generate-round /
-- generate-all-rounds then insert the first round. Those are separate requests to the database, so a league group
-- move (or a first placement, or an enrollment change) committed between the mirror and the round insert left the
-- phase groups stale. Once the round exists the schedule lock (20261018202000, SEASON_GROUPS_SCHEDULED) refuses every
-- later move and the phase groups are never rewritten, so that drift could not be repaired.
--
-- This trigger closes the window from the round's side. A BEFORE INSERT on rounds, for a phase whose groups mirror
-- league groups and that has no round yet, takes the season's advisory lock (the draft__lock key, the same one the
-- membership guard and season_groups_replace take) and refuses with PHASE_GROUPS_STALE when the phase groups differ
-- from what the league groups say now: every enrolled trainer must sit in the phase group that mirrors their league
-- group, and nobody else may sit in one. Both orders are covered:
--   * the round insert holds the lock first: a membership write waits, then sees the round and is refused
--     (SEASON_GROUPS_SCHEDULED);
--   * the membership write commits first: the round insert sees the drift and is refused (PHASE_GROUPS_STALE, 409 in
--     errors/seasons). Generating again re-mirrors the phase (it still has no round) and writes the round.
-- Phases without mirrored groups (a league without groups, phase-only groups, elimination phases) and every later
-- round are not checked.
--
-- RLS unchanged; the trigger function is revoked from PUBLIC/anon/authenticated and granted to service_role.
BEGIN;

CREATE OR REPLACE FUNCTION public.rounds__league_groups_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_season uuid;
BEGIN
  SELECT t.season_id INTO v_season FROM public.tournaments t WHERE t.id = NEW.tournament_id;
  IF v_season IS NULL OR NOT EXISTS (SELECT 1 FROM public.tournament_groups g
                                       WHERE g.tournament_id = NEW.tournament_id AND g.season_group_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
  -- Only the phase's first round: after it the phase groups are never rewritten (and the membership is final).
  IF EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = NEW.tournament_id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
       (SELECT m.player_id, g.season_group_id
          FROM public.tournament_group_members m JOIN public.tournament_groups g ON g.id = m.group_id
         WHERE g.tournament_id = NEW.tournament_id
        EXCEPT
        SELECT p.player_id, s.group_id
          FROM public.tournament_participants p
          LEFT JOIN public.season_group_members s ON s.season_id = v_season AND s.player_id = p.player_id
         WHERE p.tournament_id = NEW.tournament_id)
       UNION ALL
       (SELECT p.player_id, s.group_id
          FROM public.tournament_participants p
          LEFT JOIN public.season_group_members s ON s.season_id = v_season AND s.player_id = p.player_id
         WHERE p.tournament_id = NEW.tournament_id
        EXCEPT
        SELECT m.player_id, g.season_group_id
          FROM public.tournament_group_members m JOIN public.tournament_groups g ON g.id = m.group_id
         WHERE g.tournament_id = NEW.tournament_id)) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('tournament_id', NEW.tournament_id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rounds_league_groups_guard BEFORE INSERT ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.rounds__league_groups_guard();

REVOKE ALL ON FUNCTION public.rounds__league_groups_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rounds__league_groups_guard() TO service_role;

COMMIT;
