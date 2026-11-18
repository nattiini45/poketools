BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_match_settle_admin(
  p_phase_id uuid, p_match_id uuid, p_expected_status public.match_status,
  p_player_1_id uuid, p_player_2_id uuid, p_winner_id uuid,
  p_actor_id uuid, p_kind text, p_reason text
) RETURNS timestamptz
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_now timestamptz; v_p1 smallint; v_p2 smallint;
BEGIN
  IF p_expected_status IS NULL OR p_expected_status NOT IN ('scheduled', 'in_progress')
    OR p_player_1_id IS NULL OR p_player_2_id IS NULL OR p_player_1_id = p_player_2_id
    OR p_winner_id IS NULL OR p_winner_id NOT IN (p_player_1_id, p_player_2_id)
    OR p_actor_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('played', 'forfeit', 'no_show')
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.phase__lock(p_phase_id);
  v_now := clock_timestamp();
  UPDATE public.phase_matches
    SET status = 'completed', winner_id = p_winner_id,
      submitter_id = coalesce(submitter_id, p_actor_id), date_played = v_now,
      confirmed_at = v_now, auto_confirm_at = NULL, finalized_at = NULL
    WHERE id = p_match_id AND phase_id = p_phase_id AND status = p_expected_status
      AND player_1_id = p_player_1_id AND player_2_id = p_player_2_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_kind = 'played' THEN
    SELECT
      CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE s.player_id = p_player_1_id AND s.was_koed) END,
      CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE s.player_id = p_player_2_id AND s.was_koed) END
      INTO v_p1, v_p2
      FROM public.phase_games g JOIN public.phase_battle_stats s ON s.game_id = g.id
      WHERE g.match_id = p_match_id;
  END IF;
  PERFORM public.phase_match_outcome_record(p_match_id, p_kind, 'admin', true,
    p_p1_faints => v_p1, p_p2_faints => v_p2, p_reason => btrim(p_reason), p_set_by => p_actor_id);
  RETURN v_now;
END $$;

REVOKE ALL ON FUNCTION public.phase_match_settle_admin(uuid, uuid, public.match_status, uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_match_settle_admin(uuid, uuid, public.match_status, uuid, uuid, uuid, uuid, text, text)
  TO service_role;
COMMIT;
