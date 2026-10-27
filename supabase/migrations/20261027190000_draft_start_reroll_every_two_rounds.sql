-- Initial queue drafts: the pick order is drawn again every two rounds.
--
-- Before, draft_start expanded the seats into a plain snake: seats ascending on odd rounds, descending on even rounds,
-- so the seat-1 player picked first in every pair of rounds and the last seat last. Now the snake runs per PAIR of
-- rounds:
--   * rounds 1-2 use the seats as they are at Start (the opening order, rolled or arranged during setup): round 1
--     forward, round 2 reversed;
--   * every following pair (3-4, 5-6, ...) gets a NEW random permutation of the participants, forward in its first
--     round and reversed in its second;
--   * an odd roster size leaves a lone last round: it gets its own fresh permutation and runs forward only.
-- The behaviour depends on the pool alone (draft_start only starts an Initial draft; a Redraft keeps its standings
-- order and is published elsewhere), so there is no new parameter and the signature is unchanged.
--
-- The whole sequence is drawn once, inside the same locked transaction as today, and every slot is materialised up
-- front (sort_key = nominal_pick_number = running index, exactly as before), so makeup, requeue, void, timeout, the
-- open-slot counts and the completability gate see the same shape of queue as they did. One permutation is
-- materialised per pair (one random key per participant and pair), never per slot, so both rounds of a pair share
-- one order. The pair orders are recorded in the existing 'draft_started' audit row (order_mode + pair_orders: one
-- array of participant ids per pair); that row is readable by pool admins only.
--
-- Everything else of draft_start is the definition of 20261018140200_draft_pool_completability.sql, verbatim:
-- checks, the pool-wide completability gate, quiet hours via draft__activate_next, the group-seat guard (a trigger on
-- the move into 'drafting'). Same signature, so CREATE OR REPLACE keeps the function's owner and settings; the
-- privileges are re-issued below for safety (service_role only).
BEGIN;

CREATE OR REPLACE FUNCTION public.draft_start(p_pool_id uuid, p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_n integer; v_current uuid; v_gate jsonb; v_pair_orders jsonb;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'SUBMISSION_PHASE' USING ERRCODE = 'P0001'; END IF;   -- a redraft starts at publish
  IF v_pool.phase <> 'setup' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.list_version_id IS NULL THEN RAISE EXCEPTION 'SEASON_HAS_NO_LIST' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.roster_size IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'roster_size')::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
  IF v_n < 2 THEN RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001'; END IF;

  -- Re-rolled snake: pair k = rounds 2k-1 and 2k. Pair 1 keeps the seats; every later pair is a fresh permutation
  -- (one random key per participant and pair). v_pair_orders = [[player id, ...] per pair, in order of play].
  SELECT jsonb_agg(po.ids ORDER BY po.pair) INTO v_pair_orders
    FROM (SELECT x.pair, jsonb_agg(x.player_id ORDER BY x.pos) AS ids
            FROM (SELECT k.pair, dp.player_id,
                         row_number() OVER (PARTITION BY k.pair
                                            ORDER BY CASE WHEN k.pair = 1 THEN dp.seat END, gen_random_uuid()) AS pos
                    FROM public.draft_participants dp
                         CROSS JOIN generate_series(1, (v_pool.roster_size + 1) / 2) AS k(pair)
                   WHERE dp.draft_pool_id = p_pool_id) x
           GROUP BY x.pair) po;

  -- First round of a pair forward, second round of it reversed (a lone last round: forward only);
  -- sort_key = nominal = running index.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool_id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT (e.pid #>> '{}')::uuid AS player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN e.pos ELSE -e.pos END) AS rn
            FROM generate_series(1, v_pool.roster_size) AS r(round)
                 CROSS JOIN LATERAL jsonb_array_elements(v_pair_orders -> ((r.round + 1) / 2 - 1)) WITH ORDINALITY AS e(pid, pos)) s;
  UPDATE public.draft_participants SET slots_total = v_pool.roster_size, done_at = NULL WHERE draft_pool_id = p_pool_id;

  -- Pool gate over the whole league (every seat: roster_size slots, its budget): refused before anything is visible.
  v_gate := public.draft__pool_completable(p_pool_id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'LEAGUE_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('participants', (v_gate->>'participants')::int, 'slots', (v_gate->>'slots')::int,
                                  'lines', (v_gate->>'lines')::int, 'min_total', (v_gate->>'min_total')::int,
                                  'budget_total', (v_gate->>'budget_total')::int)::text;
  END IF;

  UPDATE public.draft_pools
     SET phase = 'drafting', status = 'in_progress', started_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,
         updated_at = now()
   WHERE id = p_pool_id;
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_started',
    p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'started_at', v_pool.started_at,
                                   'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
    p_after => jsonb_build_object('phase', 'drafting', 'status', 'in_progress', 'participants', v_n,
                                  'roster_size', v_pool.roster_size, 'mode', v_pool.mode,
                                  'order_mode', 'snake_reroll', 'pair_orders', v_pair_orders));
  v_current := public.draft__activate_next(p_pool_id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'active_slot_id', v_current);
END $$;

-- Privileges (unchanged: service_role only) ──────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.draft_start(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draft_start(uuid, uuid) TO service_role;

COMMIT;
