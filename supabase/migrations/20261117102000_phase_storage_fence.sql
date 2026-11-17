BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.phase_storage_state (
  id boolean DEFAULT true PRIMARY KEY CHECK (id),
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy', 'frozen_legacy', 'frozen_phase', 'phase'))
);
ALTER TABLE public.phase_storage_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase_storage_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.phase_storage_state TO service_role;
INSERT INTO public.phase_storage_state (id) VALUES (true);

CREATE OR REPLACE FUNCTION public.phase_storage_transition(expected_mode text, target_mode text)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  SELECT mode INTO v_mode FROM public.phase_storage_state WHERE id FOR UPDATE;
  IF v_mode IS DISTINCT FROM expected_mode THEN
    RAISE EXCEPTION 'phase_storage_changed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (
    (expected_mode = 'legacy' AND target_mode = 'frozen_legacy')
    OR (expected_mode = 'frozen_legacy' AND target_mode IN ('legacy', 'frozen_phase'))
    OR (expected_mode = 'frozen_phase' AND target_mode IN ('frozen_legacy', 'phase'))
    OR (expected_mode = 'phase' AND target_mode = 'frozen_phase')
  ) THEN
    RAISE EXCEPTION 'phase_storage_transition_invalid' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.phase_storage_state SET mode = target_mode WHERE id AND mode = expected_mode;
  RETURN target_mode;
END $$;
REVOKE ALL ON FUNCTION public.phase_storage_transition(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.phase_storage__guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  IF current_user <> 'postgres' THEN
    SELECT mode INTO v_mode FROM public.phase_storage_state WHERE id FOR SHARE;
    IF v_mode IS DISTINCT FROM 'phase' THEN
      RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phase_storage__guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_storage__guard() TO service_role;

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.league_phases
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_participants
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_groups
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_group_members
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_rounds
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_reports
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_matches
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_outcomes
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_games
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_battle_stats
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_analyses
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_prep_analyses
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_prep_teams
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_proposals
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_match_evolution_snapshots
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_epb_animation_views
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_broadcast_moments
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_teams
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_cast_sessions
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_admins
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_discord_webhooks
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_social_integrations
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_wiki_notes
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_wiki_note_reports
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_aggregates
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_player_aggregates
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_aggregate_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.phase_rating_history
FOR EACH ROW EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_pointer_guard BEFORE INSERT OR UPDATE ON public.player_streaks
FOR EACH ROW WHEN (NEW.last_phase_match_id IS NOT NULL)
EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_pointer_guard BEFORE INSERT OR UPDATE ON public.agent_suggestions
FOR EACH ROW WHEN (NEW.phase_match_id IS NOT NULL)
EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_pointer_guard BEFORE INSERT OR UPDATE ON public.teams
FOR EACH ROW WHEN (NEW.phase_match_id IS NOT NULL OR NEW.forked_from_phase_team_id IS NOT NULL)
EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_pointer_guard BEFORE INSERT OR UPDATE ON public.cast_sessions
FOR EACH ROW WHEN (NEW.phase_id IS NOT NULL OR NEW.phase_match_id IS NOT NULL)
EXECUTE FUNCTION public.phase_storage__guard();

CREATE TRIGGER trg_phase_storage_pointer_guard BEFORE INSERT OR UPDATE ON public.format_challenges
FOR EACH ROW WHEN (NEW.league_phase_id IS NOT NULL OR NEW.phase_match_id IS NOT NULL)
EXECUTE FUNCTION public.phase_storage__guard();

COMMIT;
