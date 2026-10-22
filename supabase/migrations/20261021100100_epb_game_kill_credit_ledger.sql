-- EvoLiga real-kill credit: a per-game ledger and a season fence (PR #12 review on
-- 20261020100200_games_evolution_credit.sql, audit lead CF-07).
--
-- 20261020100200 gave every game a credit marker, games.evolution_applied_at, written by three functions. The
-- review found two gaps, both confirmed against the code:
--
--   * Debits were rebuilt, not recorded. epb_uncredit_game_kills subtracted debits the app rebuilt at edit time from
--     the CURRENT form -> tracker index (src/lib/match/evolution-match-evaluator.ts). After a redraft or trade replaced
--     the tracker that got the credit (the old tracker is deleted, its real kills carried into the new line's
--     transferred_evo_progress), a form of the game can map to a different tracker of the same player (two lines of
--     one base): the debit then hit a tracker that never got the credit, taking kills it had earned.
--   * The season rebuild was not fenced against credits. repairSeasonEvolution (src/lib/reconcile/
--     evolution-rebuild.ts) reads the season (T0), overwrites the trackers' real_kills with what it computed, then
--     calls epb_sync_game_kill_credit. A credit or debit committed between T0 and the sync was either overwritten
--     (its kills lost while its marker survived or was cleared) or kept by the trackers while the sync cleared its
--     marker (a later edit + re-confirm then counted it twice).
--
-- This migration:
--
-- 1. games.evolution_credits jsonb: exactly what the marker describes, [{tracker_id, amount}] sorted by tracker id
--    ('[]' for a credited game without kills). Written only together with the marker: by epb_credit_game_kills (the
--    credits it applied) and by epb_sync_game_kill_credit (the rebuild's per-game credits); cleared with the marker.
--    NULL with a marker set = a legacy marker: a game credited before this migration (all of them carry the
--    20261020100200 backfill time) whose season has not been rebuilt since. CHECK: no ledger without a marker, and a
--    ledger is a JSON array. No existing row can violate it (the column is new and NULL everywhere), so no DO block.
--
-- 2. epb_uncredit_game_kills (same signature, the app's wrapper is unchanged) debits the LEDGER: the trackers that got
--    the credit, the amounts they got. A ledger tracker that no longer exists (retired by a redraft or a trade) is
--    skipped: its kills were carried into the replacement line's transferred_evo_progress, a snapshot taken at the
--    drop that the season rebuild preserves too (spec §21), so nothing follows them. p_debits is used only for a
--    legacy marker (no ledger), validated as before. Outcomes unchanged.
--
-- 3. epb_kill_credit_epochs + a season fence. One row per season with a counter, bumped by every write of a credit,
--    a debit or a rebuild sync, in the same transaction. epb_credit_game_kills and epb_uncredit_game_kills lock the
--    row first (FOR UPDATE, before the game row), so all marker writes of a season serialise on it.
--    epb_kill_credit_epoch(season) reads the counter; the rebuild reads it BEFORE it reads the season and passes it to
--    the new epb_sync_game_kill_credit, which locks the row, and refuses ('stale', nothing written) when the counter
--    moved or when a match the rebuild credited is no longer completed. The rebuild then starts over from a fresh
--    read (bounded retries in TS). The sync is the rebuild's LAST write, so a credit that commits after it applies
--    to the fully rebuilt trackers, and every credit that commits before it but after T0 is caught.
--
-- 4. epb_sync_game_kill_credit(p_season_id, p_expected_epoch, p_credited_match_ids, p_game_credits) -> jsonb replaces
--    the unfenced (uuid, uuid[]) version, which is dropped. The games of the credited matches get the marker (kept when
--    already set) and the rebuild's per-game credits as their ledger (p_game_credits: {game_id: [{tracker_id,
--    amount}]}, a game absent from it credited nothing); every other game of the season loses marker and ledger.
--    Returns {status: 'synced', marked, rewritten, cleared} or {status: 'stale', reason}.
--
-- epb_credit_game_kills keeps its signature and outcomes; it now also takes the season lock first, writes the ledger
-- with the marker and bumps the counter.
--
-- Lock order (all four functions): the season's epb_kill_credit_epochs row, then game rows, then tracker rows (through
-- epb_apply_progress, in tracker id order). Nothing else locks the epochs row, so no other writer can wait on it while
-- holding a game or tracker lock.
--
-- Residuals (documented in docs/evolution-point-buy.md and docs/reconcile.md):
--   * a legacy marker still debits through p_debits (the old rebuilt-index behaviour) until the season is rebuilt
--     once (reconcile repair, or any match delete / reset), which writes the ledger of every credited game;
--   * kills credited to a since-retired tracker stay in the replacement's transferred_evo_progress after an edit of
--     the game (the carry is a snapshot); a re-confirm credits the edited stats to the trackers that cover the game's
--     forms now, which is what the season rebuild computes as well.
--
-- Deploy order: apply this migration, then deploy the code right away. The old sync signature is dropped, so a
-- season rebuild run by the previous build of this branch fails loudly until the deploy (no silent write); credits
-- and debits keep their signatures. Locks while applying: ADD COLUMN (nullable, no default) is catalog-only; ADD
-- CONSTRAINT scans games once; both take ACCESS EXCLUSIVE on games for that moment.
--
-- Grants: the new table is service_role only with RLS enabled and no policies (like rate_limit_buckets); the new and
-- replaced functions, the internal epb__lock_kill_credit_epoch included (the callers run as service_role, like the
-- draft__ helpers): EXECUTE for service_role only. No change to the grants on games.
BEGIN;

-- 1. Ledger.
ALTER TABLE public.games ADD COLUMN evolution_credits jsonb;
ALTER TABLE public.games ADD CONSTRAINT games_evolution_credits_marker_check
  CHECK (evolution_credits IS NULL
         OR (evolution_applied_at IS NOT NULL AND jsonb_typeof(evolution_credits) = 'array'));

COMMENT ON COLUMN public.games.evolution_credits IS
  'The real-kill credits games.evolution_applied_at describes: [{tracker_id, amount}] sorted by tracker id, [] for a '
  'credited game without kills. Written only with the marker (epb_credit_game_kills, epb_sync_game_kill_credit) and '
  'debited exactly by epb_uncredit_game_kills. NULL with the marker set = credited before 2026-10-21 and not rebuilt '
  'since (20261021100100_epb_game_kill_credit_ledger.sql).';

-- 3. Season fence.
CREATE TABLE public.epb_kill_credit_epochs (
  season_id uuid   PRIMARY KEY REFERENCES public.seasons (id) ON DELETE CASCADE,
  epoch     bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0)
);

ALTER TABLE public.epb_kill_credit_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.epb_kill_credit_epochs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.epb_kill_credit_epochs TO service_role;
COMMENT ON TABLE public.epb_kill_credit_epochs IS
  'Service-role only. Per EPB season, a counter bumped by every real-kill credit, debit and rebuild sync '
  '(epb_credit_game_kills, epb_uncredit_game_kills, epb_sync_game_kill_credit); its row lock serialises them. '
  'No RLS policies by design.';

-- Lock (creating it on first use) and return the season's fence row. Internal: called by the functions below only.
CREATE OR REPLACE FUNCTION public.epb__lock_kill_credit_epoch(p_season_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_epoch bigint;
BEGIN
  INSERT INTO epb_kill_credit_epochs (season_id) VALUES (p_season_id) ON CONFLICT (season_id) DO NOTHING;
  SELECT epoch INTO v_epoch FROM epb_kill_credit_epochs WHERE season_id = p_season_id FOR UPDATE;
  RETURN v_epoch;
END;
$$;

CREATE OR REPLACE FUNCTION public.epb_kill_credit_epoch(p_season_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT epoch FROM epb_kill_credit_epochs WHERE season_id = p_season_id), 0);
$$;

COMMENT ON FUNCTION public.epb_kill_credit_epoch(uuid) IS
  'The season''s real-kill credit counter (0 before the first credit). The season rebuild reads it before it reads '
  'the season and passes it to epb_sync_game_kill_credit as its fence. Service-role only.';

-- 2. Credit one game's real kills (match completion): + season lock, ledger, counter.
CREATE OR REPLACE FUNCTION public.epb_credit_game_kills(p_game_id uuid, p_credits jsonb)
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
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'epb_credit_game_kills: game id is required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_credits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'epb_credit_game_kills: credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_credits))
     <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(p_credits) e) THEN
    RAISE EXCEPTION 'epb_credit_game_kills: a tracker is listed more than once' USING ERRCODE = '22023';
  END IF;

  -- 0. Season fence first (lock order: epochs row, game row, trackers).
  SELECT t.season_id INTO v_season
    FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id
   WHERE g.id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  PERFORM epb__lock_kill_credit_epoch(v_season);

  -- 1. Game row lock: two credits of one game serialise here, and the second sees the first one's marker.
  SELECT evolution_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RETURN 'already_applied';
  END IF;

  -- 2. Only a completed match's games are credited (owner decision on CF-07).
  SELECT m.status, m.player_1_id, m.player_2_id, r.round_number
    INTO v_status, v_player_1, v_player_2, v_matchday
    FROM games g
    JOIN matches m ON m.id = g.match_id
    LEFT JOIN rounds r ON r.id = m.round_id
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
      RAISE EXCEPTION 'epb_credit_game_kills: every credit needs a tracker id and a positive amount (got %)', v_entry
        USING ERRCODE = '22023';
    END IF;
    SELECT player_id, season_id INTO v_owner, v_tracker_season FROM evolution_tracker WHERE id = v_tracker;
    IF NOT FOUND OR v_tracker_season IS DISTINCT FROM v_season
       OR (v_owner IS DISTINCT FROM v_player_1 AND v_owner IS DISTINCT FROM v_player_2) THEN
      RAISE EXCEPTION 'epb_credit_game_kills: tracker % is not a tracker of this match''s players in its season', v_tracker
        USING ERRCODE = '22023';
    END IF;
    PERFORM epb_apply_progress(v_tracker, 'real_kill', v_amount, v_matchday, 'KO from battle', NULL);
  END LOOP;

  -- 4. Marker + ledger (what was just credited), and the season counter, in the same transaction as the credits.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tracker_id', (e->>'tracker_id')::uuid, 'amount', (e->>'amount')::integer)
                            ORDER BY (e->>'tracker_id')::uuid), '[]'::jsonb)
    INTO v_ledger
    FROM jsonb_array_elements(p_credits) e;
  UPDATE games SET evolution_applied_at = now(), evolution_credits = v_ledger WHERE id = p_game_id;
  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = v_season;
  RETURN 'applied';
END;
$$;

COMMENT ON FUNCTION public.epb_credit_game_kills(uuid, jsonb) IS
  'Credit one game''s real kills ([{tracker_id, amount}], built in TS from its battle_stats) to EPB trackers through '
  'epb_apply_progress, set games.evolution_applied_at and record the credits in games.evolution_credits, in one '
  'transaction under the season fence and the game row lock; only for a completed match. Returns applied | '
  'already_applied | match_not_completed | game_missing. Service-role only.';

-- 2. Reverse a credited game's real kills (admin game edit): debit the ledger.
CREATE OR REPLACE FUNCTION public.epb_uncredit_game_kills(
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
  IF p_game_id IS NULL OR p_expected_applied_at IS NULL THEN
    RAISE EXCEPTION 'epb_uncredit_game_kills: game id and expected marker are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_debits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'epb_uncredit_game_kills: debits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_debits))
     <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(p_debits) e) THEN
    RAISE EXCEPTION 'epb_uncredit_game_kills: a tracker is listed more than once' USING ERRCODE = '22023';
  END IF;

  SELECT m.player_1_id, m.player_2_id, t.season_id, r.round_number
    INTO v_player_1, v_player_2, v_season, v_matchday
    FROM games g
    JOIN matches m ON m.id = g.match_id
    JOIN tournaments t ON t.id = m.tournament_id
    LEFT JOIN rounds r ON r.id = m.round_id
   WHERE g.id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  PERFORM epb__lock_kill_credit_epoch(v_season);

  SELECT evolution_applied_at, evolution_credits INTO v_applied_at, v_ledger FROM games WHERE id = p_game_id FOR UPDATE;
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
        RAISE EXCEPTION 'epb_uncredit_game_kills: every debit needs a tracker id and a positive amount (got %)', v_entry
          USING ERRCODE = '22023';
      END IF;
      SELECT player_id, season_id INTO v_owner, v_tracker_season FROM evolution_tracker WHERE id = v_tracker;
      IF NOT FOUND OR v_tracker_season IS DISTINCT FROM v_season
         OR (v_owner IS DISTINCT FROM v_player_1 AND v_owner IS DISTINCT FROM v_player_2) THEN
        RAISE EXCEPTION 'epb_uncredit_game_kills: tracker % is not a tracker of this match''s players in its season', v_tracker
          USING ERRCODE = '22023';
      END IF;
      PERFORM epb_apply_progress(v_tracker, 'real_kill', -v_amount, v_matchday, 'Rollback: game edited', NULL);
    END LOOP;
  END IF;

  UPDATE games SET evolution_applied_at = NULL, evolution_credits = NULL WHERE id = p_game_id;
  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = v_season;
  RETURN 'rolled_back';
END;
$$;

COMMENT ON FUNCTION public.epb_uncredit_game_kills(uuid, timestamptz, jsonb) IS
  'Subtract one credited game''s real kills from EPB trackers (clamped at 0): the ledger games.evolution_credits '
  '(trackers retired since are skipped), or p_debits ([{tracker_id, amount}]) for a legacy marker without a ledger; '
  'clear marker and ledger, in one transaction under the season fence and the game row lock, fenced on the marker '
  'equalling p_expected_applied_at. Returns rolled_back | not_applied | marker_changed | game_missing. Service-role only.';

-- 4. Align the markers and ledgers of a season's games with a rebuild, fenced.
DROP FUNCTION public.epb_sync_game_kill_credit(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.epb_sync_game_kill_credit(
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
  IF p_season_id IS NULL OR p_expected_epoch IS NULL OR p_credited_match_ids IS NULL THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: season id, expected epoch and credited match ids are required'
      USING ERRCODE = '22004';
  END IF;
  IF array_position(p_credited_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: credited match ids must not contain NULL' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_game_credits) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: game credits must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Fence: no credit, debit or other sync of this season since the rebuild read it, and every match it credited is
  -- still a completed match of this season.
  v_epoch := epb__lock_kill_credit_epoch(p_season_id);
  IF v_epoch <> p_expected_epoch THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'credit_changed');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_credited_match_ids) AS c(match_id)
     WHERE NOT EXISTS (SELECT 1 FROM matches m JOIN tournaments t ON t.id = m.tournament_id
                        WHERE m.id = c.match_id AND t.season_id = p_season_id AND m.status = 'completed')
  ) THEN
    RETURN jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  END IF;

  -- The per-game credits: games of the credited matches only, positive amounts, each tracker once per game and a
  -- tracker of one of the match's players in this season.
  IF EXISTS (SELECT 1 FROM jsonb_each(p_game_credits) gc WHERE jsonb_typeof(gc.value) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: every game''s credits must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_game_credits) AS k(game_id)
     WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = k.game_id::uuid AND g.match_id = ANY (p_credited_match_ids))
  ) THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: credits name a game outside the credited matches' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_game_credits) gc
     WHERE (SELECT count(*) FROM jsonb_array_elements(gc.value))
           <> (SELECT count(DISTINCT e->>'tracker_id') FROM jsonb_array_elements(gc.value) e)
  ) THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: a tracker is listed more than once for one game' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_each(p_game_credits) gc
      CROSS JOIN LATERAL jsonb_array_elements(gc.value) e
      JOIN games g ON g.id = gc.key::uuid
      JOIN matches m ON m.id = g.match_id
      LEFT JOIN evolution_tracker et ON et.id = (e->>'tracker_id')::uuid
     WHERE (e->>'amount')::integer IS NULL OR (e->>'amount')::integer < 1
        OR et.id IS NULL OR et.season_id IS DISTINCT FROM p_season_id
        OR (et.player_id IS DISTINCT FROM m.player_1_id AND et.player_id IS DISTINCT FROM m.player_2_id)
  ) THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: every credit needs a tracker of the match''s players in this season and a positive amount'
      USING ERRCODE = '22023';
  END IF;

  -- Credited matches' games: marker (kept when set) + the rebuild's credits as the ledger.
  UPDATE games g
     SET evolution_applied_at = now(),
         evolution_credits = COALESCE(p_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_credited_match_ids)
     AND g.evolution_applied_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE games g
     SET evolution_credits = COALESCE(p_game_credits -> g.id::text, '[]'::jsonb)
   WHERE g.match_id = ANY (p_credited_match_ids)
     AND g.evolution_applied_at IS NOT NULL
     AND g.evolution_credits IS DISTINCT FROM COALESCE(p_game_credits -> g.id::text, '[]'::jsonb);
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  -- Every other game of the season: neither marker nor ledger.
  UPDATE games g SET evolution_applied_at = NULL, evolution_credits = NULL
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND NOT (g.match_id = ANY (p_credited_match_ids))
     AND (g.evolution_applied_at IS NOT NULL OR g.evolution_credits IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  UPDATE epb_kill_credit_epochs SET epoch = epoch + 1 WHERE season_id = p_season_id;
  RETURN jsonb_build_object('status', 'synced', 'marked', v_marked, 'rewritten', v_rewritten, 'cleared', v_cleared);
END;
$$;

COMMENT ON FUNCTION public.epb_sync_game_kill_credit(uuid, bigint, uuid[], jsonb) IS
  'Last write of an EPB season rebuild: fenced on the season''s credit counter read before the rebuild''s reads '
  '(epb_kill_credit_epoch) and on every credited match still being completed, else {status: stale} and nothing '
  'written. Sets games.evolution_applied_at (kept when set) and games.evolution_credits (p_game_credits, {game_id: '
  '[{tracker_id, amount}]}) on the credited matches'' games, clears both on every other game of the season. '
  'Returns {status: synced, marked, rewritten, cleared}. Service-role only.';

REVOKE ALL ON FUNCTION
  public.epb__lock_kill_credit_epoch(uuid),
  public.epb_kill_credit_epoch(uuid),
  public.epb_credit_game_kills(uuid, jsonb),
  public.epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.epb_sync_game_kill_credit(uuid, bigint, uuid[], jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.epb__lock_kill_credit_epoch(uuid),
  public.epb_kill_credit_epoch(uuid),
  public.epb_credit_game_kills(uuid, jsonb),
  public.epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.epb_sync_game_kill_credit(uuid, bigint, uuid[], jsonb)
TO service_role;

COMMIT;
