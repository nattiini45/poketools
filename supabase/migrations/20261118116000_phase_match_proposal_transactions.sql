BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_match_proposal_create(
  p_phase_id uuid, p_match_id uuid, p_player_id uuid, p_proposed_at timestamptz, p_message text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_match public.phase_matches%ROWTYPE;
  v_proposal public.phase_match_proposals%ROWTYPE;
  v_now timestamptz;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  SELECT * INTO v_match FROM public.phase_matches
    WHERE id = p_match_id AND phase_id = p_phase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_player_id IS NULL OR p_player_id NOT IN (v_match.player_1_id, v_match.player_2_id) THEN
    RAISE EXCEPTION 'match_proposal_participants_only' USING ERRCODE = 'P0001';
  END IF;
  IF v_match.status IN ('completed', 'disputed') THEN
    RAISE EXCEPTION 'match_proposal_match_closed' USING ERRCODE = 'P0001';
  END IF;
  v_now := clock_timestamp();
  IF p_proposed_at IS NULL OR p_proposed_at <= v_now THEN
    RAISE EXCEPTION 'match_proposal_time_past' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.phase_match_proposals SET status = 'expired', responded_at = v_now
    WHERE match_id = p_match_id AND status = 'pending' AND expires_at <= v_now;
  IF EXISTS (SELECT 1 FROM public.phase_match_proposals WHERE match_id = p_match_id AND status = 'pending') THEN
    RAISE EXCEPTION 'match_proposal_pending_exists' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.phase_match_proposals (match_id, proposer_id, responder_id, proposed_at, message, expires_at)
    VALUES (p_match_id, p_player_id,
      CASE WHEN p_player_id = v_match.player_1_id THEN v_match.player_2_id ELSE v_match.player_1_id END,
      p_proposed_at, coalesce(p_message, ''), v_now + interval '48 hours')
    RETURNING * INTO v_proposal;
  RETURN to_jsonb(v_proposal);
END $$;

CREATE FUNCTION public.phase_match_proposal_respond(
  p_phase_id uuid, p_match_id uuid, p_proposal_id uuid, p_player_id uuid, p_accept boolean
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_match public.phase_matches%ROWTYPE;
  v_proposal public.phase_match_proposals%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_accept IS NULL THEN RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.phase__lock(p_phase_id);
  SELECT * INTO v_match FROM public.phase_matches
    WHERE id = p_match_id AND phase_id = p_phase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_proposal FROM public.phase_match_proposals
    WHERE id = p_proposal_id AND match_id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_proposal_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_player_id IS DISTINCT FROM v_proposal.responder_id OR NOT (
    (v_proposal.responder_id = v_match.player_1_id AND v_proposal.proposer_id = v_match.player_2_id)
    OR (v_proposal.responder_id = v_match.player_2_id AND v_proposal.proposer_id = v_match.player_1_id)
  ) THEN
    IF p_accept THEN RAISE EXCEPTION 'match_proposal_accept_responder_only' USING ERRCODE = 'P0001'; END IF;
    RAISE EXCEPTION 'match_proposal_reject_responder_only' USING ERRCODE = 'P0001';
  END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'match_proposal_not_pending' USING ERRCODE = 'P0001';
  END IF;
  v_now := clock_timestamp();
  IF v_proposal.expires_at <= v_now THEN
    UPDATE public.phase_match_proposals SET status = 'expired', responded_at = v_now
      WHERE id = p_proposal_id AND status = 'pending';
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  IF p_accept AND v_match.status IN ('completed', 'disputed') THEN
    RAISE EXCEPTION 'match_schedule_closed' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.phase_match_proposals
    SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END::public.match_proposal_status, responded_at = v_now
    WHERE id = p_proposal_id AND status = 'pending' RETURNING * INTO v_proposal;
  IF p_accept THEN
    UPDATE public.phase_matches SET scheduled_at = v_proposal.proposed_at WHERE id = p_match_id AND phase_id = p_phase_id;
    UPDATE public.phase_match_proposals SET status = 'cancelled', responded_at = v_now
      WHERE match_id = p_match_id AND status = 'pending';
  END IF;
  RETURN jsonb_build_object('outcome', 'answered', 'proposal', to_jsonb(v_proposal));
END $$;

CREATE FUNCTION public.phase_match_schedule_override(
  p_phase_id uuid, p_match_id uuid, p_scheduled_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_match public.phase_matches%ROWTYPE;
  v_cancelled integer;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  SELECT * INTO v_match FROM public.phase_matches
    WHERE id = p_match_id AND phase_id = p_phase_id FOR UPDATE;
  IF NOT FOUND OR v_match.status = 'completed' THEN
    RAISE EXCEPTION 'match_schedule_completed' USING ERRCODE = 'P0001';
  END IF;
  IF v_match.scheduled_at IS NOT DISTINCT FROM p_scheduled_at THEN
    RETURN jsonb_build_object('scheduled_at', v_match.scheduled_at, 'previous_scheduled_at', v_match.scheduled_at,
      'proposals_cancelled', 0, 'proposals_cancel_failed', false, 'unchanged', true);
  END IF;
  UPDATE public.phase_matches SET scheduled_at = p_scheduled_at WHERE id = p_match_id AND phase_id = p_phase_id;
  UPDATE public.phase_match_proposals SET status = 'cancelled', responded_at = clock_timestamp()
    WHERE match_id = p_match_id AND status = 'pending';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN jsonb_build_object('scheduled_at', p_scheduled_at, 'previous_scheduled_at', v_match.scheduled_at,
    'proposals_cancelled', v_cancelled, 'proposals_cancel_failed', false, 'unchanged', false);
END $$;

REVOKE ALL ON FUNCTION public.phase_match_proposal_create(uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase_match_proposal_respond(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase_match_schedule_override(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_match_proposal_create(uuid, uuid, uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_match_proposal_respond(uuid, uuid, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_match_schedule_override(uuid, uuid, timestamptz) TO service_role;

COMMIT;
