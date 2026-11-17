BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.team_global_share_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_token uuid; v_other uuid;
BEGIN
  FOR v_token IN
    SELECT DISTINCT t FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.share_token END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.share_token END
    ]) x(t) WHERE t IS NOT NULL ORDER BY t
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_token::text, 419004));
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.share_token IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'teams' THEN
    SELECT id INTO v_other FROM public.phase_teams WHERE share_token = NEW.share_token;
  ELSE
    SELECT id INTO v_other FROM public.teams WHERE share_token = NEW.share_token;
  END IF;
  IF v_other IS NOT NULL AND v_other <> NEW.id THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "teams_global_share_token_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'teams_global_share_token_key';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.team_global_share_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.share_token IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.teams t JOIN public.phase_teams p ON p.share_token = t.share_token
    WHERE t.share_token = NEW.share_token
  ) THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "teams_global_share_token_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'teams_global_share_token_key';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_teams_global_share_lock BEFORE INSERT OR UPDATE OF share_token, id OR DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.team_global_share_lock();
CREATE TRIGGER trg_phase_teams_global_share_lock BEFORE INSERT OR UPDATE OF share_token, id OR DELETE ON public.phase_teams
FOR EACH ROW EXECUTE FUNCTION public.team_global_share_lock();
CREATE CONSTRAINT TRIGGER trg_teams_global_share_check AFTER INSERT OR UPDATE OF share_token, id ON public.teams
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.team_global_share_check();
CREATE CONSTRAINT TRIGGER trg_phase_teams_global_share_check AFTER INSERT OR UPDATE OF share_token, id ON public.phase_teams
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.team_global_share_check();

CREATE FUNCTION public.phase_teams_completed_match_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_status public.match_status;
BEGIN
  IF OLD.match_id IS NULL THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.pokemon IS NOT DISTINCT FROM OLD.pokemon
     AND NEW.import_source IS NOT DISTINCT FROM OLD.import_source
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.player_id IS NOT DISTINCT FROM OLD.player_id
     AND NEW.phase_id IS NOT DISTINCT FROM OLD.phase_id
     AND NEW.season_id IS NOT DISTINCT FROM OLD.season_id THEN
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() > 1 OR current_setting('poketools.phase_team_correction', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO v_status FROM public.phase_matches WHERE id = OLD.match_id FOR SHARE;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'TEAM_MATCH_COMPLETED' USING ERRCODE = 'P0001'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_phase_teams_completed_match_lock BEFORE UPDATE OR DELETE ON public.phase_teams
FOR EACH ROW EXECUTE FUNCTION public.phase_teams_completed_match_lock();
CREATE TRIGGER trg_phase_teams_updated BEFORE UPDATE ON public.phase_teams
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_phase_match_prep_teams_updated BEFORE UPDATE ON public.phase_match_prep_teams
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE FUNCTION public.phase_team_roster_write(
  p_operation text, p_phase_id uuid, p_player_id uuid, p_team_id uuid DEFAULT NULL,
  p_match_id uuid DEFAULT NULL, p_pokemon jsonb DEFAULT '[]',
  p_import_source public.team_import_source DEFAULT 'manual', p_name text DEFAULT NULL,
  p_actor text DEFAULT 'owner'
) RETURNS SETOF public.phase_teams LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_phase public.league_phases; v_season public.seasons; v_match public.phase_matches;
  v_team public.phase_teams; v_closure text; v_flag text; v_season_id uuid;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_operation NOT IN ('create', 'edit', 'delete', 'match_prep') OR p_operation IS NULL
     OR p_actor NOT IN ('owner', 'participant', 'admin') OR p_actor IS NULL
     OR p_phase_id IS NULL OR p_player_id IS NULL
     OR p_pokemon IS NULL OR jsonb_typeof(p_pokemon) <> 'array' OR p_import_source IS NULL
     OR (p_operation IN ('edit', 'delete') AND p_team_id IS NULL)
     OR (p_operation = 'match_prep' AND p_match_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001';
  END IF;
  SELECT season_id INTO v_season_id FROM public.league_phases WHERE id = p_phase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'phase_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_season_id::text));
  SELECT * INTO STRICT v_season FROM public.seasons WHERE id = v_season_id FOR SHARE;
  SELECT * INTO v_phase FROM public.league_phases WHERE id = p_phase_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'phase_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_operation IN ('edit', 'delete') THEN
    SELECT * INTO v_team FROM public.phase_teams
      WHERE id = p_team_id AND phase_id = p_phase_id AND player_id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'team_changed' USING ERRCODE = 'P0001'; END IF;
  ELSIF p_operation = 'match_prep' THEN
    SELECT * INTO v_team FROM public.phase_teams
      WHERE phase_id = p_phase_id AND player_id = p_player_id AND match_id = p_match_id FOR UPDATE;
  END IF;
  IF coalesce(v_team.match_id, p_match_id) IS NOT NULL THEN
    SELECT * INTO v_match FROM public.phase_matches
      WHERE id = coalesce(v_team.match_id, p_match_id) AND phase_id = p_phase_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF p_operation = 'match_prep' AND p_player_id NOT IN (v_match.player_1_id, v_match.player_2_id) THEN
    RAISE EXCEPTION 'match_prep_target_not_participant' USING ERRCODE = 'P0001';
  END IF;
  IF v_team.locked AND p_operation <> 'match_prep' AND (p_operation <> 'delete' OR p_actor <> 'admin') THEN
    RAISE EXCEPTION 'team_locked' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase.status = 'completed' THEN v_closure := 'team_submission_closed';
  ELSIF v_phase.archived THEN v_closure := 'team_submission_tournament_archived';
  ELSIF v_season.status = 'completed' OR v_season.archived THEN v_closure := 'team_submission_league_closed'; END IF;
  IF p_operation = 'create' AND v_phase.status = 'completed' THEN
    RAISE EXCEPTION 'team_submission_closed' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor <> 'admin' THEN
    IF v_closure IS NOT NULL AND p_operation <> 'match_prep'
       AND NOT (p_operation = 'delete' AND v_team.match_id IS NULL) THEN
      RAISE EXCEPTION '%', v_closure USING ERRCODE = 'P0001';
    END IF;
    IF v_match.status = 'completed' THEN RAISE EXCEPTION 'TEAM_MATCH_COMPLETED' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF p_operation = 'create' AND p_actor <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_player_id
  ) THEN RAISE EXCEPTION 'team_not_tournament_participant' USING ERRCODE = 'P0001'; END IF;
  IF p_operation = 'match_prep' AND v_team.locked THEN
    INSERT INTO public.phase_match_prep_teams (match_id, player_id, pokemon, import_source)
      VALUES (p_match_id, p_player_id, p_pokemon, p_import_source)
      ON CONFLICT (match_id, player_id) DO UPDATE SET pokemon = EXCLUDED.pokemon, import_source = EXCLUDED.import_source;
    RETURN;
  END IF;
  v_flag := current_setting('poketools.phase_team_correction', true);
  IF p_actor = 'admin' THEN PERFORM set_config('poketools.phase_team_correction', 'on', true); END IF;
  IF p_operation = 'delete' THEN
    DELETE FROM public.phase_teams WHERE id = v_team.id RETURNING * INTO v_team;
  ELSIF v_team.id IS NOT NULL THEN
    UPDATE public.phase_teams SET pokemon = p_pokemon, import_source = p_import_source, name = coalesce(p_name, name)
      WHERE id = v_team.id AND locked = v_team.locked RETURNING * INTO v_team;
  ELSE
    IF p_operation = 'create' AND EXISTS (
      SELECT 1 FROM public.phase_teams WHERE phase_id = p_phase_id AND player_id = p_player_id AND match_id IS NULL
    ) THEN RAISE EXCEPTION 'team_already_submitted' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.phase_teams (phase_id, season_id, player_id, match_id, pokemon, import_source, name)
      VALUES (p_phase_id, v_phase.season_id, p_player_id, CASE WHEN p_operation = 'match_prep' THEN p_match_id END,
        p_pokemon, p_import_source, coalesce(p_name, '')) RETURNING * INTO v_team;
  END IF;
  IF p_operation = 'match_prep' THEN
    INSERT INTO public.phase_match_prep_teams (match_id, player_id, pokemon, import_source)
      VALUES (p_match_id, p_player_id, p_pokemon, p_import_source)
      ON CONFLICT (match_id, player_id) DO UPDATE SET pokemon = EXCLUDED.pokemon, import_source = EXCLUDED.import_source;
  END IF;
  PERFORM set_config('poketools.phase_team_correction', coalesce(v_flag, 'off'), true);
  RETURN NEXT v_team;
END $$;

CREATE FUNCTION public.phase_teams_release_matches(p_match_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_match uuid; v_row public.phase_teams; v_count integer := 0; v_season uuid;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_match_ids IS NULL OR array_position(p_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001';
  END IF;
  FOR v_season IN SELECT DISTINCT p.season_id FROM public.league_phases p
    JOIN public.phase_matches m ON m.phase_id = p.id WHERE m.id = ANY(p_match_ids) ORDER BY p.season_id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_season::text));
    PERFORM id FROM public.seasons WHERE id = v_season FOR KEY SHARE;
  END LOOP;
  PERFORM id FROM public.league_phases WHERE id IN (
    SELECT phase_id FROM public.phase_matches WHERE id = ANY(p_match_ids)
  ) ORDER BY id FOR NO KEY UPDATE;
  FOREACH v_match IN ARRAY p_match_ids LOOP
    FOR v_row IN SELECT * FROM public.phase_teams WHERE match_id = v_match ORDER BY created_at, id FOR UPDATE LOOP
      UPDATE public.phase_teams SET match_id = NULL WHERE id = v_row.id;
      IF EXISTS (SELECT 1 FROM public.phase_teams
        WHERE phase_id = v_row.phase_id AND player_id = v_row.player_id AND match_id IS NULL AND id <> v_row.id) THEN
        INSERT INTO public.teams (id, player_id, name, season_id, pokemon, import_source, locked,
          draft_pool_id, is_draft_team, created_at, updated_at, share_token, share_enabled_at,
          library_published_at, library_title, library_description, library_tags,
          forked_from_team_id, forked_from_phase_team_id)
        VALUES (v_row.id, v_row.player_id, v_row.name, v_row.season_id, v_row.pokemon, v_row.import_source, v_row.locked,
          v_row.draft_pool_id, v_row.is_draft_team, v_row.created_at, v_row.updated_at, v_row.share_token, v_row.share_enabled_at,
          v_row.library_published_at, v_row.library_title, v_row.library_description, v_row.library_tags,
          v_row.forked_from_team_id, v_row.forked_from_phase_team_id);
        UPDATE public.teams SET forked_from_phase_team_id = NULL, forked_from_team_id = v_row.id
          WHERE forked_from_phase_team_id = v_row.id;
        UPDATE public.phase_teams SET forked_from_phase_team_id = NULL, forked_from_team_id = v_row.id
          WHERE forked_from_phase_team_id = v_row.id;
        DELETE FROM public.phase_teams WHERE id = v_row.id AND match_id IS NULL;
      END IF;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.team_global_share_lock(), public.team_global_share_check(),
  public.phase_teams_completed_match_lock(), public.phase_teams_release_matches(uuid[]),
  public.phase_team_roster_write(text, uuid, uuid, uuid, uuid, jsonb, public.team_import_source, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_global_share_lock(), public.team_global_share_check(),
  public.phase_teams_completed_match_lock(), public.phase_teams_release_matches(uuid[]),
  public.phase_team_roster_write(text, uuid, uuid, uuid, uuid, jsonb, public.team_import_source, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.league_trash__insert_guards()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'draft_pools.trg_draft_pools_guard_group',
    'evolution_tracker.trg_evolution_tracker_group',
    'format_challenges.trg_format_challenges_notify',
    'format_challenges.trg_phase_storage_pointer_guard',
    'games.trg_games_global_replay_check',
    'games.trg_games_global_replay_lock',
    'league_phases.trg_phase_storage_guard',
    'phase_admins.trg_phase_storage_guard',
    'phase_battle_stats.trg_phase_storage_guard',
    'phase_broadcast_moments.trg_phase_storage_guard',
    'phase_cast_sessions.trg_phase_storage_guard',
    'phase_discord_webhooks.trg_phase_storage_guard',
    'phase_epb_animation_views.trg_phase_storage_guard',
    'phase_games.trg_phase_games_global_replay_check',
    'phase_games.trg_phase_games_global_replay_lock',
    'phase_games.trg_phase_storage_guard',
    'phase_group_members.trg_phase_group_members_guard',
    'phase_group_members.trg_phase_storage_guard',
    'phase_groups.trg_phase_groups_guard',
    'phase_groups.trg_phase_storage_guard',
    'phase_match_analyses.trg_phase_storage_guard',
    'phase_match_evolution_snapshots.trg_phase_storage_guard',
    'phase_match_outcomes.trg_phase_storage_guard',
    'phase_match_prep_analyses.trg_phase_storage_guard',
    'phase_match_prep_teams.trg_phase_storage_guard',
    'phase_match_proposals.trg_phase_storage_guard',
    'phase_matches.trg_phase_storage_guard',
    'phase_participants.trg_phase_participants_lock',
    'phase_participants.trg_phase_storage_guard',
    'phase_reports.trg_phase_storage_guard',
    'phase_rounds.trg_phase_rounds_league_groups_guard',
    'phase_rounds.trg_phase_storage_guard',
    'phase_social_integrations.trg_phase_storage_guard',
    'phase_teams.trg_phase_storage_guard',
    'phase_teams.trg_phase_teams_global_share_lock',
    'phase_teams.trg_phase_teams_global_share_check',
    'phase_wiki_note_reports.trg_phase_storage_guard',
    'phase_wiki_notes.trg_phase_storage_guard',
    'rounds.trg_rounds_league_groups_guard',
    'season_formats.trg_season_formats_revision',
    'season_group_members.trg_season_group_members_guard',
    'season_groups.trg_season_groups_guard',
    'season_participants.trg_season_participants_group_guard',
    'teams.trg_phase_storage_pointer_guard',
    'teams.trg_teams_global_share_lock',
    'teams.trg_teams_global_share_check',
    'tournament_groups.trg_tournament_groups_guard_season_group'
  ]::text[];
$$;
REVOKE ALL ON FUNCTION public.league_trash__insert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__insert_guards() TO service_role;
COMMIT;
