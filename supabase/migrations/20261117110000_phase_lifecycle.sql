BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase__lock(p_phase_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season uuid;
BEGIN
  SELECT season_id INTO v_season FROM public.league_phases WHERE id = p_phase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
  PERFORM 1 FROM public.seasons WHERE id = v_season FOR KEY SHARE;
  PERFORM 1 FROM public.league_phases WHERE id = p_phase_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001'; END IF;
  RETURN v_season;
END $$;

CREATE OR REPLACE FUNCTION public.phase_enrollment_replace(
  p_phase_id uuid, p_entries jsonb, p_source jsonb, p_expected_synced_at text, p_force boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_current jsonb;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  SELECT t.enrollment_source INTO v_current FROM public.league_phases t WHERE t.id = p_phase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF (v_current ->> 'synced_at') IS DISTINCT FROM p_expected_synced_at THEN
    RETURN false;
  END IF;
  IF NOT coalesce(p_force, false) THEN
    IF coalesce(v_current ->> 'frozen', 'false') = 'true' THEN
      RAISE EXCEPTION 'enrollment_frozen' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.phase_rounds r WHERE r.phase_id = p_phase_id) THEN
      RAISE EXCEPTION 'enrollment_rounds_exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  DELETE FROM public.phase_participants WHERE phase_id = p_phase_id;
  INSERT INTO public.phase_participants (phase_id, player_id, seed)
  SELECT p_phase_id, e.player_id, e.seed FROM jsonb_to_recordset(p_entries) AS e(player_id uuid, seed integer);
  UPDATE public.league_phases
     SET enrollment_source = CASE
           WHEN v_current IS NULL THEN p_source
           ELSE p_source || jsonb_build_object('frozen', coalesce(v_current ->> 'frozen', 'false') = 'true')
         END
   WHERE id = p_phase_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.phase_enrollment_freeze(p_phase_id uuid)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  UPDATE public.league_phases
     SET enrollment_source = jsonb_set(enrollment_source, '{frozen}', 'true'::jsonb)
   WHERE id = p_phase_id AND enrollment_source IS NOT NULL AND jsonb_typeof(enrollment_source) = 'object'
     AND coalesce(enrollment_source ->> 'frozen', 'false') <> 'true';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.phase_round_write(
  p_phase_id uuid, p_round_id uuid, p_name text, p_round_number integer, p_best_of integer,
  p_bye_player_ids uuid[], p_matches jsonb, p_expected_revision bigint DEFAULT NULL, p_bracket_side text DEFAULT NULL,
  p_start_phase boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_season  uuid;
  v_status  public.phase_status;
  v_round   public.phase_rounds;
  v_matches integer;
BEGIN
  IF p_phase_id IS NULL OR p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array'
     OR (p_round_id IS NULL AND (p_name IS NULL OR p_round_number IS NULL OR p_best_of IS NULL)) THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'round_write')::text;
  END IF;

  IF p_start_phase IS NULL OR (NOT p_start_phase AND (p_round_id IS NOT NULL OR jsonb_array_length(p_matches) > 0)) THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'round_write')::text;
  END IF;

  SELECT t.season_id INTO v_season FROM public.league_phases t WHERE t.id = p_phase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_season IS NOT NULL THEN

    PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
    PERFORM 1 FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE;
    IF p_expected_revision IS NOT NULL THEN
      PERFORM public.format__check_revision(v_season, p_expected_revision);
    END IF;
  END IF;

  SELECT t.status INTO v_status FROM public.league_phases t WHERE t.id = p_phase_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'rounds_phase_completed' USING ERRCODE = 'P0001';
  END IF;

  IF p_round_id IS NULL THEN
    INSERT INTO public.phase_rounds (phase_id, name, round_number, best_of, bye_player_ids, pairings_generated, bracket_side)
    VALUES (p_phase_id, p_name, p_round_number, p_best_of, COALESCE(p_bye_player_ids, '{}'), true, p_bracket_side)
    RETURNING * INTO v_round;
  ELSE

    SELECT * INTO v_round FROM public.phase_rounds r WHERE r.id = p_round_id AND r.phase_id = p_phase_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_round.status = 'completed' THEN
      RAISE EXCEPTION 'rounds_round_completed' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.phase_matches m WHERE m.round_id = v_round.id) THEN
      RAISE EXCEPTION 'rounds_round_already_written' USING ERRCODE = 'P0001';
    END IF;
    IF p_bye_player_ids IS NOT NULL THEN
      UPDATE public.phase_rounds SET bye_player_ids = p_bye_player_ids WHERE id = v_round.id RETURNING * INTO v_round;
    END IF;
  END IF;

  INSERT INTO public.phase_matches (round_id, phase_id, player_1_id, player_2_id)
  SELECT v_round.id, p_phase_id, m.player_1_id, m.player_2_id
    FROM ROWS FROM (jsonb_to_recordset(p_matches) AS (player_1_id uuid, player_2_id uuid)) WITH ORDINALITY AS m(player_1_id, player_2_id, ord)
   ORDER BY m.ord;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  IF p_start_phase THEN
    UPDATE public.league_phases t
     SET status = CASE WHEN t.status = 'upcoming' THEN 'active'::public.phase_status ELSE t.status END,
         current_round = GREATEST(t.current_round, v_round.round_number)
     WHERE t.id = p_phase_id AND t.status IN ('upcoming', 'active') AND (t.status = 'upcoming' OR t.current_round < v_round.round_number);
  END IF;
  RETURN jsonb_build_object('round', to_jsonb(v_round), 'matches', v_matches);
END $$;

CREATE OR REPLACE FUNCTION public.phase_round_complete(p_round_id uuid, p_force boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row        public.phase_rounds;
  v_unfinished integer;
  v_phase uuid;
BEGIN
  IF p_round_id IS NULL OR p_force IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'round_complete')::text;
  END IF;
  SELECT phase_id INTO v_phase FROM public.phase_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  PERFORM public.phase__lock(v_phase);
  SELECT * INTO v_row FROM public.phase_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('outcome', 'already_completed');
  END IF;

  SELECT count(*) INTO v_unfinished FROM public.phase_matches m WHERE m.round_id = p_round_id AND m.status <> 'completed';
  IF v_unfinished > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('outcome', 'unfinished', 'unfinished', v_unfinished);
  END IF;
  UPDATE public.phase_rounds SET status = 'completed' WHERE id = p_round_id AND status IN ('pending', 'active') RETURNING * INTO v_row;
  RETURN jsonb_build_object('outcome', 'completed', 'round', to_jsonb(v_row), 'unfinished', v_unfinished);
END $$;

CREATE OR REPLACE FUNCTION public.league_phase_complete_at_stage_end(p_phase_id uuid, p_known_unfinished uuid[])
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row     public.league_phases;
  v_unknown integer;
BEGIN
  IF p_phase_id IS NULL OR p_known_unfinished IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'phase_complete')::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE id = p_phase_id) THEN
    RETURN jsonb_build_object('outcome', 'not_active');
  END IF;
  PERFORM public.phase__lock(p_phase_id);
  SELECT * INTO v_row FROM public.league_phases WHERE id = p_phase_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'active' THEN
    RETURN jsonb_build_object('outcome', 'not_active');
  END IF;
  SELECT count(*) INTO v_unknown FROM public.phase_matches m
   WHERE m.phase_id = p_phase_id AND m.status <> 'completed' AND m.id <> ALL (p_known_unfinished);
  IF v_unknown > 0 THEN
    RETURN jsonb_build_object('outcome', 'unsettled', 'unknown_unfinished', v_unknown);
  END IF;
  UPDATE public.league_phases SET status = 'completed' WHERE id = p_phase_id AND status = 'active' RETURNING * INTO v_row;
  RETURN jsonb_build_object('outcome', 'completed', 'phase', to_jsonb(v_row));
END $$;

CREATE OR REPLACE FUNCTION public.phase_round_delete(p_round_id uuid)
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
  SELECT r.phase_id INTO v_phase FROM public.phase_rounds r WHERE r.id = p_round_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT t.season_id INTO v_season FROM public.league_phases t WHERE t.id = v_phase;
  IF v_season IS NOT NULL THEN
    PERFORM 1 FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE;
  END IF;
  PERFORM 1 FROM public.format_challenges c WHERE c.league_phase_id = v_phase AND c.status IN ('open', 'accepted') ORDER BY c.id FOR UPDATE;
  PERFORM 1 FROM public.league_phases t WHERE t.id = v_phase FOR SHARE;
  PERFORM 1 FROM public.phase_rounds r WHERE r.id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT count(*) INTO v_unsettled FROM public.phase_matches m WHERE m.round_id = p_round_id AND m.status <> 'scheduled';
  IF v_unsettled > 0 THEN
    RAISE EXCEPTION 'round_changed' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('unsettled', v_unsettled)::text;
  END IF;
  UPDATE public.format_challenges SET status = 'cancelled', responded_at = coalesce(responded_at, now())
   WHERE phase_match_id IN (SELECT m.id FROM public.phase_matches m WHERE m.round_id = p_round_id);
  DELETE FROM public.phase_matches WHERE round_id = p_round_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;
  DELETE FROM public.phase_rounds WHERE id = p_round_id;
  RETURN jsonb_build_object('outcome', 'deleted', 'matches', v_matches);
END $$;

CREATE OR REPLACE FUNCTION public.phase_bracket_write(
  p_phase_id uuid, p_expected_status public.phase_status, p_replace boolean,
  p_rounds jsonb, p_matches jsonb, p_current_round integer
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_season uuid;
  v_status public.phase_status;
  v_played integer;
BEGIN
  IF p_phase_id IS NULL OR p_expected_status IS NULL OR p_replace IS NULL OR p_current_round IS NULL
     OR p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) = 0
     OR p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'bracket_write')::text;
  END IF;

  SELECT t.season_id INTO v_season FROM public.league_phases t WHERE t.id = p_phase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_season IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
    PERFORM 1 FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE;
  END IF;

  SELECT t.status INTO v_status FROM public.league_phases t WHERE t.id = p_phase_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> p_expected_status THEN
    RAISE EXCEPTION 'tournament_status_changed' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('status', v_status)::text;
  END IF;

  IF p_replace THEN

    PERFORM 1 FROM public.phase_rounds r WHERE r.phase_id = p_phase_id ORDER BY r.id FOR UPDATE;
    PERFORM 1 FROM public.phase_matches m WHERE m.phase_id = p_phase_id ORDER BY m.id FOR UPDATE;
    SELECT count(*) INTO v_played FROM public.phase_matches m
     WHERE m.phase_id = p_phase_id
       AND (m.status <> 'scheduled' OR EXISTS (SELECT 1 FROM public.phase_games g WHERE g.match_id = m.id));
    IF v_played > 0 THEN
      RAISE EXCEPTION 'bracket_matches_played' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('count', v_played)::text;
    END IF;
    DELETE FROM public.phase_matches WHERE phase_id = p_phase_id;
    DELETE FROM public.phase_rounds WHERE phase_id = p_phase_id;
  ELSIF EXISTS (SELECT 1 FROM public.phase_rounds r WHERE r.phase_id = p_phase_id) THEN
    RAISE EXCEPTION 'bracket_already_generated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.phase_rounds (id, phase_id, name, round_number, best_of, bracket_side, pairings_generated)
  SELECT r.id, p_phase_id, r.name, r.round_number, r.best_of, r.bracket_side, true
    FROM jsonb_to_recordset(p_rounds) AS r(id uuid, name text, round_number integer, best_of integer, bracket_side text);

  INSERT INTO public.phase_matches (id, round_id, phase_id, player_1_id, player_2_id, bracket_side, bracket_pos)
  SELECT m.id, m.round_id, p_phase_id, m.player_1_id, m.player_2_id, m.bracket_side, m.bracket_pos
    FROM jsonb_to_recordset(p_matches) AS m(
      id uuid, round_id uuid, player_1_id uuid, player_2_id uuid, bracket_side text, bracket_pos integer
    );

  PERFORM public.phase_enrollment_freeze(p_phase_id);

  UPDATE public.league_phases SET status = 'active', current_round = p_current_round WHERE id = p_phase_id AND status = p_expected_status;

  RETURN jsonb_build_object('rounds', jsonb_array_length(p_rounds), 'matches', jsonb_array_length(p_matches));
END $$;

CREATE OR REPLACE FUNCTION public.season_group__league_scheduled(p_season_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.rounds r JOIN public.tournaments t ON t.id = r.tournament_id WHERE t.season_id = p_season_id)
      OR EXISTS (SELECT 1 FROM public.phase_rounds r JOIN public.league_phases p ON p.id = r.phase_id WHERE p.season_id = p_season_id)
$$;

CREATE OR REPLACE FUNCTION public.phase_rounds__league_groups_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season uuid;
BEGIN
  PERFORM public.phase__lock(NEW.phase_id);
  SELECT t.season_id INTO v_season FROM public.league_phases t WHERE t.id = NEW.phase_id;
  IF v_season IS NULL OR NOT EXISTS (SELECT 1 FROM public.phase_groups g
                                       WHERE g.phase_id = NEW.phase_id AND g.season_group_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));

  IF EXISTS (SELECT 1 FROM public.phase_rounds r WHERE r.phase_id = NEW.phase_id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
       (SELECT m.player_id, g.season_group_id
          FROM public.phase_group_members m JOIN public.phase_groups g ON g.id = m.group_id
         WHERE g.phase_id = NEW.phase_id
        EXCEPT
        SELECT p.player_id, s.group_id
          FROM public.phase_participants p
          LEFT JOIN public.season_group_members s ON s.season_id = v_season AND s.player_id = p.player_id
         WHERE p.phase_id = NEW.phase_id)
       UNION ALL
       (SELECT p.player_id, s.group_id
          FROM public.phase_participants p
          LEFT JOIN public.season_group_members s ON s.season_id = v_season AND s.player_id = p.player_id
         WHERE p.phase_id = NEW.phase_id
        EXCEPT
        SELECT m.player_id, g.season_group_id
          FROM public.phase_group_members m JOIN public.phase_groups g ON g.id = m.group_id
         WHERE g.phase_id = NEW.phase_id)) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('phase_id', NEW.phase_id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_phase_rounds_league_groups_guard BEFORE INSERT ON public.phase_rounds FOR EACH ROW EXECUTE FUNCTION public.phase_rounds__league_groups_guard();

CREATE OR REPLACE FUNCTION public.phase_groups__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE id = OLD.phase_id) THEN RETURN OLD; END IF;
    PERFORM public.phase__lock(OLD.phase_id);
    RETURN OLD;
  END IF;
  v_season := public.phase__lock(NEW.phase_id);
  IF NEW.season_id <> v_season OR (NEW.season_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.season_groups WHERE id = NEW.season_group_id AND season_id = v_season
  )) THEN
    RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.phase_id <> OLD.phase_id THEN
    RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_phase_groups_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_groups
  FOR EACH ROW EXECUTE FUNCTION public.phase_groups__guard();

CREATE OR REPLACE FUNCTION public.phase_group_members__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE id = OLD.phase_id) THEN RETURN OLD; END IF;
    PERFORM public.phase__lock(OLD.phase_id);
    RETURN OLD;
  END IF;
  PERFORM public.phase__lock(NEW.phase_id);
  IF TG_OP = 'UPDATE' AND NEW.phase_id <> OLD.phase_id THEN
    RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_phase_group_members_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_group_members
  FOR EACH ROW EXECUTE FUNCTION public.phase_group_members__guard();

CREATE OR REPLACE FUNCTION public.phase_participants__lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE id = OLD.phase_id) THEN RETURN OLD; END IF;
    PERFORM public.phase__lock(OLD.phase_id);
    RETURN OLD;
  END IF;
  PERFORM public.phase__lock(NEW.phase_id);
  IF TG_OP = 'UPDATE' AND NEW.phase_id <> OLD.phase_id THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_phase_participants_lock BEFORE INSERT OR UPDATE OR DELETE ON public.phase_participants
  FOR EACH ROW EXECUTE FUNCTION public.phase_participants__lock();

CREATE OR REPLACE FUNCTION public.phase_participant_swap(p_phase_id uuid, p_out uuid, p_in uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_seed integer;
BEGIN
  IF p_out IS NULL OR p_in IS NULL OR p_out = p_in THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.phase__lock(p_phase_id);
  IF NOT EXISTS (SELECT 1 FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_out) THEN
    RETURN jsonb_build_object('swapped', false, 'seed', NULL);
  END IF;
  PERFORM public.phase_enrollment_freeze(p_phase_id);
  UPDATE public.phase_participants SET player_id = p_in
    WHERE phase_id = p_phase_id AND player_id = p_out RETURNING seed INTO v_seed;
  RETURN jsonb_build_object('swapped', FOUND, 'seed', v_seed);
END $$;

CREATE OR REPLACE FUNCTION public.phase_participants_replace(p_phase_id uuid, p_entries jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.phase__lock(p_phase_id);
  DELETE FROM public.phase_participants WHERE phase_id = p_phase_id;
  INSERT INTO public.phase_participants (phase_id, player_id, seed)
    SELECT p_phase_id, e.player_id, e.seed FROM jsonb_to_recordset(p_entries) AS e(player_id uuid, seed integer);
END $$;

CREATE OR REPLACE FUNCTION public.phase_participant_seeds(p_phase_id uuid, p_seeds jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_seed integer;
BEGIN
  IF p_seeds IS NULL OR jsonb_typeof(p_seeds) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_seeds) = 0 THEN RETURN; END IF;
  PERFORM public.phase__lock(p_phase_id);
  SELECT effective_seed INTO v_seed FROM (
    SELECT CASE WHEN e.player_id IS NULL THEN p.seed ELSE e.seed END AS effective_seed
      FROM public.phase_participants p LEFT JOIN (
        SELECT DISTINCT ON (player_id) player_id, seed
          FROM ROWS FROM (jsonb_to_recordset(p_seeds) AS (player_id uuid, seed integer))
            WITH ORDINALITY AS e(player_id, seed, ord)
         ORDER BY player_id, ord DESC
      ) e USING (player_id)
     WHERE p.phase_id = p_phase_id
  ) resulting WHERE effective_seed IS NOT NULL GROUP BY effective_seed HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SEED_CONFLICT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('seed', v_seed)::text;
  END IF;
  PERFORM public.phase_enrollment_freeze(p_phase_id);
  UPDATE public.phase_participants SET seed = NULL WHERE phase_id = p_phase_id
    AND player_id IN (SELECT e.player_id FROM jsonb_to_recordset(p_seeds) AS e(player_id uuid));
  UPDATE public.phase_participants p SET seed = e.seed, starting_bracket = coalesce(e.starting_bracket, p.starting_bracket)
    FROM (
      SELECT DISTINCT ON (player_id) player_id, seed, starting_bracket
        FROM ROWS FROM (jsonb_to_recordset(p_seeds) AS (player_id uuid, seed integer, starting_bracket text))
          WITH ORDINALITY AS e(player_id, seed, starting_bracket, ord)
       ORDER BY player_id, ord DESC
    ) e WHERE p.phase_id = p_phase_id AND p.player_id = e.player_id;
END $$;

CREATE OR REPLACE FUNCTION public.phase_stage_orders_shift(p_season_id uuid, p_from_order integer, p_delta integer) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  UPDATE public.league_phases SET stage_order = stage_order + p_delta WHERE season_id = p_season_id AND stage_order >= p_from_order;
END $$;

CREATE OR REPLACE FUNCTION public.phase_stage_orders_reorder(p_season_id uuid, p_phase_ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  UPDATE public.league_phases p SET stage_order = e.ord::integer
    FROM unnest(p_phase_ids) WITH ORDINALITY AS e(id, ord) WHERE p.season_id = p_season_id AND p.id = e.id;
END $$;

CREATE OR REPLACE FUNCTION public.phase_group_member_move(
  p_phase_id uuid, p_from_group uuid, p_to_group uuid, p_player_id uuid, p_seed integer
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  UPDATE public.phase_group_members SET group_id = p_to_group, seed = p_seed
    WHERE phase_id = p_phase_id AND group_id = p_from_group AND player_id = p_player_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_SLOT_CHANGED' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.phase_group_row_handover(
  p_phase_id uuid, p_group_id uuid, p_out uuid, p_in uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_held uuid[];
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  SELECT array_agg(group_id ORDER BY group_id) INTO v_held FROM public.phase_group_members
    WHERE phase_id = p_phase_id AND player_id = p_in;
  IF v_held IS NOT NULL THEN
    RETURN jsonb_build_object('written', false, 'reason', 'target_grouped', 'held_group_ids', to_jsonb(v_held));
  END IF;
  UPDATE public.phase_group_members SET player_id = p_in
    WHERE phase_id = p_phase_id AND group_id = p_group_id AND player_id = p_out;
  IF NOT FOUND THEN RETURN jsonb_build_object('written', false, 'reason', 'row_gone'); END IF;
  RETURN jsonb_build_object('written', true, 'held_group_ids', jsonb_build_array(p_group_id));
END $$;

CREATE OR REPLACE FUNCTION public.phase_group_member_swap(p_phase_id uuid, p_out uuid, p_in uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_slot record; v_written boolean := false;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  SELECT m.*, g.name, g.group_number, g.season_group_id INTO v_slot
    FROM public.phase_group_members m JOIN public.phase_groups g ON g.id = m.group_id
    WHERE m.phase_id = p_phase_id AND m.player_id = p_out;
  IF FOUND THEN
    DELETE FROM public.phase_group_members WHERE phase_id = p_phase_id AND player_id = p_in;
    UPDATE public.phase_group_members SET player_id = p_in
      WHERE phase_id = p_phase_id AND group_id = v_slot.group_id AND player_id = p_out;
    IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_SLOT_CHANGED' USING ERRCODE = 'P0001'; END IF;
    v_written := true;
  ELSE
    SELECT m.*, g.name, g.group_number, g.season_group_id INTO v_slot
      FROM public.phase_group_members m JOIN public.phase_groups g ON g.id = m.group_id
      WHERE m.phase_id = p_phase_id AND m.player_id = p_in;
    IF NOT FOUND THEN RETURN jsonb_build_object('written', false, 'held', NULL); END IF;
  END IF;
  RETURN jsonb_build_object('written', v_written, 'held', jsonb_build_object(
    'group_id', v_slot.group_id, 'group_name', v_slot.name, 'group_number', v_slot.group_number,
    'season_group_id', v_slot.season_group_id, 'player_id', p_in, 'seed', v_slot.seed));
END $$;
REVOKE ALL ON FUNCTION public.phase__lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase__lock(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_enrollment_replace(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_enrollment_replace(uuid, jsonb, jsonb, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.phase_enrollment_freeze(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_enrollment_freeze(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_round_write(uuid, uuid, text, integer, integer, uuid[], jsonb, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_write(uuid, uuid, text, integer, integer, uuid[], jsonb, bigint, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.phase_round_complete(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_complete(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.league_phase_complete_at_stage_end(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_phase_complete_at_stage_end(uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.phase_round_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_delete(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_bracket_write(uuid, public.phase_status, boolean, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_bracket_write(uuid, public.phase_status, boolean, jsonb, jsonb, integer) TO service_role;
REVOKE ALL ON FUNCTION public.season_group__league_scheduled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.season_group__league_scheduled(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_rounds__league_groups_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_rounds__league_groups_guard() TO service_role;
REVOKE ALL ON FUNCTION public.phase_groups__guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_groups__guard() TO service_role;
REVOKE ALL ON FUNCTION public.phase_group_members__guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_members__guard() TO service_role;
REVOKE ALL ON FUNCTION public.phase_participants__lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participants__lock() TO service_role;
REVOKE ALL ON FUNCTION public.phase_participant_swap(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participant_swap(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_participants_replace(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participants_replace(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.phase_participant_seeds(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participant_seeds(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.phase_stage_orders_shift(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_stage_orders_shift(uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.phase_stage_orders_reorder(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_stage_orders_reorder(uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.phase_group_member_move(uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_member_move(uuid, uuid, uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.phase_group_row_handover(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_row_handover(uuid, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.phase_group_member_swap(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_member_swap(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.phase_group_write(p_phase_id uuid, p_operation text, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season uuid; v_result jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR p_operation IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;
  v_season := public.phase__lock(p_phase_id);
  IF p_operation = 'create' THEN
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS e(phase_id uuid, season_id uuid)
      WHERE e.phase_id IS DISTINCT FROM p_phase_id OR e.season_id IS DISTINCT FROM v_season) THEN
      RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
    END IF;
    WITH inserted AS (
      INSERT INTO public.phase_groups (phase_id, season_id, name, group_number, season_group_id)
        SELECT p_phase_id, v_season, e.name, e.group_number, e.season_group_id
          FROM jsonb_to_recordset(p_rows) AS e(name text, group_number integer, season_group_id uuid)
        RETURNING *
    ) SELECT coalesce(jsonb_agg(to_jsonb(inserted) ORDER BY group_number, id), '[]'::jsonb) INTO v_result FROM inserted;
  ELSIF p_operation = 'update' THEN
    WITH updated AS (
      UPDATE public.phase_groups g SET name = e.name FROM jsonb_to_recordset(p_rows) AS e(id uuid, name text)
        WHERE g.phase_id = p_phase_id AND g.id = e.id RETURNING g.*
    ) SELECT coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb) INTO v_result FROM updated;
  ELSIF p_operation = 'delete' THEN
    DELETE FROM public.phase_groups WHERE phase_id = p_phase_id
      AND id IN (SELECT e.id FROM jsonb_to_recordset(p_rows) AS e(id uuid));
  ELSIF p_operation = 'delete_all' THEN
    DELETE FROM public.phase_groups WHERE phase_id = p_phase_id;
  ELSIF p_operation = 'add_members' THEN
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS e(phase_id uuid) WHERE e.phase_id IS DISTINCT FROM p_phase_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.phase_group_members (phase_id, group_id, player_id, seed)
      SELECT p_phase_id, e.group_id, e.player_id, e.seed
        FROM jsonb_to_recordset(p_rows) AS e(group_id uuid, player_id uuid, seed integer);
  ELSIF p_operation = 'remove_member' THEN
    DELETE FROM public.phase_group_members m USING jsonb_to_recordset(p_rows) AS e(group_id uuid, player_id uuid)
      WHERE m.phase_id = p_phase_id AND m.group_id = e.group_id AND m.player_id = e.player_id;
  ELSE
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(v_result, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.phase_participant_edit(p_phase_id uuid, p_player_id uuid, p_add boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_add IS NULL THEN RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.phase__lock(p_phase_id);
  IF p_add THEN
    INSERT INTO public.phase_participants (phase_id, player_id) VALUES (p_phase_id, p_player_id);
  ELSE
    DELETE FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_player_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.phase_group_write(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_write(uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) TO service_role;

CREATE TRIGGER trg_league_phases_updated BEFORE UPDATE ON public.league_phases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_phase_rounds_updated BEFORE UPDATE ON public.phase_rounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_phase_groups_updated BEFORE UPDATE ON public.phase_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMIT;
