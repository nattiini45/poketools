BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_admin_insert(p_season_id uuid, p_fields jsonb, p_insert_at integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := p_fields ->> 'name';
  v_max integer;
  v_at integer;
  v_shifted uuid[];
  v_phase public.league_phases%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SEASON_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_formats WHERE season_id = p_season_id) THEN
    RAISE EXCEPTION 'format_phase_owned' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.league_phases WHERE season_id = p_season_id ORDER BY id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM public.league_phases WHERE season_id = p_season_id
             AND lower(btrim(normalize(name))) = lower(btrim(normalize(v_name)))) THEN
    RAISE EXCEPTION 'PHASE_NAME_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT greatest(0, coalesce(max(stage_order), 0)) INTO v_max
    FROM public.league_phases WHERE season_id = p_season_id;
  v_at := coalesce(p_insert_at, v_max + 1);
  IF v_at < 1 OR v_at > v_max + 1 THEN RAISE EXCEPTION 'PHASE_INSERT_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.league_phases WHERE season_id = p_season_id
             AND stage_order >= v_at AND status <> 'upcoming') THEN
    RAISE EXCEPTION 'PHASE_INSERT_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  WITH shifted AS (
    UPDATE public.league_phases SET stage_order = stage_order + 1
      WHERE season_id = p_season_id AND stage_order >= v_at
      RETURNING id
  )
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_shifted FROM shifted;

  INSERT INTO public.league_phases (
    season_id, name, description, bracket_type, ruleset_id, best_of_default, bo_overrides,
    is_doubles, team_visibility, stage_order, advancement_rule
  ) VALUES (
    p_season_id, v_name, coalesce(p_fields ->> 'description', ''),
    (p_fields ->> 'bracket_type')::public.bracket_type, (p_fields ->> 'ruleset_id')::uuid,
    (p_fields ->> 'best_of_default')::integer, coalesce(p_fields -> 'bo_overrides', '{}'::jsonb),
    (p_fields ->> 'is_doubles')::boolean, (p_fields ->> 'team_visibility')::public.team_visibility,
    v_at, nullif(p_fields -> 'advancement_rule', 'null'::jsonb)
  ) RETURNING * INTO v_phase;
  RETURN jsonb_build_object('phase', to_jsonb(v_phase), 'shifted_ids', to_jsonb(v_shifted));
END $$;

CREATE OR REPLACE FUNCTION public.phase_stage_orders_reorder(p_season_id uuid, p_phase_ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_all uuid[];
  v_pinned uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SEASON_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_formats WHERE season_id = p_season_id) THEN
    RAISE EXCEPTION 'format_phase_owned' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.league_phases WHERE season_id = p_season_id ORDER BY id FOR NO KEY UPDATE;
  SELECT coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id ORDER BY stage_order, created_at, id) FILTER (WHERE status <> 'upcoming'), '{}')
    INTO v_all, v_pinned FROM public.league_phases WHERE season_id = p_season_id;
  IF p_phase_ids IS NULL OR cardinality(p_phase_ids) <> cardinality(v_all)
     OR NOT (v_all <@ p_phase_ids) THEN
    RAISE EXCEPTION 'PHASE_REORDER_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_pinned) > 0 AND p_phase_ids[1:cardinality(v_pinned)] IS DISTINCT FROM v_pinned THEN
    RAISE EXCEPTION 'PHASE_REORDER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.league_phases p SET stage_order = e.ord::integer
    FROM unnest(p_phase_ids) WITH ORDINALITY AS e(id, ord) WHERE p.season_id = p_season_id AND p.id = e.id;
END $$;

REVOKE ALL ON FUNCTION public.phase_admin_insert(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_admin_insert(uuid, jsonb, integer) TO service_role;
REVOKE ALL ON FUNCTION public.phase_stage_orders_reorder(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_stage_orders_reorder(uuid, uuid[]) TO service_role;
COMMIT;
