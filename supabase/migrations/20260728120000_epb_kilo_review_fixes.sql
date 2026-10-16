-- EPB Kilo review fixes:
-- 1. Atomic replace for match_evolution_snapshots (delete + insert in one txn)
-- 2. Helper used by insertMatchSnapshots so re-finalize cannot leave a match
--    with zero rows if the process dies between delete and upsert.

CREATE OR REPLACE FUNCTION public.epb_replace_match_snapshots(
  p_match_id uuid,
  p_snapshots jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required';
  END IF;

  DELETE FROM public.match_evolution_snapshots
  WHERE match_id = p_match_id;

  IF p_snapshots IS NULL OR jsonb_typeof(p_snapshots) <> 'array' THEN
    RAISE EXCEPTION 'p_snapshots must be a JSON array';
  END IF;

  IF jsonb_array_length(p_snapshots) = 0 THEN
    RETURN;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
    INSERT INTO public.match_evolution_snapshots (
      match_id,
      player_id,
      tracker_id,
      base_pokemon,
      species_at_match,
      stage_at_match,
      progress_before,
      progress_after,
      real_kos,
      draft_tokens_delta,
      kill_tokens_delta,
      cosmo_points_delta,
      evolution_triggered,
      suspension_triggered,
      brought
    ) VALUES (
      p_match_id,
      (v_row->>'player_id')::uuid,
      NULLIF(v_row->>'tracker_id', '')::uuid,
      v_row->>'base_pokemon',
      v_row->>'species_at_match',
      (v_row->>'stage_at_match')::smallint,
      COALESCE((v_row->>'progress_before')::integer, 0),
      COALESCE((v_row->>'progress_after')::integer, 0),
      COALESCE((v_row->>'real_kos')::smallint, 0),
      COALESCE((v_row->>'draft_tokens_delta')::smallint, 0),
      COALESCE((v_row->>'kill_tokens_delta')::smallint, 0),
      COALESCE((v_row->>'cosmo_points_delta')::smallint, 0),
      COALESCE((v_row->>'evolution_triggered')::boolean, false),
      COALESCE((v_row->>'suspension_triggered')::boolean, false),
      COALESCE((v_row->>'brought')::boolean, false)
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.epb_replace_match_snapshots(uuid, jsonb) IS
  'Atomically replace all match_evolution_snapshots for a match (single transaction).';
