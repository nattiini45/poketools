BEGIN;

CREATE FUNCTION public.game_global_replay_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_hash text; v_other_id uuid;
BEGIN
  FOR v_hash IN
    SELECT DISTINCT h FROM unnest(ARRAY[NEW.replay_hash,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.replay_hash ELSE NULL END]) AS x(h)
    WHERE h IS NOT NULL ORDER BY h
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash, 442617));
  END LOOP;
  IF NEW.replay_hash IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'games' THEN
    SELECT id INTO v_other_id FROM public.phase_games WHERE replay_hash = NEW.replay_hash;
  ELSE
    SELECT id INTO v_other_id FROM public.games WHERE replay_hash = NEW.replay_hash;
  END IF;
  IF v_other_id IS NOT NULL AND v_other_id <> NEW.id THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "games_global_replay_hash_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'games_global_replay_hash_key';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.game_global_replay_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.replay_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.phase_games p ON p.replay_hash = g.replay_hash
    WHERE g.replay_hash = NEW.replay_hash
  ) THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "games_global_replay_hash_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'games_global_replay_hash_key';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_games_global_replay_lock
BEFORE INSERT OR UPDATE OF replay_hash, id ON public.games
FOR EACH ROW EXECUTE FUNCTION public.game_global_replay_lock();
CREATE TRIGGER trg_phase_games_global_replay_lock
BEFORE INSERT OR UPDATE OF replay_hash, id ON public.phase_games
FOR EACH ROW EXECUTE FUNCTION public.game_global_replay_lock();
CREATE CONSTRAINT TRIGGER trg_games_global_replay_check
AFTER INSERT OR UPDATE OF replay_hash, id ON public.games
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.game_global_replay_check();
CREATE CONSTRAINT TRIGGER trg_phase_games_global_replay_check
AFTER INSERT OR UPDATE OF replay_hash, id ON public.phase_games
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.game_global_replay_check();

REVOKE ALL ON FUNCTION public.game_global_replay_lock(), public.game_global_replay_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_global_replay_lock(), public.game_global_replay_check() TO service_role;

CREATE TRIGGER trg_phase_games_updated BEFORE UPDATE ON public.phase_games
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_phase_matches_updated BEFORE UPDATE ON public.phase_matches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE OR REPLACE FUNCTION public.claim_phase_game_edit_lease(
  p_game_id uuid,
  p_expected_updated_at timestamptz,
  p_token uuid,
  p_ttl_seconds integer
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lease_until timestamptz;
BEGIN
  IF p_game_id IS NULL OR p_expected_updated_at IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'claim_phase_game_edit_lease: game id, expected version and token are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'claim_phase_game_edit_lease: ttl must be between 1 and 900 seconds (got %)', p_ttl_seconds
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.phase_games
     SET edit_lease_token = p_token,
         edit_lease_until = now() + make_interval(secs => p_ttl_seconds)
   WHERE id = p_game_id
     AND updated_at = p_expected_updated_at
     AND (edit_lease_until IS NULL OR edit_lease_until <= now());
  IF FOUND THEN
    RETURN 'claimed';
  END IF;

  SELECT edit_lease_until INTO v_lease_until FROM public.phase_games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_lease_until IS NOT NULL AND v_lease_until > now() THEN
    RETURN 'leased';
  END IF;
  RETURN 'stale';
END;
$$;

COMMENT ON FUNCTION public.claim_phase_game_edit_lease(uuid, timestamptz, uuid, integer) IS
  'Claim the admin edit lease of one game together with the editor''s version (updated_at) in one conditional UPDATE. Returns claimed | leased | stale | missing. Service-role only.';

CREATE OR REPLACE FUNCTION public.release_phase_game_edit_lease(p_game_id uuid, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_game_id IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'release_phase_game_edit_lease: game id and token are required' USING ERRCODE = '22004';
  END IF;

  UPDATE public.phase_games
     SET edit_lease_token = NULL,
         edit_lease_until = NULL
   WHERE id = p_game_id
     AND edit_lease_token = p_token;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_phase_game_edit_lease(uuid, uuid) IS
  'Release the admin edit lease of one game while it still carries p_token. Returns false when the token no longer holds the game. Service-role only.';

REVOKE ALL ON FUNCTION
  public.claim_phase_game_edit_lease(uuid, timestamptz, uuid, integer),
  public.release_phase_game_edit_lease(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.claim_phase_game_edit_lease(uuid, timestamptz, uuid, integer),
  public.release_phase_game_edit_lease(uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.phase_match_outcome_record(
  p_match_id  uuid,
  p_kind      text,
  p_source    text,
  p_force     boolean,
  p_p1_faints smallint DEFAULT NULL,
  p_p2_faints smallint DEFAULT NULL,
  p_reason    text DEFAULT NULL,
  p_set_by    uuid DEFAULT NULL,
  p_open_only boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_rows integer;
BEGIN
  IF p_open_only THEN
    PERFORM 1 FROM public.phase_matches m WHERE m.id = p_match_id AND m.status <> 'completed' FOR SHARE;
    IF NOT FOUND THEN RETURN 'kept'; END IF;
  END IF;

  IF p_force THEN
    INSERT INTO public.phase_match_outcomes AS o (match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at)
    VALUES (p_match_id, p_kind, p_p1_faints, p_p2_faints, p_source, p_reason, p_set_by, now())
    ON CONFLICT (match_id) DO UPDATE
      SET kind = EXCLUDED.kind, p1_faints = EXCLUDED.p1_faints, p2_faints = EXCLUDED.p2_faints,
          source = EXCLUDED.source, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
    RETURN 'written';
  END IF;

  INSERT INTO public.phase_match_outcomes AS o (match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at)
  VALUES (p_match_id, p_kind, p_p1_faints, p_p2_faints, p_source, p_reason, p_set_by, now())
  ON CONFLICT (match_id) DO UPDATE
    SET kind = EXCLUDED.kind, p1_faints = EXCLUDED.p1_faints, p2_faints = EXCLUDED.p2_faints,
        source = EXCLUDED.source, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at
    WHERE o.source <> 'admin';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN CASE WHEN v_rows > 0 THEN 'written' ELSE 'kept' END;
END $$;
REVOKE ALL ON FUNCTION public.phase_match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.phase_match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) IS
  'The only writer of match_outcomes. p_force=false (finalize, replay engine) never replaces an admin row; p_force=true (admin) always writes; p_open_only=true writes only while the match is not completed (checked inside this call, not atomic with a later status update). Returns written | kept.';

CREATE OR REPLACE FUNCTION public.phase_epb_replace_match_snapshots(
  p_match_id uuid,
  p_snapshots jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required';
  END IF;

  PERFORM 1 FROM public.phase_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'phase match missing' USING ERRCODE = '23503'; END IF;

  DELETE FROM public.phase_match_evolution_snapshots
  WHERE match_id = p_match_id;

  IF p_snapshots IS NULL OR jsonb_typeof(p_snapshots) <> 'array' THEN
    RAISE EXCEPTION 'p_snapshots must be a JSON array';
  END IF;

  IF jsonb_array_length(p_snapshots) = 0 THEN
    RETURN;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
    INSERT INTO public.phase_match_evolution_snapshots (
      match_id,
      player_id,
      tracker_id,
      base_pokemon,
      line_id,
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
      NULLIF(v_row->>'line_id', ''),
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

COMMENT ON FUNCTION public.phase_epb_replace_match_snapshots(uuid, jsonb) IS
  'Atomically replace all match_evolution_snapshots for a match (single transaction). Rows carry line_id (branch-exact). Service-role only.';

GRANT EXECUTE ON FUNCTION public.phase_epb_replace_match_snapshots(uuid, jsonb) TO service_role;


REVOKE ALL ON FUNCTION public.phase_epb_replace_match_snapshots(uuid, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
