-- One locked writer for an elimination bracket (docs/tournament.md, "Bracket generation"; tournamentMachine in
-- src/lib/tournament/tournament-state.ts). Until now the bracket was written from the app in many statements (the rounds
-- one by one, the matches, the enrollment freeze, then the status), and a regenerate deleted the old bracket first. A status
-- write of another writer (an admin completing the phase, the format's stage end) could land between those statements:
-- the phase then ended up completed with a freshly generated bracket, or a regenerate restarted a phase that had just been
-- completed.
--
-- bracket_write(tournament, expected status, replace, rounds, matches, current round) writes the whole bracket in one
-- transaction under the phase row lock:
--   * it locks the phase row and refuses unless the status is still the one the caller read (tournament_status_changed,
--     DETAIL the status found), so a completion that committed first is never overwritten and nothing is written;
--   * a first generate (replace = false) refuses a phase that already has rounds (bracket_already_generated);
--   * a regenerate (replace = true) locks the old rounds and matches, then refuses while a match of the phase is played (status other than scheduled, or games;
--     bracket_matches_played, DETAIL the count). The app resets the played matches first (ratings, aggregates, evolution
--     cannot be rolled back in SQL); a result reported since makes the regenerate refuse instead of deleting it. Then it
--     deletes the old matches and rounds;
--   * it inserts the rounds and the matches the app planned (ids chosen by the app), freezes the enrollment
--     (tournament_enrollment_freeze) and moves the status to active with the first round number.
--
-- Status writers it races, and how each is serialised (no change to them):
--   * the admin routes write the status with one guarded UPDATE (updateTournament with the status read: WHERE status = from).
--     The UPDATE waits for this row lock and re-evaluates its WHERE on the committed row: a completion queued behind a
--     bracket_write sees 'active' and completes the new bracket (the admin's later action), one that committed first makes
--     bracket_write refuse.
--   * phase_complete_at_stage_end locks the phase row FOR UPDATE and counts the unfinished matches under it: behind a
--     bracket_write it sees the new bracket's scheduled matches and leaves the phase active (unsettled); before it, the
--     phase is completed and bracket_write refuses.
--   * round_write takes the same locks in the same order.
--
-- Lock order (the one of 20261106090000_format_challenges.sql): the season advisory lock -> the seasons row FOR KEY SHARE ->
-- the phase row FOR NO KEY UPDATE (the lock every status UPDATE needs, and the one round_write takes; it conflicts with
-- phase_complete_at_stage_end's FOR UPDATE and with every status UPDATE) -> the rounds of the phase FOR UPDATE -> its
-- matches FOR UPDATE (a replace only; each in id order). The rounds
-- insert trigger (rounds__league_groups_guard) takes the same advisory lock, already held.
--
-- service_role only, like every writer here.

CREATE OR REPLACE FUNCTION public.bracket_write(
  p_tournament_id uuid, p_expected_status public.tournament_status, p_replace boolean,
  p_rounds jsonb, p_matches jsonb, p_current_round integer
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_season uuid;
  v_status public.tournament_status;
  v_played integer;
BEGIN
  IF p_tournament_id IS NULL OR p_expected_status IS NULL OR p_replace IS NULL OR p_current_round IS NULL
     OR p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) = 0
     OR p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'bracket_write')::text;
  END IF;

  SELECT t.season_id INTO v_season FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_season IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
    PERFORM 1 FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE;
  END IF;

  SELECT t.status INTO v_status FROM public.tournaments t WHERE t.id = p_tournament_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> p_expected_status THEN
    RAISE EXCEPTION 'tournament_status_changed' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('status', v_status)::text;
  END IF;

  IF p_replace THEN
    -- The old bracket's rows are locked before the played check and held through the delete, rounds then matches (the
    -- lock order of the header), each in id order: a result or a game written meanwhile either committed before the lock
    -- (the check below, a new statement, sees it and refuses) or waits for this transaction (a match status UPDATE needs
    -- the match row, a game insert its FOR KEY SHARE on the match, a match insert its FOR KEY SHARE on the round) and then
    -- finds its parent gone. Nothing played is deleted.
    PERFORM 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id ORDER BY r.id FOR UPDATE;
    PERFORM 1 FROM public.matches m WHERE m.tournament_id = p_tournament_id ORDER BY m.id FOR UPDATE;
    SELECT count(*) INTO v_played FROM public.matches m
     WHERE m.tournament_id = p_tournament_id
       AND (m.status <> 'scheduled' OR EXISTS (SELECT 1 FROM public.games g WHERE g.match_id = m.id));
    IF v_played > 0 THEN
      RAISE EXCEPTION 'bracket_matches_played' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('count', v_played)::text;
    END IF;
    DELETE FROM public.matches WHERE tournament_id = p_tournament_id;
    DELETE FROM public.rounds WHERE tournament_id = p_tournament_id;
  ELSIF EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id) THEN
    RAISE EXCEPTION 'bracket_already_generated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rounds (id, tournament_id, name, round_number, best_of, bracket_side, pairings_generated)
  SELECT r.id, p_tournament_id, r.name, r.round_number, r.best_of, r.bracket_side, true
    FROM jsonb_to_recordset(p_rounds) AS r(id uuid, name text, round_number integer, best_of integer, bracket_side text);

  INSERT INTO public.matches (id, round_id, tournament_id, player_1_id, player_2_id, bracket_side, bracket_pos)
  SELECT m.id, m.round_id, p_tournament_id, m.player_1_id, m.player_2_id, m.bracket_side, m.bracket_pos
    FROM jsonb_to_recordset(p_matches) AS m(
      id uuid, round_id uuid, player_1_id uuid, player_2_id uuid, bracket_side text, bracket_pos integer
    );

  PERFORM public.tournament_enrollment_freeze(p_tournament_id);

  UPDATE public.tournaments SET status = 'active', current_round = p_current_round WHERE id = p_tournament_id;

  RETURN jsonb_build_object('rounds', jsonb_array_length(p_rounds), 'matches', jsonb_array_length(p_matches));
END $$;

REVOKE ALL ON FUNCTION public.bracket_write(uuid, public.tournament_status, boolean, jsonb, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bracket_write(uuid, public.tournament_status, boolean, jsonb, jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.bracket_write(uuid, public.tournament_status, boolean, jsonb, jsonb, integer) IS
  'Writes or replaces an elimination bracket and moves the phase to active in one transaction under the phase row lock; refuses a status that moved since the caller read it (tournament_status_changed). See the migration header.';
