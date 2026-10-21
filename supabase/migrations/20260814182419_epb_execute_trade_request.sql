-- Evolution Point Buy: atomic trade-request execution (3B-2-a review round)
--
-- Replaces the multi-step TS execute protocol (claimForExecution -> validate
-- -> executeRedraftSwaps -> storeExecutedTrackerIds, with revertToPending on
-- failure) with ONE atomic RPC. The previous protocol had two race windows:
--   * Double-execute / executed-without-swap: if the RPC committed but a later
--     TS step threw, the catch reverted the claim to 'pending', so a retry ran
--     the swap again; a crash after claim left an 'executed' row with no swap.
--   * Points + phase TOCTOU: computeRemainingPoints and redraft_phase_open
--     were read in TS outside the RPC's lock, so a concurrent redraft could
--     change the budget / close the phase between TS compute and RPC execute.
--
-- epb_execute_trade_request does, in a single transaction under a per-season
-- advisory xact lock: (1) row-lock the request, (2) atomically verify it is
-- still 'pending' AND both consented, (3) re-check redraft_phase_open, (4)
-- re-check each side's remaining points IN SQL, (5) reuse the proven
-- epb_execute_redraft body (lock+validate source trackers, free-line check
-- with same-batch exclusion, insert new trackers + history, delete sources),
-- (6) flip status to 'executed' and persist the new tracker ids. Any failure
-- rolls the whole transaction back — no TS revert is ever needed.
--
-- The points recompute MUST mirror computeRemainingPoints in
-- src/lib/draft/progress-engine.ts exactly:
--   remaining = budget
--             - SUM(draft_picks.points_spent   WHERE pool = season's pool AND player)
--             - SUM(epb_token_grants.token_count WHERE season+player+grant_type='draft_token') * draft_token_ratio
--             - SUM(redraft_history.points_spent WHERE season+player)
-- Draft-pool resolution mirrors getDraftPoolBySeason (.maybeSingle()):
-- 0 pools -> remaining = budget (TS early return, no deductions);
-- >1 pools -> loud failure ('multiple_draft_pools'), never an arbitrary pick.
-- Keep this SQL and that TS function in sync (same table/column names:
-- draft_picks.draft_pool_id, draft_picks.player_id, draft_picks.points_spent;
-- draft_pools.season_id; epb_token_grants.grant_type='draft_token',
-- epb_token_grants.token_count; redraft_history.points_spent).

-- 1. Atomic trade-request execution: claim + phase check + points check +
--    swap + finalize, all under one transaction.
CREATE OR REPLACE FUNCTION public.epb_execute_trade_request(
  p_request_id uuid,
  p_swaps jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.redraft_trade_requests;
  v_season uuid;
  v_phase boolean;
  v_swap jsonb;
  v_player uuid;
  v_cost integer;
  v_remaining numeric;
  v_pool_id uuid;
  v_pool_count integer;
  v_new jsonb;
  v_hist jsonb;
  v_from public.evolution_tracker;
  v_from_ids uuid[] := '{}';
  v_new_id uuid;
  v_new_ids jsonb := '[]'::jsonb;
BEGIN
  -- 1.1 Row-lock the request; derive the season once.
  SELECT * INTO v_req FROM public.redraft_trade_requests
    WHERE id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade request not found' USING ERRCODE = 'P0001';
  END IF;
  v_season := v_req.season_id;

  -- 1.2 Serialize concurrent redrafts/trades for this season so the free-line
  --     check and the points recompute cannot race a concurrent redraft.
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));

  -- 2. Atomic claim: only a request that is still 'pending' AND has both
  --    consents can proceed. A concurrent double-consent caller fails here
  --    (the row is already locked; once the first commits it is 'executed').
  IF NOT (v_req.status = 'pending' AND v_req.consent_a AND v_req.consent_b) THEN
    RAISE EXCEPTION 'request_not_executable' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Phase re-check (closes phase TOCTOU): the phase must still be open at
  --    execute time, re-read inside the lock.
  SELECT fr.redraft_phase_open INTO v_phase
    FROM public.format_rules fr
    WHERE fr.season_id = v_season;
  IF NOT COALESCE(v_phase, false) THEN
    RAISE EXCEPTION 'phase_closed' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Points re-check IN SQL for every swap's player (closes points TOCTOU).
  --    Mirrors computeRemainingPoints exactly (see header cross-reference),
  --    including its draft-pool resolution: getDraftPoolBySeason uses
  --    .maybeSingle(), which ERRORS on more than one pool — so fail loudly
  --    ('multiple_draft_pools') instead of silently picking an arbitrary
  --    pool. A season with no pool mirrors the TS early return: remaining is
  --    the full budget with no deductions.
  SELECT count(*) INTO v_pool_count FROM public.draft_pools
    WHERE season_id = v_season;
  IF v_pool_count > 1 THEN
    RAISE EXCEPTION 'multiple_draft_pools' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_pool_id FROM public.draft_pools
    WHERE season_id = v_season;

  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_player := (v_swap->>'player_id')::uuid;
    v_cost := COALESCE((v_swap->'history'->>'points_spent')::integer, 0);

    IF v_pool_count = 0 THEN
      SELECT fr.draft_budget INTO v_remaining
        FROM public.format_rules fr
        WHERE fr.season_id = v_season;
    ELSE
      SELECT fr.draft_budget
        - COALESCE((
            SELECT SUM(dp.points_spent) FROM public.draft_picks dp
            WHERE dp.draft_pool_id = v_pool_id
              AND dp.player_id = v_player
          ), 0)
        - COALESCE((
            SELECT SUM(g.token_count) * fr.draft_token_ratio
              FROM public.epb_token_grants g
              WHERE g.season_id = v_season
                AND g.player_id = v_player
                AND g.grant_type = 'draft_token'
          ), 0)
        - COALESCE((
            SELECT SUM(rh.points_spent) FROM public.redraft_history rh
            WHERE rh.season_id = v_season
              AND rh.player_id = v_player
          ), 0)
        INTO v_remaining
      FROM public.format_rules fr
      WHERE fr.season_id = v_season;
    END IF;

    -- An EPB season always has a format_rules row; if somehow missing the
    -- SELECT above yields NULL -> treat as insufficient (never silently allow).
    IF v_remaining IS NULL THEN
      RAISE EXCEPTION 'insufficient_points' USING ERRCODE = 'P0001';
    END IF;

    IF v_cost > v_remaining THEN
      RAISE EXCEPTION 'insufficient_points' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 5. Reuse the epb_execute_redraft body (passes 1-4), parameterized by the
  --    request's season and the supplied swap payloads.

  -- 5.1 Pass 1: lock + validate every source tracker.
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    SELECT * INTO v_from FROM public.evolution_tracker
      WHERE id = (v_swap->>'from_tracker_id')::uuid
        AND season_id = v_season
        AND player_id = (v_swap->>'player_id')::uuid
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source tracker % not found for this player in this season',
        v_swap->>'from_tracker_id' USING ERRCODE = 'P0001';
    END IF;
    v_from_ids := array_append(v_from_ids, v_from.id);
  END LOOP;

  -- 5.2 Pass 2: every target line must be free (ignoring lines leaving in
  --     this same batch — the trade counter-side).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    IF EXISTS (
      SELECT 1 FROM public.evolution_tracker
      WHERE season_id = v_season
        AND base_pokemon = v_swap->'new_tracker'->>'base_pokemon'
        AND NOT (id = ANY(v_from_ids))
    ) THEN
      RAISE EXCEPTION 'Line % is already owned by another player',
        v_swap->'new_tracker'->>'base_pokemon' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 5.3 Pass 3: create new trackers and history rows (history references the
  --     still-existing source tracker; the FK is ON DELETE SET NULL).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_new := v_swap->'new_tracker';
    v_hist := v_swap->'history';

    INSERT INTO public.evolution_tracker
      (season_id, player_id, base_pokemon, current_form, current_stage,
       total_kos, real_kills, evolution_points_awarded, locked_stage3_pokemon)
    VALUES
      (v_season,
       (v_swap->>'player_id')::uuid,
       v_new->>'base_pokemon',
       v_new->>'current_form',
       (v_new->>'current_stage')::integer,
       (v_new->>'total_kos')::integer,
       (v_new->>'real_kills')::integer,
       COALESCE((v_new->>'evolution_points_awarded')::integer, 0),
       v_new->>'locked_stage3_pokemon')
    RETURNING id INTO v_new_id;

    INSERT INTO public.redraft_history
      (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon,
       transfer_type, trade_partner_id, missing_kills_transferred, points_spent)
    VALUES
      (v_season,
       (v_swap->>'player_id')::uuid,
       (v_swap->>'from_tracker_id')::uuid,
       v_hist->>'to_base_pokemon',
       v_hist->>'to_stage3_pokemon',
       v_hist->>'transfer_type',
       (v_hist->>'trade_partner_id')::uuid,
       COALESCE((v_hist->>'missing_kills_transferred')::integer, 0),
       COALESCE((v_hist->>'points_spent')::integer, 0));

    v_new_ids := v_new_ids || to_jsonb(v_new_id);
  END LOOP;

  -- 5.4 Pass 4: delete the source trackers last.
  DELETE FROM public.evolution_tracker WHERE id = ANY(v_from_ids);

  -- 6. Flip status atomically (closes double-execute: no TS revert). The
  --    WHERE status='pending' guard is belt-and-suspenders — the row lock +
  --    step 2 already guarantee it is still pending.
  UPDATE public.redraft_trade_requests
    SET status = 'executed',
        executed_at = now(),
        executed_tracker_ids = v_new_ids
    WHERE id = p_request_id AND status = 'pending';

  -- 7. Return the new tracker ids (audit + caller response).
  RETURN v_new_ids;
END;
$$;

COMMENT ON FUNCTION public.epb_execute_trade_request(uuid, jsonb) IS
  'Atomically execute a consented EPB trade request: row-lock + claim (pending AND both consented), re-check redraft_phase_open, re-check each side''s remaining points IN SQL (mirrors computeRemainingPoints in src/lib/draft/progress-engine.ts — keep in sync), reuse the epb_execute_redraft swap body, then flip status to ''executed''. Any failure rolls the whole transaction back; no TS revert is needed. Service-role only.';