-- EvoLiga real kills wait for the confirmed result (owner decision 2026-10-20 on audit lead CF-07,
-- docs/security/audit-2026-10-20/README.md).
--
-- Until now recordGameResult (src/lib/pkmn/game-pipeline.ts) credited a game's real kills to the Evolution Point Buy
-- trackers the moment the game was submitted, so a result still waiting for the opponent (pending_confirmation), or
-- one under dispute, already moved evolution progress. From now on a game's real kills are credited only when its
-- match reaches `completed` (opponent confirm, auto-confirm timeout, admin dispute resolution), from the new finalize
-- step `epb_real_kills` (src/lib/match/finalize.ts). Aggregates are unchanged: they are still counted at submission.
--
-- Finalize can run more than once for one match (the auto-confirm cron heals completed matches whose finalized_at is
-- NULL), and admins edit, delete and reset games. So the credit needs a marker per game:
--
-- 1. games.evolution_applied_at timestamptz: set when the game's real kills were credited to the EPB trackers, NULL
--    while they are not. It is written only inside the three functions below, each in ONE transaction with the
--    tracker writes it describes, under the game row lock.
--
--    Backfill: every game that exists when this migration runs gets the marker (the migration's transaction time).
--    All of them had their real kills credited at submission under the old rule, whatever their match's status:
--      * games of completed matches: already credited, must never be credited again (a heal, or a re-confirm after
--        an admin edit, would otherwise count them twice);
--      * games of matches still in_progress, pending_confirmation or disputed: also already credited at submission.
--        Marking them means their match's completion credits nothing more for them (nothing double-counts), and
--        nothing is reversed now (nothing is lost). Until that completion their progress stays visible, exactly as
--        before. If such a match is reset or a game is deleted, the season rebuild (repairSeasonEvolution) drops
--        their kills as it always did and clears their marker (function 4), so a later completion credits them then.
--        An admin edit of such a game reverses the submission credit and clears the marker (function 3).
--      * games of non-EPB seasons: the marker is never read for them; marking them is harmless.
--    New games are inserted with the marker NULL (the default is dropped right after the backfill).
--    The backfill uses ADD COLUMN ... DEFAULT now() (one value for every existing row, stored in the catalog: no
--    table rewrite, no row UPDATE, so trg_games_updated does not move updated_at and no open admin editor turns
--    stale), then DROP DEFAULT. The column is added without IF NOT EXISTS on purpose: re-running this file against a
--    table that already has the column must fail instead of skipping the backfill.
--
-- 2. epb_credit_game_kills(p_game_id, p_credits) -> text. Credits one game's real kills: per entry
--    {tracker_id, amount} one epb_apply_progress(tracker, 'real_kill', amount, matchday) call (atomic increment +
--    evo_progress_log row, matchday = the match's rounds.round_number), then sets the marker. Outcomes (exhaustive; the
--    TS wrapper throws on anything else):
--      'applied'              credited now, marker set
--      'already_applied'      the marker is set: nothing written (finalize re-run, heal, backfilled game)
--      'match_not_completed'  the match is not completed (a reset or an admin edit moved it meanwhile): nothing written
--      'game_missing'         the game row is gone: nothing written
--    The entries are built in TS from the game's battle_stats (form -> tracker index, src/lib/match/
--    evolution-match-evaluator.ts). The function refuses (22023, nothing written) an entry whose tracker does not belong
--    to one of the match's two players in the match's season, a non-positive amount, or a tracker listed twice.
--
-- 3. epb_uncredit_game_kills(p_game_id, p_expected_applied_at, p_debits) -> text. The inverse for an admin game edit:
--    subtracts the credited kills (clamped at 0 by increment_tracker_progress, logged as 'real_kill' with a negative
--    amount on the same matchday, so the matchday's log deltas net out) and clears the marker. Fenced on the marker
--    value the caller read together with the stats it built the debits from, like rollback_game_aggregates:
--      'rolled_back'     the marker matched: debited, marker cleared
--      'not_applied'     the marker is NULL: nothing written (never credited, or a rebuild cleared it)
--      'marker_changed'  the marker is set but differs: credited again since the caller read it; nothing written
--      'game_missing'    the game row is gone: nothing written
--    No status condition: an edit of a completed match moves it out of `completed`, and its kills wait for the next
--    completion.
--
-- 4. epb_sync_game_kill_credit(p_season_id, p_credited_match_ids) -> jsonb {marked, cleared}. Called by the season
--    rebuild (repairSeasonEvolution, src/lib/reconcile/evolution-rebuild.ts) right after it rewrote the trackers'
--    real_kills from the season's completed matches: the games of the matches it credited get the marker, every other
--    game of the season loses it, so the markers describe what the rebuilt trackers hold. Only games of the season's
--    own tournaments are touched.
--
-- Lock order: the game row first (FOR UPDATE, like apply_aggregate_job and rollback_game_aggregates), then the tracker
-- rows through epb_apply_progress in the order of p_credits / p_debits (the TS side sorts them by tracker id), so two
-- concurrent credits of one player's games take the tracker locks in the same order. Any error rolls back every write
-- of the call, so a failure leaves trackers, log and marker exactly as they were.
--
-- Locks while applying: ADD COLUMN with a non-volatile default and DROP DEFAULT are catalog-only but take ACCESS
-- EXCLUSIVE on games for the moment they run.
--
-- Deploy order: apply this migration, then deploy the code right away. The new code calls these functions, so it must
-- not run first (its finalize step would fail until the migration exists, and the backfill would then mark games whose
-- kills nobody credited). The old code keeps crediting at submission until the deploy, so a game submitted between the
-- two is credited at submission and would be credited again at completion. Right after the deploy, mark those:
--   UPDATE public.games SET evolution_applied_at = created_at
--    WHERE evolution_applied_at IS NULL AND created_at < '<deploy time>';
-- (it moves their updated_at, which only turns an open admin editor of those games stale).
--
-- No new grants on games: anon and authenticated hold nothing on public.games (20261008081443_close_public_api_roles.sql);
-- service_role's table privileges cover the new column, and the app's Game mapper (toGame) reads it. RLS on games is
-- unchanged. The three functions: EXECUTE for service_role only.
BEGIN;

-- 1. Marker + backfill of every existing game.
ALTER TABLE public.games ADD COLUMN evolution_applied_at timestamptz DEFAULT now();
ALTER TABLE public.games ALTER COLUMN evolution_applied_at DROP DEFAULT;

COMMENT ON COLUMN public.games.evolution_applied_at IS
  'When this game''s real kills were credited to the Evolution Point Buy trackers (epb_credit_game_kills, at match '
  'completion); NULL while they are not. Written only by epb_credit_game_kills, epb_uncredit_game_kills and '
  'epb_sync_game_kill_credit, in the same transaction as the tracker writes. Games that existed on 2026-10-20 carry '
  'the backfill time (20261020100200_games_evolution_credit.sql): they were credited at submission. Never read for '
  'non-EPB seasons.';

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.games WHERE evolution_applied_at IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'evolution_applied_at backfill left % existing games unmarked; their kills would be credited twice', n;
  END IF;
END $$;

-- 2. Credit one game's real kills (match completion).
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

  -- 1. Game row lock first: two credits of one game serialise here, and the second sees the first one's marker.
  SELECT evolution_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RETURN 'already_applied';
  END IF;

  -- 2. Only a completed match's games are credited (owner decision on CF-07).
  SELECT m.status, m.player_1_id, m.player_2_id, t.season_id, r.round_number
    INTO v_status, v_player_1, v_player_2, v_season, v_matchday
    FROM games g
    JOIN matches m ON m.id = g.match_id
    JOIN tournaments t ON t.id = m.tournament_id
    LEFT JOIN rounds r ON r.id = m.round_id
   WHERE g.id = p_game_id;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RETURN 'match_not_completed';
  END IF;

  -- 3. Credits: each tracker must belong to one of the match's players in the match's season.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_credits)
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

  -- 4. Marker, in the same transaction as the credits.
  UPDATE games SET evolution_applied_at = now() WHERE id = p_game_id;
  RETURN 'applied';
END;
$$;

COMMENT ON FUNCTION public.epb_credit_game_kills(uuid, jsonb) IS
  'Credit one game''s real kills ([{tracker_id, amount}], built in TS from its battle_stats) to EPB trackers through '
  'epb_apply_progress and set games.evolution_applied_at, in one transaction under the game row lock; only for a '
  'completed match. Returns applied | already_applied | match_not_completed | game_missing. Service-role only.';

-- 3. Reverse a credited game's real kills (admin game edit).
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

  SELECT evolution_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NULL THEN
    RETURN 'not_applied';
  END IF;
  IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN
    RETURN 'marker_changed';
  END IF;

  SELECT m.player_1_id, m.player_2_id, t.season_id, r.round_number
    INTO v_player_1, v_player_2, v_season, v_matchday
    FROM games g
    JOIN matches m ON m.id = g.match_id
    JOIN tournaments t ON t.id = m.tournament_id
    LEFT JOIN rounds r ON r.id = m.round_id
   WHERE g.id = p_game_id;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_debits)
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

  UPDATE games SET evolution_applied_at = NULL WHERE id = p_game_id;
  RETURN 'rolled_back';
END;
$$;

COMMENT ON FUNCTION public.epb_uncredit_game_kills(uuid, timestamptz, jsonb) IS
  'Subtract one credited game''s real kills ([{tracker_id, amount}], positive amounts) from EPB trackers (clamped at 0) '
  'and clear games.evolution_applied_at, in one transaction under the game row lock, fenced on the marker equalling '
  'p_expected_applied_at. Returns rolled_back | not_applied | marker_changed | game_missing. Service-role only.';

-- 4. Align the markers of a season's games with a rebuild (repairSeasonEvolution).
CREATE OR REPLACE FUNCTION public.epb_sync_game_kill_credit(p_season_id uuid, p_credited_match_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_marked integer;
  v_cleared integer;
BEGIN
  IF p_season_id IS NULL OR p_credited_match_ids IS NULL THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: season id and credited match ids are required' USING ERRCODE = '22004';
  END IF;
  IF array_position(p_credited_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'epb_sync_game_kill_credit: credited match ids must not contain NULL' USING ERRCODE = '22004';
  END IF;

  UPDATE games g SET evolution_applied_at = now()
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND g.match_id = ANY (p_credited_match_ids)
     AND g.evolution_applied_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE games g SET evolution_applied_at = NULL
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id
   WHERE m.id = g.match_id AND t.season_id = p_season_id
     AND NOT (g.match_id = ANY (p_credited_match_ids))
     AND g.evolution_applied_at IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object('marked', v_marked, 'cleared', v_cleared);
END;
$$;

COMMENT ON FUNCTION public.epb_sync_game_kill_credit(uuid, uuid[]) IS
  'After an EPB season rebuild: set games.evolution_applied_at on the games of the matches whose real kills the '
  'rebuild credited and clear it on every other game of the season. Returns {marked, cleared}. Service-role only.';

REVOKE ALL ON FUNCTION
  public.epb_credit_game_kills(uuid, jsonb),
  public.epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.epb_sync_game_kill_credit(uuid, uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.epb_credit_game_kills(uuid, jsonb),
  public.epb_uncredit_game_kills(uuid, timestamptz, jsonb),
  public.epb_sync_game_kill_credit(uuid, uuid[])
TO service_role;

COMMIT;
