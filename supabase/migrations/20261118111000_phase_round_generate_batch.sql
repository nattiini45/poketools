BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_round_generate_batch(
  p_season_id uuid, p_phase_id uuid, p_rounds jsonb, p_expected_updated_at timestamptz,
  p_inputs jsonb, p_replacement_groups jsonb DEFAULT NULL, p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_plan record;
  v_result jsonb;
  v_round public.phase_rounds%ROWTYPE;
  v_batch jsonb := '[]'::jsonb;
  v_previous integer := 0;
BEGIN
  IF jsonb_typeof(p_rounds) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_rounds) = 0 OR p_inputs -> 'phase' ->> 'bracket_type' IS DISTINCT FROM 'round_robin' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;

  FOR v_plan IN SELECT * FROM ROWS FROM (jsonb_to_recordset(p_rounds) AS (
    round_id uuid, name text, round_number integer, best_of integer, bye_player_ids uuid[], matches jsonb, deadline timestamptz
  )) WITH ORDINALITY ORDER BY ordinality LOOP
    IF v_plan.round_number IS NULL OR v_plan.round_number <= v_previous THEN
      RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
    END IF;
    IF v_previous = 0 THEN
      v_result := public.phase_round_generate(
        p_season_id, p_phase_id, v_plan.round_id, v_plan.name, v_plan.round_number, v_plan.best_of,
        v_plan.bye_player_ids, v_plan.matches, v_plan.deadline, p_expected_updated_at,
        p_inputs, p_replacement_groups, p_expected_revision
      );
    ELSE
      v_result := public.phase_round_write(
        p_phase_id, v_plan.round_id, v_plan.name, v_plan.round_number, v_plan.best_of,
        v_plan.bye_player_ids, v_plan.matches, p_expected_revision
      );
      IF v_plan.round_id IS NOT NULL OR v_plan.deadline IS NOT NULL THEN
        UPDATE public.phase_rounds
          SET pairings_generated = true, deadline = coalesce(deadline, v_plan.deadline)
          WHERE id = (v_result -> 'round' ->> 'id')::uuid AND phase_id = p_phase_id
          RETURNING * INTO STRICT v_round;
        v_result := jsonb_set(v_result, '{round}', to_jsonb(v_round));
      END IF;
    END IF;
    IF (v_result -> 'round' ->> 'round_number')::integer IS DISTINCT FROM v_plan.round_number
      OR v_result -> 'round' ->> 'bracket_side' IS NOT NULL THEN
      RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001';
    END IF;
    v_batch := v_batch || jsonb_build_array(v_result);
    v_previous := v_plan.round_number;
  END LOOP;
  RETURN v_batch;
END $$;

REVOKE ALL ON FUNCTION public.phase_round_generate_batch(uuid, uuid, jsonb, timestamptz, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_generate_batch(uuid, uuid, jsonb, timestamptz, jsonb, jsonb, bigint) TO service_role;

COMMIT;
