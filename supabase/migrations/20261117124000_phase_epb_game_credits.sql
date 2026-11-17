BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_epb_credit_game_kills(p_game_id uuid, p_credits jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_applied_at timestamptz;
  v_status match_status;
  v_player_1 uuid;
  v_player_2 uuid;
  v_season uuid;
  v_matchday integer;
  v_entry jsonb;
  v_tracker uuid;
  v_amount integer;
  v_owner uuid;
  v_tracker_season uuid;
  v_ledger jsonb;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'phase_epb_credit_game_kills: game id is required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_credits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'phase_epb_credit_game_kills: credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_credits))
     <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(p_credits) e) THEN
    RAISE EXCEPTION 'phase_epb_credit_game_kills: a tracker is listed more than once' USING ERRCODE = '22023';
  END IF;

  -- 0. Season fence first (lock order: epochs row, game row, trackers).
  SELECT t.season_id INTO v_season
    FROM phase_games g JOIN phase_matches m ON m.id = g.match_id JOIN league_phases t ON t.id = m.phase_id
   WHERE g.id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  PERFORM epb__lock_kill_credit_epoch(v_season);
  PERFORM 1 FROM phase_matches m JOIN phase_games g ON g.match_id = m.id
    WHERE g.id = p_game_id FOR SHARE OF m;

  -- 1. Game row lock: two credits of one game serialise here, and the second sees the first one's marker.
  SELECT evolution_applied_at INTO v_applied_at FROM phase_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RETURN 'already_applied';
  END IF;

  -- 2. Only a completed match's phase_games are credited (owner decision on CF-07).
  SELECT m.status, m.player_1_id, m.player_2_id, r.round_number
    INTO v_status, v_player_1, v_player_2, v_matchday
    FROM phase_games g
    JOIN phase_matches m ON m.id = g.match_id
    LEFT JOIN phase_rounds r ON r.id = m.round_id
   WHERE g.id = p_game_id;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RETURN 'match_not_completed';
  END IF;

  -- 3. Credits, in tracker id order: each tracker must belong to one of the match's players in the match's season.
  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_credits) e ORDER BY e->>'tracker_id'
  LOOP
    v_tracker := (v_entry->>'tracker_id')::uuid;
    v_amount := (v_entry->>'amount')::integer;
    IF v_tracker IS NULL OR v_amount IS NULL OR v_amount < 1 THEN
      RAISE EXCEPTION 'phase_epb_credit_game_kills: every credit needs a tracker id and a positive amount (got %)', v_entry
        USING ERRCODE = '22023';
    END IF;
    SELECT player_id, season_id INTO v_owner, v_tracker_season FROM evolution_tracker WHERE id = v_tracker;
    IF NOT FOUND OR v_tracker_season IS DISTINCT FROM v_season
       OR (v_owner IS DISTINCT FROM v_player_1 AND v_owner IS DISTINCT FROM v_player_2) THEN
      RAISE EXCEPTION 'phase_epb_credit_game_kills: tracker % is not a tracker of this match''s players in its season', v_tracker
        USING ERRCODE = '22023';
    END IF;
    PERFORM epb_apply_progress(v_tracker, 'real_kill', v_amount, v_matchday, 'KO from battle', NULL);
  END LOOP;

  -- 4. Marker + ledger (what was just credited), and the season counter, in the same transaction as the credits.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tracker_id', (e->>'tracker_id')::uuid, 'amount', (e->>'amount')::integer)
                            ORDER BY (e->>'tracker_id')::uuid), '[]'::jsonb)
    INTO v_ledger
    FROM jsonb_array_elements(p_credits) e;
  UPDATE phase_games SET evolution_applied_at = now(), evolution_credits = v_ledger WHERE id = p_game_id;
  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = v_season;
  RETURN 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION public.phase_epb_uncredit_game_kills(
  p_game_id uuid,
  p_expected_applied_at timestamptz,
  p_debits jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_applied_at timestamptz;
  v_ledger jsonb;
  v_player_1 uuid;
  v_player_2 uuid;
  v_season uuid;
  v_matchday integer;
  v_entry jsonb;
  v_tracker uuid;
  v_amount integer;
  v_owner uuid;
  v_tracker_season uuid;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_game_id IS NULL OR p_expected_applied_at IS NULL THEN
    RAISE EXCEPTION 'phase_epb_uncredit_game_kills: game id and expected marker are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_debits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'phase_epb_uncredit_game_kills: debits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_debits))
     <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(p_debits) e) THEN
    RAISE EXCEPTION 'phase_epb_uncredit_game_kills: a tracker is listed more than once' USING ERRCODE = '22023';
  END IF;

  SELECT m.player_1_id, m.player_2_id, t.season_id, r.round_number
    INTO v_player_1, v_player_2, v_season, v_matchday
    FROM phase_games g
    JOIN phase_matches m ON m.id = g.match_id
    JOIN league_phases t ON t.id = m.phase_id
    LEFT JOIN phase_rounds r ON r.id = m.round_id
   WHERE g.id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  PERFORM epb__lock_kill_credit_epoch(v_season);

  SELECT evolution_applied_at, evolution_credits INTO v_applied_at, v_ledger FROM phase_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NULL THEN
    RETURN 'not_applied';
  END IF;
  IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN
    RETURN 'marker_changed';
  END IF;

  IF v_ledger IS NOT NULL THEN
    -- Exactly what was credited, to the trackers that got it. A tracker retired since (redraft / trade) is skipped:
    -- its kills were carried into the replacement's transferred_evo_progress, a snapshot the rebuild preserves too.
    FOR v_entry IN SELECT e FROM jsonb_array_elements(v_ledger) e ORDER BY e->>'tracker_id'
    LOOP
      v_tracker := (v_entry->>'tracker_id')::uuid;
      v_amount := (v_entry->>'amount')::integer;
      IF EXISTS (SELECT 1 FROM evolution_tracker WHERE id = v_tracker) THEN
        PERFORM epb_apply_progress(v_tracker, 'real_kill', -v_amount, v_matchday, 'Rollback: game edited', NULL);
      END IF;
    END LOOP;
  ELSE
    -- Legacy marker (credited before the ledger existed, season not rebuilt since): the caller's debits, validated.
    FOR v_entry IN SELECT e FROM jsonb_array_elements(p_debits) e ORDER BY e->>'tracker_id'
    LOOP
      v_tracker := (v_entry->>'tracker_id')::uuid;
      v_amount := (v_entry->>'amount')::integer;
      IF v_tracker IS NULL OR v_amount IS NULL OR v_amount < 1 THEN
        RAISE EXCEPTION 'phase_epb_uncredit_game_kills: every debit needs a tracker id and a positive amount (got %)', v_entry
          USING ERRCODE = '22023';
      END IF;
      SELECT player_id, season_id INTO v_owner, v_tracker_season FROM evolution_tracker WHERE id = v_tracker;
      IF NOT FOUND OR v_tracker_season IS DISTINCT FROM v_season
         OR (v_owner IS DISTINCT FROM v_player_1 AND v_owner IS DISTINCT FROM v_player_2) THEN
        RAISE EXCEPTION 'phase_epb_uncredit_game_kills: tracker % is not a tracker of this match''s players in its season', v_tracker
          USING ERRCODE = '22023';
      END IF;
      PERFORM epb_apply_progress(v_tracker, 'real_kill', -v_amount, v_matchday, 'Rollback: game edited', NULL);
    END LOOP;
  END IF;

  UPDATE phase_games SET evolution_applied_at = NULL, evolution_credits = NULL WHERE id = p_game_id;
  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = v_season;
  RETURN 'rolled_back';
END;
$$;

CREATE OR REPLACE FUNCTION public.phase_epb_sync_game_kill_credit(
  p_season_id uuid,
  p_expected_epoch bigint,
  p_credited_match_ids uuid[],
  p_game_credits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_epoch bigint;
  v_marked integer;
  v_rewritten integer;
  v_cleared integer;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_season_id IS NULL OR p_expected_epoch IS NULL OR p_credited_match_ids IS NULL THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: season id, expected epoch and credited match ids are required'
      USING ERRCODE = '22004';
  END IF;
  IF array_position(p_credited_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: credited match ids must not contain NULL' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_game_credits) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: game credits must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Fence: no credit, debit or other sync of this season since the rebuild read it, and every match it credited is
  -- still a completed match of this season.
  v_epoch := epb__lock_kill_credit_epoch(p_season_id);
  PERFORM 1 FROM phase_matches m JOIN league_phases p ON p.id = m.phase_id
    WHERE p.season_id = p_season_id ORDER BY m.id FOR SHARE OF m;
  IF v_epoch <> p_expected_epoch THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'credit_changed');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_credited_match_ids) AS c(match_id)
     WHERE NOT EXISTS (SELECT 1 FROM phase_matches m JOIN league_phases t ON t.id = m.phase_id
                        WHERE m.id = c.match_id AND t.season_id = p_season_id AND m.status = 'completed')
  ) THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  END IF;

  -- The per-game credits: phase_games of the credited phase_matches only, positive amounts, each tracker once per game and a
  -- tracker of one of the match's players in this season.
  IF EXISTS (SELECT 1 FROM jsonb_each(p_game_credits) gc WHERE jsonb_typeof(gc.value) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: every game''s credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_game_credits) AS k(game_id)
     WHERE NOT EXISTS (SELECT 1 FROM phase_games g WHERE g.id = k.game_id::uuid AND g.match_id = ANY (p_credited_match_ids))
  ) THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: credits name a game outside the credited phase_matches' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_game_credits) gc
     WHERE (SELECT count(*) FROM jsonb_array_elements(gc.value))
           <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(gc.value) e)
  ) THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: a tracker is listed more than once for one game' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_each(p_game_credits) gc
      CROSS JOIN LATERAL jsonb_array_elements(gc.value) e
      JOIN phase_games g ON g.id = gc.key::uuid
      JOIN phase_matches m ON m.id = g.match_id
      LEFT JOIN evolution_tracker et ON et.id = (e->>'tracker_id')::uuid
     WHERE (e->>'amount')::integer IS NULL OR (e->>'amount')::integer < 1
        OR et.id IS NULL OR et.season_id IS DISTINCT FROM p_season_id
        OR (et.player_id IS DISTINCT FROM m.player_1_id AND et.player_id IS DISTINCT FROM m.player_2_id)
  ) THEN
    RAISE EXCEPTION 'phase_epb_sync_game_kill_credit: every credit needs a tracker of the match''s players in this season and a positive amount'
      USING ERRCODE = '22023';
  END IF;

  -- Credited phase_matches' phase_games: marker (kept when set) + the rebuild's credits as the ledger.
  UPDATE phase_games g
     SET evolution_applied_at = now(),
         evolution_credits = COALESCE(p_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_credited_match_ids)
     AND g.evolution_applied_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE phase_games g
     SET evolution_credits = COALESCE(p_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_credited_match_ids)
     AND g.evolution_applied_at IS NOT NULL
     AND g.evolution_credits IS DISTINCT FROM COALESCE(p_game_credits -> g.id::text, '[]'::jsonb);
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  -- Every other game of the season: neither marker nor ledger.
  UPDATE phase_games g SET evolution_applied_at = NULL, evolution_credits = NULL
    FROM phase_matches m JOIN league_phases t ON t.id = m.phase_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND NOT (g.match_id = ANY (p_credited_match_ids))
     AND (g.evolution_applied_at IS NOT NULL OR g.evolution_credits IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = p_season_id;
  RETURN jsonb_build_object('status', 'synced', 'marked', v_marked, 'rewritten', v_rewritten, 'cleared', v_cleared);
END;
$$;

CREATE OR REPLACE FUNCTION public.epb_sync_mixed_game_kill_credit(
  p_season_id uuid,
  p_expected_epoch bigint,
  p_legacy_match_ids uuid[],
  p_legacy_game_credits jsonb,
  p_phase_match_ids uuid[],
  p_phase_game_credits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_epoch bigint;
  v_marked integer;
  v_rewritten integer;
  v_cleared integer;
  v_legacy jsonb;
  v_phase jsonb;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_season_id IS NULL OR p_expected_epoch IS NULL OR p_legacy_match_ids IS NULL THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: season id, expected epoch and credited match ids are required'
      USING ERRCODE = '22004';
  END IF;
  IF array_position(p_legacy_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: credited match ids must not contain NULL' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_legacy_game_credits) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: game credits must be a JSON object' USING ERRCODE = '22023';
  END IF;


  IF p_season_id IS NULL OR p_expected_epoch IS NULL OR p_phase_match_ids IS NULL THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: season id, expected epoch and credited match ids are required'
      USING ERRCODE = '22004';
  END IF;
  IF array_position(p_phase_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: credited match ids must not contain NULL' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_phase_game_credits) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: game credits must be a JSON object' USING ERRCODE = '22023';
  END IF;


  v_epoch := epb__lock_kill_credit_epoch(p_season_id);
  IF v_epoch <> p_expected_epoch THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'credit_changed');
  END IF;
  PERFORM 1 FROM matches m JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.season_id = p_season_id ORDER BY m.id FOR SHARE OF m;
  PERFORM 1 FROM phase_matches m JOIN league_phases p ON p.id = m.phase_id
    WHERE p.season_id = p_season_id ORDER BY m.id FOR SHARE OF m;
  PERFORM 1 FROM games g JOIN matches m ON m.id = g.match_id
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.season_id = p_season_id ORDER BY g.id FOR UPDATE OF g;
  PERFORM 1 FROM phase_games g JOIN phase_matches m ON m.id = g.match_id
    JOIN league_phases p ON p.id = m.phase_id
    WHERE p.season_id = p_season_id ORDER BY g.id FOR UPDATE OF g;
  IF EXISTS (SELECT 1 FROM matches m JOIN tournaments t ON t.id = m.tournament_id
    JOIN phase_matches pm ON pm.id = m.id JOIN league_phases p ON p.id = pm.phase_id
    WHERE t.season_id = p_season_id OR p.season_id = p_season_id)
    OR EXISTS (SELECT 1 FROM games g JOIN matches m ON m.id = g.match_id
      JOIN tournaments t ON t.id = m.tournament_id JOIN phase_games pg ON pg.id = g.id
      JOIN phase_matches pm ON pm.id = pg.match_id JOIN league_phases p ON p.id = pm.phase_id
      WHERE t.season_id = p_season_id OR p.season_id = p_season_id) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: duplicate identity across streams' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_legacy_match_ids) AS c(match_id)
     WHERE NOT EXISTS (SELECT 1 FROM matches m JOIN tournaments t ON t.id = m.tournament_id
                        WHERE m.id = c.match_id AND t.season_id = p_season_id AND m.status = 'completed')
  ) THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_each(p_legacy_game_credits) gc WHERE jsonb_typeof(gc.value) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: every game''s credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_legacy_game_credits) AS k(game_id)
     WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = k.game_id::uuid AND g.match_id = ANY (p_legacy_match_ids))
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: credits name a game outside the credited matches' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_legacy_game_credits) gc
     WHERE (SELECT count(*) FROM jsonb_array_elements(gc.value))
           <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(gc.value) e)
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: a tracker is listed more than once for one game' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_each(p_legacy_game_credits) gc
      CROSS JOIN LATERAL jsonb_array_elements(gc.value) e
      JOIN games g ON g.id = gc.key::uuid
      JOIN matches m ON m.id = g.match_id
      LEFT JOIN evolution_tracker et ON et.id = (e->>'tracker_id')::uuid
     WHERE (e->>'amount')::integer IS NULL OR (e->>'amount')::integer < 1
        OR et.id IS NULL OR et.season_id IS DISTINCT FROM p_season_id
        OR (et.player_id IS DISTINCT FROM m.player_1_id AND et.player_id IS DISTINCT FROM m.player_2_id)
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: legacy: every credit needs a tracker of the match''s players in this season and a positive amount'
      USING ERRCODE = '22023';
  END IF;


  IF EXISTS (
    SELECT 1 FROM unnest(p_phase_match_ids) AS c(match_id)
     WHERE NOT EXISTS (SELECT 1 FROM phase_matches m JOIN league_phases t ON t.id = m.phase_id
                        WHERE m.id = c.match_id AND t.season_id = p_season_id AND m.status = 'completed')
  ) THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_each(p_phase_game_credits) gc WHERE jsonb_typeof(gc.value) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: every game''s credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_phase_game_credits) AS k(game_id)
     WHERE NOT EXISTS (SELECT 1 FROM phase_games g WHERE g.id = k.game_id::uuid AND g.match_id = ANY (p_phase_match_ids))
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: credits name a game outside the credited phase_matches' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_phase_game_credits) gc
     WHERE (SELECT count(*) FROM jsonb_array_elements(gc.value))
           <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(gc.value) e)
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: a tracker is listed more than once for one game' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_each(p_phase_game_credits) gc
      CROSS JOIN LATERAL jsonb_array_elements(gc.value) e
      JOIN phase_games g ON g.id = gc.key::uuid
      JOIN phase_matches m ON m.id = g.match_id
      LEFT JOIN evolution_tracker et ON et.id = (e->>'tracker_id')::uuid
     WHERE (e->>'amount')::integer IS NULL OR (e->>'amount')::integer < 1
        OR et.id IS NULL OR et.season_id IS DISTINCT FROM p_season_id
        OR (et.player_id IS DISTINCT FROM m.player_1_id AND et.player_id IS DISTINCT FROM m.player_2_id)
  ) THEN
    RAISE EXCEPTION 'epb_sync_mixed_game_kill_credit: phase: every credit needs a tracker of the match''s players in this season and a positive amount'
      USING ERRCODE = '22023';
  END IF;


  UPDATE games g
     SET evolution_applied_at = now(),
         evolution_credits = COALESCE(p_legacy_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_legacy_match_ids)
     AND g.evolution_applied_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE games g
     SET evolution_credits = COALESCE(p_legacy_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_legacy_match_ids)
     AND g.evolution_applied_at IS NOT NULL
     AND g.evolution_credits IS DISTINCT FROM COALESCE(p_legacy_game_credits -> g.id::text, '[]'::jsonb);
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  UPDATE games g SET evolution_applied_at = NULL, evolution_credits = NULL
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND NOT (g.match_id = ANY (p_legacy_match_ids))
     AND (g.evolution_applied_at IS NOT NULL OR g.evolution_credits IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;


  v_legacy := jsonb_build_object('marked', v_marked, 'rewritten', v_rewritten, 'cleared', v_cleared);
  UPDATE phase_games g
     SET evolution_applied_at = now(),
         evolution_credits = COALESCE(p_phase_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_phase_match_ids)
     AND g.evolution_applied_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE phase_games g
     SET evolution_credits = COALESCE(p_phase_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_phase_match_ids)
     AND g.evolution_applied_at IS NOT NULL
     AND g.evolution_credits IS DISTINCT FROM COALESCE(p_phase_game_credits -> g.id::text, '[]'::jsonb);
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  UPDATE phase_games g SET evolution_applied_at = NULL, evolution_credits = NULL
    FROM phase_matches m JOIN league_phases t ON t.id = m.phase_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND NOT (g.match_id = ANY (p_phase_match_ids))
     AND (g.evolution_applied_at IS NOT NULL OR g.evolution_credits IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;


  v_phase := jsonb_build_object('marked', v_marked, 'rewritten', v_rewritten, 'cleared', v_cleared);
  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = p_season_id;
  RETURN jsonb_build_object('status', 'synced', 'legacy', v_legacy, 'phase', v_phase);
END;
$$;

REVOKE ALL ON FUNCTION
  public.phase_epb_credit_game_kills(uuid, jsonb),
  public.phase_epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.phase_epb_sync_game_kill_credit(uuid, bigint, uuid[], jsonb),
  public.epb_sync_mixed_game_kill_credit(uuid, bigint, uuid[], jsonb, uuid[], jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.phase_epb_credit_game_kills(uuid, jsonb),
  public.phase_epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.phase_epb_sync_game_kill_credit(uuid, bigint, uuid[], jsonb),
  public.epb_sync_mixed_game_kill_credit(uuid, bigint, uuid[], jsonb, uuid[], jsonb)
TO service_role;

COMMIT;
