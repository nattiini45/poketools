-- Two state-machine guards that only SQL can hold (docs/state-machines.md: format_action_submission, format_challenge).
--
-- format_action_save updates a row only while it is a draft. Until now its ON CONFLICT DO UPDATE refused only a locked
-- row, so a save over a submitted pick turned it back into a draft and released the items the submission granted.
-- saveAction (actions-server.ts) refused that from its own earlier read of the runtime, but a submit that committed
-- between that read and the save (two requests of one account) was still demoted. The guard is now decided under the
-- action's advisory lock and the row lock of the upsert: a submitted row raises action_already_submitted (the code
-- format_action_submit raises for the deadline draw), a locked row raises action_locked as before. A draft holds no
-- items (only a submit grants them, and it leaves the row submitted or locked), so the save no longer releases any.
--
-- round_delete cancels the challenges of the matches it deletes only while they are accepted. Only an accept sets
-- match_id, so this is the set it reached before; the guard makes the machine's accepted -> cancelled explicit.
--
-- Both signatures are unchanged (CREATE OR REPLACE keeps the ACL); the grants are restated as in
-- 20261105090000_format_runtime.sql and 20261106090000_format_challenges.sql: service_role only.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.format_action_save(
  p_season_id uuid, p_action_key text, p_actor uuid, p_target uuid, p_picks jsonb, p_expected_revision bigint
) RETURNS public.format_action_submissions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row    public.format_action_submissions;
  v_status text;
BEGIN
  PERFORM public.format__lock_action(p_season_id, p_action_key);
  PERFORM public.format__assert_season_open(p_season_id);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  IF public.format__action_flag_locked(p_season_id, p_action_key) THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  INSERT INTO public.format_action_submissions AS s (season_id, action_key, actor_player_id, target_player_id, status, picks)
  VALUES (p_season_id, p_action_key, p_actor, p_target, 'draft', coalesce(p_picks, '[]'::jsonb))
  ON CONFLICT (season_id, action_key, actor_player_id) DO UPDATE
    SET target_player_id = EXCLUDED.target_player_id, picks = EXCLUDED.picks, updated_at = now()
    WHERE s.status = 'draft'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    -- The upsert left the conflicting row locked, so its status cannot move before this read.
    SELECT s.status INTO v_status FROM public.format_action_submissions s
     WHERE s.season_id = p_season_id AND s.action_key = p_action_key AND s.actor_player_id = p_actor;
    IF v_status = 'submitted' THEN
      RAISE EXCEPTION 'action_already_submitted' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
    END IF;
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  RETURN v_row;
END $$;

-- Unchanged from 20261106090000_format_challenges.sql (its comments explain the lock order) except for the status guard
-- on the challenge cancel.
CREATE OR REPLACE FUNCTION public.round_delete(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_phase     uuid;
  v_season    uuid;
  v_unsettled integer;
  v_matches   integer;
BEGIN
  IF p_round_id IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'round_delete')::text;
  END IF;
  SELECT r.tournament_id INTO v_phase FROM public.rounds r WHERE r.id = p_round_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  SELECT t.season_id INTO v_season FROM public.tournaments t WHERE t.id = v_phase;
  IF v_season IS NOT NULL THEN
    PERFORM 1 FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE;
  END IF;
  PERFORM 1 FROM public.format_challenges c WHERE c.phase_id = v_phase AND c.status IN ('open', 'accepted') ORDER BY c.id FOR UPDATE;
  PERFORM 1 FROM public.tournaments t WHERE t.id = v_phase FOR SHARE;
  PERFORM 1 FROM public.rounds r WHERE r.id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  SELECT count(*) INTO v_unsettled FROM public.matches m WHERE m.round_id = p_round_id AND m.status <> 'scheduled';
  IF v_unsettled > 0 THEN
    RAISE EXCEPTION 'round_changed' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('unsettled', v_unsettled)::text;
  END IF;
  UPDATE public.format_challenges SET status = 'cancelled', responded_at = coalesce(responded_at, now())
   WHERE match_id IN (SELECT m.id FROM public.matches m WHERE m.round_id = p_round_id) AND status = 'accepted';
  DELETE FROM public.matches WHERE round_id = p_round_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;
  DELETE FROM public.rounds WHERE id = p_round_id;
  RETURN jsonb_build_object('outcome', 'deleted', 'matches', v_matches);
END $$;

REVOKE ALL ON FUNCTION
  public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint),
  public.round_delete(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint),
  public.round_delete(uuid)
  TO service_role;

COMMENT ON FUNCTION public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint) IS
  'Saves a player action pick as a draft; only a draft (or no row) is written. Raises action_already_submitted when the actor''s pick is submitted (the player submits again to change it), action_locked when the action flag or the actor''s submission is locked, format_context_stale when the league''s format changed since p_expected_revision was read.';
COMMENT ON FUNCTION public.round_delete(uuid) IS
  'Deletes a round and its matches in one transaction under the challenge rows, the phase FOR SHARE and the round FOR UPDATE; refuses (round_changed) when a match is not scheduled any more, cancels the accepted challenges that point at a deleted match. Returns jsonb {outcome: deleted | not_found}.';

COMMIT;
