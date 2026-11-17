BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_format_fire_match_event(
  p_season_id uuid, p_event_key text, p_event text, p_payload jsonb, p_ops jsonb,
  p_fired_by uuid, p_expected_revision bigint, p_notifications jsonb,
  p_match_id uuid, p_winner_id uuid, p_confirmed_at timestamptz DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.format__lock_op_keys(p_season_id, p_ops);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  IF p_event IS DISTINCT FROM 'match_completed' OR p_winner_id IS NULL THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.league_phases p
    JOIN public.phase_matches m ON m.phase_id = p.id
    WHERE m.id = p_match_id AND p.season_id = p_season_id
    FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.phase_matches m
    JOIN public.league_phases p ON p.id = m.phase_id
    WHERE m.id = p_match_id AND p.season_id = p_season_id
      AND m.status = 'completed' AND m.confirmed_at IS NOT DISTINCT FROM p_confirmed_at
      AND m.winner_id = p_winner_id AND m.winner_id IN (m.player_1_id, m.player_2_id)
    FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.format_fire_event_notify(
    p_season_id, p_event_key, p_event, p_payload, p_ops, p_fired_by,
    p_expected_revision, p_notifications
  );
END $$;

REVOKE ALL ON FUNCTION public.phase_format_fire_match_event(uuid,text,text,jsonb,jsonb,uuid,bigint,jsonb,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_format_fire_match_event(uuid,text,text,jsonb,jsonb,uuid,bigint,jsonb,uuid,uuid,timestamptz) TO service_role;
COMMIT;
