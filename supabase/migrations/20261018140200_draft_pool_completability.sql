-- Draft pool completability (pools must stay completable: no forfeit, a legal pick must always exist).
--
-- Invariant: a queue pool in drafting is always completable. Every participant can fill every open roster slot at
-- once: distinct free lines, each only for a participant allowed to take it (draft_line_restrictions; the redraft lock
-- removes no_redraft lines for everybody), each participant's lines within its remaining budget. Consequences:
--   * the player on the clock always has a legal pick (any line of their own share of a completion), so there is no
--     blocked slot, no blocked_slot pause, no forfeit and no budget-bypass assign any more;
--   * draft_start refuses a league that cannot complete: LEAGUE_NOT_COMPLETABLE {participants, slots, lines};
--   * every pick (player, admin override, correction) is refused when the pool would stop being completable after it:
--     POOL_NOT_COMPLETABLE (the picker's own shortfall keeps INSUFFICIENT_BUDGET / NOT_ENOUGH_LINES / BUDGET_INFEASIBLE);
--   * a void always requeues (requeue = false is INVALID_CONFIG) and is gated too;
--   * redraft publish (admin or the deadline tick) is refused when the published redraft could not complete:
--     REDRAFT_NOT_COMPLETABLE {slots, lines}; the publish rolls back, so the submissions stay secret and editable once
--     the admin moves the deadline. The tick reports the refusal (publish_refused) instead of failing every read, and
--     backs off: it retries the automatic publish only after the pool changed (state_version, e.g. a moved deadline)
--     or an hour later (draft_pools.publish_refused_at / publish_refused_version);
--   * redraft_admin_restore_drop shrinks the roster (the player's queue slot is removed, not forfeited) and is gated;
--   * draft_end aborts: a redraft before publish is cancelled as before; a running initial draft is aborted by voiding
--     every pick and discarding the open queue (the pool is cancelled and can be deleted and drafted again); a running
--     redraft cannot be aborted (DRAFT_ABORT_NOT_ALLOWED). No slot is ever written as forfeited.
--   * draft_admin_resolve_slot is dropped.
-- The CHECK lists keep 'blocked' / 'forfeited' (slot status), 'blocked_slot' (pause reason) and 'slot_blocked' /
-- 'slot_assigned' / 'slot_forfeited' (audit actions) for history; nothing writes them any more.
--
-- The gate is an exact search (draft__completable_search, step-for-step twin of poolCompletability in
-- src/lib/draft/completability.ts; same node counts on the shared vectors). It is capped at 10 000 steps; a search
-- that reaches the cap refuses the action with POOL_CHECK_LIMIT (the gate accepts only a proven completion). On a
-- realistic list of about a hundred lines, a league start takes on the order of a hundred steps (tens of ms in
-- plpgsql), a league too large for the list is refused without a step, and picks of a simulated draft take a few
-- hundred steps at most for an accepted pick.
--
-- 20261012024916, 20261012025023, 20261012094028 and 20261018140100 are applied and immutable. Sections 3-12 replace
-- the latest definitions (named per section) with only the changes their headers name; draft__commit_pick loses its
-- p_bypass_budget parameter, so its old signature is dropped and both callers are replaced.
--
-- Table changes: draft_pools gains publish_refused_at / publish_refused_version (section 0; the tick's backoff). RLS
-- and the service_role-only table grants stay; new columns need no grants. Every new or replaced function is revoked
-- from PUBLIC/anon/authenticated and granted to service_role at the end of this file.
BEGIN;

-- 0. The automatic publish's backoff state ─────────────────────────────────────────────────────────────────────────
-- A refused automatic publish (REDRAFT_NOT_COMPLETABLE / POOL_CHECK_LIMIT) is deterministic while the pool does not
-- change: submissions are locked after the deadline, and a capped refusal costs a 10 000-step search under the season
-- lock (about 4 s). Every snapshot read ticks, so without a backoff each poll of the draft room (and each cron run)
-- would repeat it. The tick records the refusal here and retries only once the pool changed or an hour passed.
ALTER TABLE public.draft_pools
  ADD COLUMN publish_refused_at timestamptz,
  ADD COLUMN publish_refused_version integer;

COMMENT ON COLUMN public.draft_pools.publish_refused_at IS
  'Last refused automatic redraft publish (draft__tick); NULL = none. The tick retries after a pool change or 1 h.';
COMMENT ON COLUMN public.draft_pools.publish_refused_version IS
  'state_version of the pool at publish_refused_at; a different state_version (e.g. a moved deadline) retries at once.';

-- 1. The search (twin of poolCompletability in src/lib/draft/completability.ts, step for step) ──────────────────────
-- p_price / p_line: the free lines (any order). p_slots / p_budget: the participants (open slots, budget left).
-- p_elig: participant-major, p_elig[(b - 1) * n + i] = participant b may take input line i.
-- Returns {"status": "completable" | "not_completable" | "undecided", "nodes": steps}; undecided = the cap was reached.
CREATE OR REPLACE FUNCTION public.draft__completable_search(p_price integer[], p_line text[], p_slots integer[],
  p_budget integer[], p_elig boolean[], p_node_limit integer DEFAULT 10000) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  n integer := COALESCE(array_length(p_price, 1), 0);
  c_portfolio CONSTANT integer := 1500;      -- = PORTFOLIO_STEPS
  v_ord integer[]; v_bins integer[];
  P integer; w integer;
  price integer[]; e boolean[]; sig integer[]; cf integer[]; cb integer[]; pb integer[]; ca integer[];
  nl integer[]; twin boolean[];
  slots integer[]; budget integer[]; orig integer[]; held integer[]; assigned integer[];
  v_open integer := 0; v_nodes integer := 0; v_mode integer; v_stop integer;
  st_i integer[] := '{}'; st_key text[] := '{}'; st_off integer[] := '{}'; st_len integer[] := '{}';
  st_pos integer[] := '{}'; st_app boolean[] := '{}'; v_top integer := 0;
  v_opts integer[] := '{}'; v_optn integer := 0;
  v_m CONSTANT integer := 131072; v_tab text[]; v_h integer;
  b integer; i integer; j integer; k integer; s integer; a integer; x integer; v_ok boolean;
  v_act integer[]; v_sorted integer[]; v_ss integer; v_money integer; v_demand integer; v_lim integer;
  v_key text; v_cand integer[]; v_room numeric[]; v_seen text[]; v_st text; v_unused boolean;
  v_rest integer; v_after integer; v_exp_from integer; v_exp_to integer; v_slack integer; v_usable integer;
  v_cap integer; v_from integer; v_c0 integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unnest(p_slots) z WHERE z > 0) THEN
    RETURN jsonb_build_object('status', 'completable', 'nodes', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM generate_subscripts(p_slots, 1) q WHERE p_slots[q] > 0 AND p_budget[q] < 0) THEN
    RETURN jsonb_build_object('status', 'not_completable', 'nodes', 0);
  END IF;
  SELECT COALESCE(array_agg(q ORDER BY p_price[q] DESC, p_line[q] COLLATE "C"), '{}') INTO v_ord
    FROM generate_subscripts(p_price, 1) q;
  SELECT array_agg(q ORDER BY q) INTO v_bins FROM generate_subscripts(p_slots, 1) q WHERE p_slots[q] > 0;
  P := array_length(v_bins, 1);
  w := n + 1;
  price := array_fill(0, ARRAY[n + 1]);
  FOR i IN 1..n LOOP price[i] := p_price[v_ord[i]]; END LOOP;
  e := array_fill(false, ARRAY[GREATEST(P * n, 1)]);
  FOR b IN 1..P LOOP
    FOR i IN 1..n LOOP e[(b - 1) * n + i] := p_elig[(v_bins[b] - 1) * n + v_ord[i]]; END LOOP;
  END LOOP;
  SELECT array_agg(d ORDER BY q) INTO sig FROM (
    SELECT q, dense_rank() OVER (ORDER BY r COLLATE "C") AS d
      FROM (SELECT q, string_agg(CASE WHEN e[(q - 1) * n + r2] THEN '1' ELSE '0' END, '' ORDER BY r2) AS r
              FROM generate_series(1, P) q LEFT JOIN generate_series(1, n) r2 ON true GROUP BY q) t) u;
  -- rows of width n + 1: cf[b][i] = lines in [i, n] b may take (i = 1..n+1); cb[b][m + 1] = sum of b's m cheapest
  -- lines; pb[b][m + 1] = sum of b's m most expensive lines.
  cf := array_fill(0, ARRAY[P * w]); cb := array_fill(0, ARRAY[P * w]); pb := array_fill(0, ARRAY[P * w]);
  FOR b IN 1..P LOOP
    FOR i IN REVERSE n..1 LOOP
      cf[(b - 1) * w + i] := cf[(b - 1) * w + i + 1] + CASE WHEN e[(b - 1) * n + i] THEN 1 ELSE 0 END;
    END LOOP;
    k := 0;
    FOR i IN REVERSE n..1 LOOP
      IF e[(b - 1) * n + i] THEN k := k + 1; cb[(b - 1) * w + k + 1] := cb[(b - 1) * w + k] + price[i]; END IF;
    END LOOP;
    k := 0;
    FOR i IN 1..n LOOP
      IF e[(b - 1) * n + i] THEN k := k + 1; pb[(b - 1) * w + k + 1] := pb[(b - 1) * w + k] + price[i]; END IF;
    END LOOP;
  END LOOP;
  ca := array_fill(0, ARRAY[w]);
  FOR k IN 1..n LOOP ca[k + 1] := ca[k] + price[n - k + 1]; END LOOP;
  nl := array_fill(n + 1, ARRAY[n + 1]);
  FOR i IN REVERSE (n - 1)..1 LOOP
    nl[i] := CASE WHEN price[i + 1] < price[i] THEN i + 1 ELSE nl[i + 1] END;
  END LOOP;
  twin := array_fill(false, ARRAY[n + 1]);
  FOR i IN 2..n LOOP
    v_ok := price[i] = price[i - 1];
    b := 1;
    WHILE v_ok AND b <= P LOOP
      v_ok := e[(b - 1) * n + i] = e[(b - 1) * n + i - 1];
      b := b + 1;
    END LOOP;
    twin[i] := v_ok;
  END LOOP;

  slots := array_fill(0, ARRAY[P]); budget := array_fill(0, ARRAY[P]); orig := array_fill(0, ARRAY[P]);
  held := array_fill(0, ARRAY[P]);
  FOR b IN 1..P LOOP
    slots[b] := p_slots[v_bins[b]]; orig[b] := slots[b]; budget[b] := p_budget[v_bins[b]];
    v_open := v_open + slots[b];
  END LOOP;
  assigned := array_fill(0, ARRAY[n + 1]);   -- 0 = unused / not decided, else the participant
  v_tab := array_fill(NULL::text, ARRAY[v_m]);

  FOR v_mode IN 0..2 LOOP
    v_stop := CASE WHEN v_mode = 2 THEN p_node_limit ELSE LEAST(p_node_limit, v_nodes + c_portfolio) END;
    i := 1;
    <<search>>
    LOOP
      -- ── enter(i): memo, bound, options ────────────────────────────────────────────────────────────────────────
      IF i IS NOT NULL THEN
        SELECT i::text || CASE WHEN i <= n AND twin[i] AND assigned[i - 1] = 0 THEN '!' ELSE ':' END
               || COALESCE(string_agg(t, ';' ORDER BY t COLLATE "C"), '')
          INTO v_key
          FROM (SELECT slots[q]::text || '/' || CASE WHEN slots[q] = 0 THEN '-' ELSE budget[q]::text END || '/'
                       || sig[q]::text || '/'
                       || CASE WHEN held[q] = 0 THEN '0' WHEN i <= n AND held[q] > price[i] THEN '2' ELSE '1' END AS t
                  FROM generate_series(1, P) q WHERE slots[q] > 0 OR held[q] > 0) z;
        v_h := (hashtext(v_key) & (v_m - 1)) + 1;
        v_ok := true;
        WHILE v_tab[v_h] IS NOT NULL LOOP
          IF v_tab[v_h] = v_key THEN v_ok := false; EXIT; END IF;
          v_h := CASE WHEN v_h = v_m THEN 1 ELSE v_h + 1 END;
        END LOOP;
        IF v_ok THEN
          -- bound(i)
          IF n - i + 1 < v_open THEN v_ok := false; END IF;
          v_act := '{}';
          IF v_ok THEN
            FOR b IN 1..P LOOP
              CONTINUE WHEN slots[b] = 0;
              IF cf[(b - 1) * w + i] < slots[b] OR cb[(b - 1) * w + slots[b] + 1] > budget[b] THEN
                v_ok := false; EXIT;
              END IF;
              v_act := v_act || b;
            END LOOP;
          END IF;
          IF v_ok THEN                                -- subset prefixes by budget per slot
            SELECT array_agg(q ORDER BY budget[q]::numeric / slots[q], q) INTO v_sorted FROM unnest(v_act) q;
            v_ss := 0; v_money := 0;
            FOREACH b IN ARRAY v_sorted LOOP
              v_ss := v_ss + slots[b]; v_money := v_money + budget[b];
              IF ca[v_ss + 1] > v_money THEN v_ok := false; EXIT; END IF;
            END LOOP;
          END IF;
          IF v_ok THEN                                -- … and by room over the cheapest completion
            SELECT array_agg(q ORDER BY budget[q] - ca[slots[q] + 1], q) INTO v_sorted FROM unnest(v_act) q;
            v_ss := 0; v_money := 0;
            FOREACH b IN ARRAY v_sorted LOOP
              v_ss := v_ss + slots[b]; v_money := v_money + budget[b];
              IF ca[v_ss + 1] > v_money THEN v_ok := false; EXIT; END IF;
            END LOOP;
          END IF;
          IF v_ok THEN                                -- fill
            v_money := 0;
            FOREACH b IN ARRAY v_act LOOP v_money := v_money + budget[b]; END LOOP;
            v_slack := v_money - ca[v_open + 1];
            v_usable := price[n - v_open + 1] + v_slack;
            FOREACH b IN ARRAY v_act LOOP
              s := slots[b];
              v_cap := LEAST(v_usable, budget[b] - cb[(b - 1) * w + s]);
              v_from := i;
              WHILE v_from <= n AND price[v_from] > v_cap LOOP v_from := nl[v_from]; END LOOP;
              v_c0 := cf[(b - 1) * w + 1] - cf[(b - 1) * w + v_from];
              IF cf[(b - 1) * w + v_from] < s
                 OR pb[(b - 1) * w + v_c0 + s + 1] - pb[(b - 1) * w + v_c0 + 1] < budget[b] - v_slack THEN
                v_ok := false; EXIT;
              END IF;
            END LOOP;
          END IF;
          IF v_ok THEN                                -- demand below each price step
            j := i;
            WHILE j <= n AND v_ok LOOP
              k := nl[j];
              v_demand := 0;
              FOREACH b IN ARRAY v_act LOOP
                s := slots[b];
                v_exp_from := cf[(b - 1) * w + 1] - cf[(b - 1) * w + i];
                v_exp_to := cf[(b - 1) * w + 1] - cf[(b - 1) * w + k];
                v_lim := LEAST(s, cf[(b - 1) * w + k]);
                a := GREATEST(0, s - (v_exp_to - v_exp_from));
                WHILE a <= v_lim
                      AND cb[(b - 1) * w + a + 1] + pb[(b - 1) * w + v_exp_to + 1] - pb[(b - 1) * w + v_exp_to - (s - a) + 1]
                          > budget[b] LOOP
                  a := a + 1;
                END LOOP;
                IF a > v_lim THEN v_ok := false; EXIT; END IF;
                v_demand := v_demand + a;
              END LOOP;
              IF v_ok AND v_demand > n - k + 1 THEN v_ok := false; END IF;
              j := k;
            END LOOP;
          END IF;
          IF NOT v_ok THEN                            -- remember the pruned state
            v_h := (hashtext(v_key) & (v_m - 1)) + 1;
            WHILE v_tab[v_h] IS NOT NULL LOOP v_h := CASE WHEN v_h = v_m THEN 1 ELSE v_h + 1 END; END LOOP;
            v_tab[v_h] := v_key;
          END IF;
        END IF;
        IF v_ok THEN
          -- options(i): 0 = leave unused, else a participant in this ordering's order, identical states once
          v_unused := n - i >= v_open;
          b := 1;
          WHILE v_unused AND b <= P LOOP
            IF e[(b - 1) * n + i] AND held[b] > price[i] THEN v_unused := false; END IF;
            b := b + 1;
          END LOOP;
          k := 0;
          IF v_unused THEN v_optn := v_optn + 1; v_opts[v_optn] := 0; k := 1; END IF;
          IF NOT (twin[i] AND assigned[i - 1] = 0) THEN
            v_cand := '{}'; v_room := '{}'; v_seen := '{}';
            FOR b IN 1..P LOOP
              CONTINUE WHEN slots[b] = 0 OR NOT e[(b - 1) * n + i];
              v_rest := slots[b] - 1; v_after := budget[b] - price[i];
              CONTINUE WHEN v_after < 0 OR cf[(b - 1) * w + i + 1] < v_rest OR cb[(b - 1) * w + v_rest + 1] > v_after;
              v_st := slots[b]::text || '/' || budget[b]::text || '/' || sig[b]::text || '/'
                      || CASE WHEN held[b] = 0 THEN '0' WHEN held[b] > price[i] THEN '2' ELSE '1' END;
              CONTINUE WHEN v_st = ANY (v_seen);
              v_seen := v_seen || v_st;
              v_cand := v_cand || b;
              v_room := v_room || CASE v_mode
                                    WHEN 0 THEN -(v_after - cb[(b - 1) * w + v_rest + 1])::numeric
                                    WHEN 1 THEN (v_after - cb[(b - 1) * w + v_rest + 1])::numeric
                                    ELSE -((v_after - cb[(b - 1) * w + v_rest + 1])::numeric / (v_rest + 2)) END;
            END LOOP;
            FOR x IN SELECT v_cand[q] FROM generate_subscripts(v_cand, 1) q ORDER BY v_room[q], v_cand[q] LOOP
              v_optn := v_optn + 1; v_opts[v_optn] := x; k := k + 1;
            END LOOP;
          END IF;
          v_top := v_top + 1;
          st_i[v_top] := i; st_key[v_top] := v_key; st_off[v_top] := v_optn - k; st_len[v_top] := k;
          st_pos[v_top] := 0; st_app[v_top] := false;
        ELSIF v_top = 0 THEN
          RETURN jsonb_build_object('status', 'not_completable', 'nodes', v_nodes);
        END IF;
        i := NULL;
      END IF;

      -- ── step the top frame ────────────────────────────────────────────────────────────────────────────────────
      EXIT search WHEN v_top = 0;
      k := st_i[v_top];
      IF st_app[v_top] THEN
        b := v_opts[st_off[v_top] + st_pos[v_top]];
        IF b > 0 THEN
          slots[b] := slots[b] + 1; budget[b] := budget[b] + price[k]; v_open := v_open + 1; assigned[k] := 0;
          IF slots[b] = orig[b] THEN held[b] := 0; END IF;
        END IF;
        st_app[v_top] := false;
      END IF;
      st_pos[v_top] := st_pos[v_top] + 1;
      IF st_pos[v_top] > st_len[v_top] THEN          -- exhausted: remember the state, pop
        v_h := (hashtext(st_key[v_top]) & (v_m - 1)) + 1;
        WHILE v_tab[v_h] IS NOT NULL LOOP v_h := CASE WHEN v_h = v_m THEN 1 ELSE v_h + 1 END; END LOOP;
        v_tab[v_h] := st_key[v_top];
        v_optn := st_off[v_top];
        v_top := v_top - 1;
        CONTINUE search;
      END IF;
      EXIT search WHEN v_nodes >= v_stop;            -- this ordering's step budget is spent
      v_nodes := v_nodes + 1;
      b := v_opts[st_off[v_top] + st_pos[v_top]];
      IF b > 0 THEN
        slots[b] := slots[b] - 1; budget[b] := budget[b] - price[k]; v_open := v_open - 1; assigned[k] := b;
        IF held[b] = 0 THEN held[b] := price[k]; END IF;
      END IF;
      st_app[v_top] := true;
      IF v_open = 0 THEN RETURN jsonb_build_object('status', 'completable', 'nodes', v_nodes); END IF;
      i := k + 1;
    END LOOP;
    IF v_top = 0 THEN RETURN jsonb_build_object('status', 'not_completable', 'nodes', v_nodes); END IF;
    -- unwind to the start state for the next ordering
    WHILE v_top > 0 LOOP
      IF st_app[v_top] THEN
        b := v_opts[st_off[v_top] + st_pos[v_top]];
        k := st_i[v_top];
        IF b > 0 THEN
          slots[b] := slots[b] + 1; budget[b] := budget[b] + price[k]; v_open := v_open + 1; assigned[k] := 0;
          IF slots[b] = orig[b] THEN held[b] := 0; END IF;
        END IF;
      END IF;
      v_top := v_top - 1;
    END LOOP;
    v_optn := 0;
  END LOOP;
  RETURN jsonb_build_object('status', 'undecided', 'nodes', v_nodes);
END $$;

-- 2. A pool's current state through the search ─────────────────────────────────────────────────────────────────────
-- Free lines = lines of the pool's list that no tracker of the season and no live pick of the pool holds, without the
-- lines a redraft locks for everybody (no_redraft). Participants = every seat with its open slots and budget left; a
-- participant may not take its restricted lines. Returns the search result plus the totals the error messages quote.
CREATE OR REPLACE FUNCTION public.draft__pool_completable(p_pool_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_price integer[]; v_line text[]; v_players uuid[]; v_slots integer[]; v_budget integer[]; v_elig boolean[];
        v_res jsonb; v_n integer; v_active integer; v_open integer; v_money integer; v_min integer;
BEGIN
  SELECT COALESCE(array_agg(e.price::int ORDER BY e.line_id COLLATE "C"), '{}'),
         COALESCE(array_agg(e.line_id ORDER BY e.line_id COLLATE "C"), '{}')
    INTO v_price, v_line
    FROM public.draft_pools p JOIN public.point_buy_list_entries e ON e.list_version_id = p.list_version_id
   WHERE p.id = p_pool_id
     AND NOT EXISTS (SELECT 1 FROM public.evolution_tracker t WHERE t.season_id = p.season_id AND t.line_id = e.line_id)
     AND NOT EXISTS (SELECT 1 FROM public.draft_picks dp WHERE dp.draft_pool_id = p.id AND dp.line_id = e.line_id
                                                          AND dp.voided_at IS NULL)
     AND NOT (p.kind = 'redraft' AND p.redraft_lock_no_redraft_lines AND COALESCE((e.special_rules->>'no_redraft')::boolean, false));
  SELECT COALESCE(array_agg(x.player_id ORDER BY x.seat), '{}'), COALESCE(array_agg(x.open ORDER BY x.seat), '{}'),
         COALESCE(array_agg(x.budget ORDER BY x.seat), '{}')
    INTO v_players, v_slots, v_budget
    FROM (SELECT dp.player_id, dp.seat, public.draft__open_slots(p_pool_id, dp.player_id) AS open,
                 COALESCE(public.draft__remaining_budget(p_pool_id, dp.player_id), 0) AS budget
            FROM public.draft_participants dp WHERE dp.draft_pool_id = p_pool_id) x;
  SELECT COALESCE(array_agg(NOT EXISTS (SELECT 1 FROM public.draft_line_restrictions r
                                         WHERE r.draft_pool_id = p_pool_id AND r.player_id = pl.player_id
                                           AND r.line_id = l.line_id)
                            ORDER BY pl.ord, l.ord), '{}')
    INTO v_elig
    FROM unnest(v_players) WITH ORDINALITY AS pl(player_id, ord)
    CROSS JOIN unnest(v_line) WITH ORDINALITY AS l(line_id, ord);

  v_res := public.draft__completable_search(v_price, v_line, v_slots, v_budget, v_elig);
  v_n := COALESCE(array_length(v_price, 1), 0);
  SELECT count(*) FILTER (WHERE s > 0), COALESCE(sum(s) FILTER (WHERE s > 0), 0), COALESCE(sum(b) FILTER (WHERE s > 0), 0)
    INTO v_active, v_open, v_money
    FROM unnest(v_slots, v_budget) AS z(s, b);
  IF v_n >= v_open THEN
    SELECT COALESCE(sum(pr), 0) INTO v_min FROM (SELECT pr FROM unnest(v_price) pr ORDER BY pr LIMIT v_open) c;
  END IF;
  RETURN v_res || jsonb_build_object('participants', v_active, 'slots', v_open, 'lines', v_n, 'min_total', v_min,
                                     'budget_total', v_money);
END $$;

-- 3. draft__activate_next (base 20261018140100): no blocked state ──────────────────────────────────────────────────
-- The pool is completable whenever a slot activates, so its player has a legal pick (any line of their own share of a
-- completion). A player whose own cheapest completion does not fit is an invariant breach: a coded internal error (a
-- logged 500), never a pause.
CREATE OR REPLACE FUNCTION public.draft__activate_next(p_pool_id uuid, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_open integer; v_rem integer; v_cnt integer; v_cost integer;
        v_secs integer; v_mask smallint;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked')) THEN
    RAISE EXCEPTION 'ACTIVE_SLOT_EXISTS' USING ERRCODE = 'P0001';                       -- invariant (internal)
  END IF;

  SELECT * INTO v_slot FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.draft_pools
       SET phase = 'complete', status = 'complete', ended_at = p_at, paused_at = NULL, paused_by = NULL, pause_reason = NULL,
           updated_at = now()
     WHERE id = p_pool_id;
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, p_at) WHERE draft_pool_id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, NULL, 'system', 'draft_ended',
      p_after => jsonb_build_object('reason', 'queue_empty'));
    RETURN NULL;
  END IF;

  v_open := public.draft__open_slots(p_pool_id, v_slot.player_id);
  v_rem := COALESCE(public.draft__remaining_budget(p_pool_id, v_slot.player_id), 0);
  SELECT m.cnt, m.cost INTO v_cnt, v_cost FROM public.draft__min_completion(p_pool_id, v_slot.player_id, v_open, NULL) m;
  IF v_cnt < v_open OR v_cost > v_rem THEN
    RAISE EXCEPTION 'COMPLETABILITY_INVARIANT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('pool_id', p_pool_id, 'slot_id', v_slot.id, 'player_id', v_slot.player_id,
                                  'open_slots', v_open, 'remaining', v_rem, 'available', v_cnt, 'min_cost', v_cost)::text;
  END IF;

  v_secs := public.draft__slot_seconds(v_pool, v_slot.player_id, v_slot.kind);
  -- Reminder bits already "sent or not applicable": slow → thresholds the timer never reaches; live → none are sent.
  v_mask := CASE WHEN v_pool.mode = 'slow'
                 THEN ((v_secs <= 28800)::int | ((v_secs <= 14400)::int << 1) | ((v_secs <= 3600)::int << 2))::smallint
                 ELSE 7::smallint END;
  UPDATE public.draft_slots
     SET status = 'active', timer_seconds = v_secs, started_at = p_at, extension_seconds = 0,
         deadline_at = CASE WHEN v_pool.paused_at IS NULL                                  -- quiet hours: running time
                             THEN public.draft__add_running_ms(p_at, v_secs::bigint * 1000, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone)
                             ELSE NULL END,
         remaining_ms_at_pause = CASE WHEN v_pool.paused_at IS NULL THEN NULL ELSE v_secs * 1000 END,
         reminder_mask = v_mask, notified_turn_at = NULL   -- every (re)activation is a new turn: one fresh turn ping
   WHERE id = v_slot.id;
  RETURN v_slot.id;
END $$;

-- 4. draft__commit_pick (base 20261012024916): no budget bypass; the pool gate after the pick ───────────────────────
-- The old signature carried p_bypass_budget (true only for the retired blocked-slot "assign"). Every caller is replaced
-- below, so the old function goes and the new one has no bypass at all.
DROP FUNCTION public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, boolean,
  text, text);
CREATE OR REPLACE FUNCTION public.draft__commit_pick(
  p_pool public.draft_pools, p_slot public.draft_slots, p_entry_id uuid, p_actor_id uuid, p_actor_role text,
  p_client_request_id uuid, p_redraft_slot_id uuid, p_line_thresholds jsonb, p_action text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry public.point_buy_list_entries; v_player uuid := p_slot.player_id; v_owner uuid; v_restriction text;
  v_open integer; v_rem integer; v_cnt integer; v_cost integer; v_size smallint;
  v_rslot public.redraft_slots; v_transfer integer := 0; v_stage integer := 1; v_form text; v_s2 integer; v_s3 integer;
  v_pick_no integer; v_pick_id uuid; v_tracker_id uuid; v_next uuid; v_pool public.draft_pools; v_gate jsonb;
BEGIN
  SELECT * INTO v_entry FROM public.point_buy_list_entries WHERE id = p_entry_id AND list_version_id = p_pool.list_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;

  -- 1. one owner per line per season (BR-3)
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = p_pool.season_id AND t.line_id = v_entry.line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool.id AND k.line_id = v_entry.line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'player_id', v_owner)::text;
  END IF;

  -- 2. restrictions
  SELECT r.reason INTO v_restriction FROM public.draft_line_restrictions r
   WHERE r.draft_pool_id = p_pool.id AND r.player_id = v_player AND r.line_id = v_entry.line_id;
  IF v_restriction = 'own_redraft_drop' THEN RAISE EXCEPTION 'OWN_REDRAFT_DROP' USING ERRCODE = 'P0001'; END IF;
  IF v_restriction IS NOT NULL THEN RAISE EXCEPTION 'LINE_RESTRICTED' USING ERRCODE = 'P0001'; END IF;

  -- 3. redraft lock (Cosmog: special_rules.no_redraft, stored by the importer)
  IF p_pool.kind = 'redraft' AND p_pool.redraft_lock_no_redraft_lines
     AND COALESCE((v_entry.special_rules->>'no_redraft')::boolean, false) THEN
    RAISE EXCEPTION 'COSMOG_REDRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  -- 4. roster
  v_open := public.draft__open_slots(p_pool.id, v_player);
  IF v_open < 1 THEN
    SELECT slots_total INTO v_size FROM public.draft_participants WHERE draft_pool_id = p_pool.id AND player_id = v_player;
    RAISE EXCEPTION 'ROSTER_FULL' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('size', COALESCE(v_size, 0))::text;
  END IF;

  -- 5. the picker's own budget + completion check (twin of evaluateCompletion in budget.ts); the pool gate is step 10b
  v_rem := COALESCE(public.draft__remaining_budget(p_pool.id, v_player), 0);
  IF v_entry.price > v_rem THEN
    RAISE EXCEPTION 'INSUFFICIENT_BUDGET' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('price', v_entry.price, 'remaining', v_rem)::text;
  END IF;
  SELECT m.cnt, m.cost INTO v_cnt, v_cost FROM public.draft__min_completion(p_pool.id, v_player, v_open - 1, v_entry.line_id) m;
  IF v_cnt < v_open - 1 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_LINES' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('slots', v_open - 1, 'available', v_cnt)::text;
  END IF;
  IF v_cost > v_rem - v_entry.price THEN
    RAISE EXCEPTION 'BUDGET_INFEASIBLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('shortfall', v_cost - (v_rem - v_entry.price), 'slots', v_open - 1,
                                  'remaining_after', v_rem - v_entry.price, 'min_cost', v_cost)::text;
  END IF;

  -- 6. redraft slot (the slot-bound real-kill transfer, SPEC:757-770)
  IF p_pool.kind = 'redraft' THEN
    IF p_redraft_slot_id IS NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO v_rslot FROM public.redraft_slots WHERE id = p_redraft_slot_id FOR UPDATE;
    IF NOT FOUND OR v_rslot.draft_pool_id <> p_pool.id OR v_rslot.player_id <> v_player THEN
      RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_rslot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
    v_transfer := v_rslot.transferred_real_kills;
  ELSIF p_redraft_slot_id IS NOT NULL THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- 7. stage reached by the transfer (cumulative thresholds, override applied by TS effectiveThresholds)
  IF v_transfer > 0 THEN
    IF p_line_thresholds IS NULL OR p_line_thresholds->>'line_id' IS DISTINCT FROM v_entry.line_id
       OR jsonb_typeof(p_line_thresholds->'stage2_kos') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'THRESHOLDS_REQUIRED' USING ERRCODE = 'P0001';                    -- internal: the route must pass them
    END IF;
    v_s2 := (p_line_thresholds->>'stage2_kos')::int;
    v_s3 := CASE WHEN jsonb_typeof(p_line_thresholds->'stage3_kos') = 'number' THEN (p_line_thresholds->>'stage3_kos')::int END;
    v_stage := CASE WHEN v_s3 IS NOT NULL AND v_entry.stage3_pokemon IS NOT NULL AND v_transfer >= v_s3 THEN 3
                    WHEN v_transfer >= v_s2 THEN 2 ELSE 1 END;
  END IF;
  v_form := CASE v_stage WHEN 3 THEN v_entry.stage3_pokemon WHEN 2 THEN v_entry.stage2_pokemon ELSE v_entry.base_pokemon END;

  -- 8. the pick
  SELECT COALESCE(max(pick_number), 0) + 1 INTO v_pick_no FROM public.draft_picks
   WHERE draft_pool_id = p_pool.id AND voided_at IS NULL;
  INSERT INTO public.draft_picks (draft_pool_id, player_id, pokemon_name, pick_number, round, points_spent, line_id,
    line_entry_id, slot_id, redraft_slot_id, client_request_id, made_by, made_by_role, override_reason)
  VALUES (p_pool.id, v_player, v_entry.base_pokemon, v_pick_no, p_slot.round, v_entry.price, v_entry.line_id,
    v_entry.id, p_slot.id, p_redraft_slot_id, p_client_request_id, p_actor_id, p_actor_role,
    CASE WHEN p_actor_role = 'admin' THEN left(p_reason, 500) END)
  RETURNING id INTO v_pick_id;

  -- 9. the tracker (real kills start at 0; a redraft transfer is evolution progress only, SPEC:859-867)
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, current_stage, total_kos, real_kills,
    transferred_evo_progress, locked_stage3_pokemon, line_id, redraft_slot_id, evolved_at)
  VALUES (p_pool.season_id, v_player, v_entry.base_pokemon, v_form, v_stage, v_transfer, 0, v_transfer,
    v_entry.stage3_pokemon, v_entry.line_id, CASE WHEN p_pool.kind = 'redraft' THEN p_redraft_slot_id END,
    CASE WHEN v_stage > 1 THEN now() END)
  RETURNING id INTO v_tracker_id;
  IF v_transfer > 0 THEN
    INSERT INTO public.evo_progress_log (tracker_id, season_id, matchday, source, amount, note, created_by)
    VALUES (v_tracker_id, p_pool.season_id, NULL, 'transferred', v_transfer, 'Redraft slot ' || v_rslot.label, p_actor_id);
  END IF;
  IF v_stage > 1 THEN
    INSERT INTO public.evolution_events (season_id, matchday, tracker_id, player_id, base_pokemon, previous_form, new_form,
      previous_stage, new_stage, total_kos, is_devolution, is_manual)
    VALUES (p_pool.season_id, NULL, v_tracker_id, v_player, v_entry.base_pokemon, v_entry.base_pokemon, v_form,
      1, v_stage, v_transfer, false, false);
  END IF;

  -- 10. close the slot
  IF v_rslot.id IS NOT NULL THEN
    UPDATE public.redraft_slots SET filled_by_pick_id = v_pick_id WHERE id = v_rslot.id;
  END IF;
  UPDATE public.draft_slots
     SET status = 'done', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL
   WHERE id = p_slot.id;
  IF public.draft__open_slots(p_pool.id, v_player) = 0 THEN
    UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND player_id = v_player;
  END IF;

  -- 10b. pool gate: after this pick every participant must still be able to fill every open slot. A refusal rolls the
  --      whole pick back (one statement, one transaction).
  v_gate := public.draft__pool_completable(p_pool.id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'player_id', v_player)::text;
  END IF;

  -- 11. audit
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, p_action,
    p_player_id => v_player, p_slot_id => p_slot.id, p_pick_id => v_pick_id, p_line_id => v_entry.line_id,
    p_after => jsonb_build_object('price', v_entry.price, 'pick_number', v_pick_no, 'redraft_slot_label', v_rslot.label,
                                  'transfer', v_transfer, 'stage', v_stage),
    p_reason => p_reason, p_client_request_id => p_client_request_id);

  -- 12. next slot
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool.id
  RETURNING * INTO v_pool;

  -- 13.
  RETURN jsonb_build_object('pick_id', v_pick_id, 'tracker_id', v_tracker_id, 'line_id', v_entry.line_id,
    'pick_number', v_pick_no, 'player_id', v_player, 'price', v_entry.price, 'stage', v_stage, 'replay', false,
    'next_slot_id', v_next, 'completed', v_pool.phase = 'complete', 'state_version', v_pool.state_version);
END $$;

-- 5. draft_confirm_pick (base 20261012024916): the new commit_pick; no blocked slot ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_confirm_pick(
  p_pool_id uuid, p_slot_id uuid, p_player_id uuid, p_actor_id uuid, p_actor_role text,
  p_line_id text, p_client_request_id uuid,
  p_redraft_slot_id uuid DEFAULT NULL, p_line_thresholds jsonb DEFAULT NULL, p_override_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_existing public.draft_picks; v_entry_id uuid;
BEGIN
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('player', 'admin')
     OR (p_actor_role = 'player' AND p_actor_id IS DISTINCT FROM p_player_id) THEN
    RAISE EXCEPTION 'ACTOR_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor_role = 'admin' AND p_actor_id IS DISTINCT FROM p_player_id AND COALESCE(btrim(p_override_reason), '') = '' THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  -- Idempotency (SPEC:1007-1014): the same request id returns the first result and never writes again.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks
     WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_existing.player_id <> p_player_id OR v_existing.line_id IS DISTINCT FROM p_line_id THEN
        RAISE EXCEPTION 'REQUEST_ID_REUSED' USING ERRCODE = 'P0001';
      END IF;
      RETURN jsonb_build_object('pick_id', v_existing.id, 'line_id', v_existing.line_id, 'pick_number', v_existing.pick_number,
        'player_id', v_existing.player_id, 'price', COALESCE(v_existing.points_spent, 0), 'replay', true,
        'voided', v_existing.voided_at IS NOT NULL, 'completed', v_pool.phase = 'complete',
        'state_version', v_pool.state_version);
    END IF;
  END IF;

  PERFORM public.draft__resolve_timeouts(p_pool_id);
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF v_pool.phase = 'complete' THEN RAISE EXCEPTION 'DRAFT_COMPLETE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'submissions' THEN RAISE EXCEPTION 'SUBMISSION_PHASE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'setup' THEN RAISE EXCEPTION 'DRAFT_NOT_STARTED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'DRAFT_PAUSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('reason', v_pool.pause_reason)::text;
  END IF;
  SELECT * INTO v_slot FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.id <> p_slot_id THEN
    RAISE EXCEPTION 'STALE_SLOT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('current_slot_id', v_slot.id, 'current_player_id', v_slot.player_id)::text;
  END IF;
  IF v_slot.player_id <> p_player_id THEN RAISE EXCEPTION 'NOT_YOUR_TURN' USING ERRCODE = 'P0001'; END IF;

  SELECT id INTO v_entry_id FROM public.point_buy_list_entries WHERE list_version_id = v_pool.list_version_id AND line_id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
  RETURN public.draft__commit_pick(v_pool, v_slot, v_entry_id, p_actor_id, p_actor_role, p_client_request_id,
    p_redraft_slot_id, p_line_thresholds,
    CASE WHEN p_actor_role = 'admin' AND p_actor_id IS DISTINCT FROM p_player_id THEN 'pick_admin_override' ELSE 'pick_confirmed' END,
    p_override_reason);
END $$;

-- 6. draft_start (base 20261012024916): a league that cannot complete does not start ────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_start(p_pool_id uuid, p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_n integer; v_current uuid; v_gate jsonb;
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

  -- §5.2 snake: seats ascending on odd rounds, descending on even rounds; sort_key = nominal = running index.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool_id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT dp.player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn
            FROM public.draft_participants dp CROSS JOIN generate_series(1, v_pool.roster_size) AS r(round)
           WHERE dp.draft_pool_id = p_pool_id) s;
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
                                  'roster_size', v_pool.roster_size, 'mode', v_pool.mode));
  v_current := public.draft__activate_next(p_pool_id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'active_slot_id', v_current);
END $$;

-- 7. draft_end (base 20261012024916): abort only, never a forfeit ──────────────────────────────────────────────────
--   * submissions (redraft before publish): cancel, as before;
--   * drafting, initial draft: abort = the draft never happened. Every live pick is voided (its tracker removed, as a
--     void does; a tracker with progress refuses with VOID_BLOCKED_PROGRESS), the open queue is discarded and the pool
--     is cancelled, so it can be deleted and drafted again. No slot is forfeited.
--   * drafting, redraft: refused (DRAFT_ABORT_NOT_ALLOWED): the published drops already left the rosters; pause,
--     correct picks and restore drops instead. A completable redraft always finishes.
CREATE OR REPLACE FUNCTION public.draft_end(p_pool_id uuid, p_actor_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_pick public.draft_picks; v_tracker public.evolution_tracker; v_progress integer;
        v_voided integer := 0; v_discarded integer := 0;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'DRAFT_ABORT_NOT_ALLOWED' USING ERRCODE = 'P0001'; END IF;
    FOR v_pick IN SELECT * FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND voided_at IS NULL
                   ORDER BY pick_number FOR UPDATE LOOP
      SELECT * INTO v_tracker FROM public.evolution_tracker
       WHERE season_id = v_pool.season_id AND line_id = v_pick.line_id FOR UPDATE;
      IF FOUND THEN
        IF v_tracker.player_id <> v_pick.player_id THEN
          RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('line_id', v_pick.line_id, 'player_id', v_tracker.player_id)::text;
        END IF;
        v_progress := v_tracker.real_kills + v_tracker.draft_tokens + v_tracker.kill_tokens + v_tracker.cosmo_points;
        IF v_progress > 0 THEN
          RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('progress', v_progress, 'line_id', v_pick.line_id)::text;
        END IF;
        DELETE FROM public.evolution_tracker WHERE id = v_tracker.id;
      END IF;
      UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id, void_reason = left(p_reason, 500)
       WHERE id = v_pick.id;
      v_voided := v_voided + 1;
    END LOOP;
    DELETE FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('pending', 'active');
    GET DIAGNOSTICS v_discarded = ROW_COUNT;
    UPDATE public.draft_pools
       SET phase = 'cancelled', status = 'complete', ended_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,
           updated_at = now()
     WHERE id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_cancelled',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at,
                                     'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
      p_after => jsonb_build_object('phase', 'cancelled', 'status', 'complete', 'reason', 'admin_abort',
                                    'voided_picks', v_voided, 'discarded_slots', v_discarded), p_reason => p_reason);
  ELSIF v_pool.phase = 'submissions' THEN
    UPDATE public.draft_pools SET phase = 'cancelled', status = 'complete', ended_at = now(), updated_at = now()
     WHERE id = p_pool_id;                                              -- submissions stay for the audit
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_cancelled',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at),
      p_after => jsonb_build_object('phase', 'cancelled', 'status', 'complete'), p_reason => p_reason);
  ELSIF v_pool.phase = 'setup' THEN
    RAISE EXCEPTION 'DRAFT_NOT_STARTED' USING ERRCODE = 'P0001';
  ELSE
    RAISE EXCEPTION 'DRAFT_COMPLETE' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'phase', v_pool.phase);
END $$;

-- 8. draft_admin_void_pick (base 20261012024916): requeue only, then the pool gate ─────────────────────────────────
-- A void always gives the player the opportunity back (requeue). p_requeue stays in the signature for the route
-- contract; false is INVALID_CONFIG {field: requeue}. Requeue keeps a completable pool completable (the voided line
-- returns with the slot and the budget), and the gate checks it anyway; a correction's replacement pick is gated by
-- draft__commit_pick.
CREATE OR REPLACE FUNCTION public.draft_admin_void_pick(p_pool_id uuid, p_pick_id uuid, p_actor_id uuid, p_reason text,
  p_requeue boolean, p_replacement_line_id text DEFAULT NULL, p_replacement_thresholds jsonb DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_pick public.draft_picks; v_existing public.draft_picks; v_tracker public.evolution_tracker;
        v_has_tracker boolean; v_progress integer; v_src public.draft_slots; v_current public.draft_slots;
        v_anchor public.draft_slots; v_prev numeric; v_key numeric; v_r uuid; v_r_slot public.draft_slots;
        v_secs integer; v_entry_id uuid; v_commit jsonb := NULL; v_gate jsonb;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_requeue IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'requeue')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  -- A replayed correction returns the first result.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('replay', true, 'pick_id', v_existing.id, 'state_version', v_pool.state_version);
    END IF;
  END IF;

  SELECT * INTO v_pick FROM public.draft_picks WHERE id = p_pick_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PICK_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pick.voided_at IS NOT NULL THEN RAISE EXCEPTION 'PICK_ALREADY_VOIDED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    IF v_pool.paused_at IS NULL THEN RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001'; END IF;
  ELSIF v_pool.phase <> 'complete' THEN
    RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tracker FROM public.evolution_tracker
   WHERE season_id = v_pool.season_id AND line_id = v_pick.line_id FOR UPDATE;
  v_has_tracker := FOUND;
  IF v_has_tracker THEN
    IF v_tracker.player_id <> v_pick.player_id THEN                    -- the line moved on: never touch it
      RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('line_id', v_pick.line_id, 'player_id', v_tracker.player_id)::text;
    END IF;
    v_progress := v_tracker.real_kills + v_tracker.draft_tokens + v_tracker.kill_tokens + v_tracker.cosmo_points;
    IF v_progress > 0 THEN
      RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('progress', v_progress)::text;
    END IF;
  END IF;

  UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id, void_reason = left(p_reason, 500) WHERE id = p_pick_id;
  IF v_has_tracker THEN DELETE FROM public.evolution_tracker WHERE id = v_tracker.id; END IF;
  UPDATE public.redraft_slots SET filled_by_pick_id = NULL WHERE filled_by_pick_id = p_pick_id;
  SELECT * INTO v_src FROM public.draft_slots WHERE id = v_pick.slot_id;

  -- requeue: the current slot goes back to pending and R goes directly before it (else to the end)
  SELECT * INTO v_current FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.draft_slots
       SET status = 'pending', timer_seconds = NULL, started_at = NULL, deadline_at = NULL, remaining_ms_at_pause = NULL,
           extension_seconds = 0
     WHERE id = v_current.id;
  END IF;
  SELECT * INTO v_anchor FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1;
  IF FOUND THEN
    SELECT max(sort_key) INTO v_prev FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key < v_anchor.sort_key;
    v_key := CASE WHEN v_prev IS NULL THEN v_anchor.sort_key - 1 ELSE (v_prev + v_anchor.sort_key) / 2 END;
  ELSE
    SELECT COALESCE(max(sort_key), 0) + 1 INTO v_key FROM public.draft_slots WHERE draft_pool_id = p_pool_id;
  END IF;
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status, previous_slot_id)
  VALUES (p_pool_id, v_pick.player_id, v_key, COALESCE(v_src.round, v_pick.round::smallint),
          COALESCE(v_src.nominal_pick_number, v_pick.pick_number), 'normal', 'pending', v_src.id)
  RETURNING id INTO v_r;
  UPDATE public.draft_participants SET done_at = NULL WHERE draft_pool_id = p_pool_id AND player_id = v_pick.player_id;
  IF v_pool.phase = 'complete' THEN                                   -- reopen, paused, so the admin resumes it
    UPDATE public.draft_pools
       SET phase = 'drafting', status = 'in_progress', ended_at = NULL, paused_at = now(), paused_by = p_actor_id,
           pause_reason = 'admin', updated_at = now()
     WHERE id = p_pool_id;
  END IF;

  v_gate := public.draft__pool_completable(p_pool_id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('pick_id', p_pick_id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('pick_id', p_pick_id, 'player_id', v_pick.player_id)::text;
  END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'pick_voided',
    p_player_id => v_pick.player_id, p_slot_id => v_pick.slot_id, p_pick_id => p_pick_id, p_line_id => v_pick.line_id,
    p_before => to_jsonb(v_pick), p_after => jsonb_build_object('restored_slot_id', v_r, 'requeue', true),
    p_reason => p_reason);

  IF p_replacement_line_id IS NOT NULL THEN
    SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
    SELECT id INTO v_entry_id FROM public.point_buy_list_entries
     WHERE list_version_id = v_pool.list_version_id AND line_id = p_replacement_line_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
    v_secs := public.draft__slot_seconds(v_pool, v_pick.player_id, 'normal');
    UPDATE public.draft_slots
       SET status = 'active', timer_seconds = v_secs, started_at = now(), deadline_at = NULL, remaining_ms_at_pause = v_secs * 1000
     WHERE id = v_r RETURNING * INTO v_r_slot;
    v_commit := public.draft__commit_pick(v_pool, v_r_slot, v_entry_id, p_actor_id, 'admin', p_client_request_id,
      v_pick.redraft_slot_id, p_replacement_thresholds, 'pick_corrected', p_reason);
  END IF;

  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'restored_slot_id', v_r, 'requeue', true,
    'pick_id', v_commit->'pick_id', 'replay', false);
END $$;

-- 9. draft_admin_resolve_slot: retired with the blocked state (no slot is ever blocked, assign/forfeit are gone) ───
DROP FUNCTION public.draft_admin_resolve_slot(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, boolean);

-- 10. redraft__publish_locked (base 20261012094028): refused when the published redraft could not complete ─────────
CREATE OR REPLACE FUNCTION public.redraft__publish_locked(p_pool public.draft_pools, p_actor_id uuid, p_actor_role text,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_subs jsonb; v_sub jsonb; v_tracker public.evolution_tracker; v_entry public.point_buy_list_entries;
        v_player uuid := NULL; v_n integer := 0; v_slot_id uuid; v_drops jsonb := '[]'::jsonb; v_total integer := 0;
        v_part record; v_next uuid; v_pool public.draft_pools; v_capped integer := 0; v_gate jsonb;
BEGIN
  IF p_pool.kind <> 'redraft' OR p_pool.phase <> 'submissions' THEN
    RAISE EXCEPTION 'SUBMISSIONS_ALREADY_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Freeze first: deleting the dropped trackers cascades their submission rows. Only participants' submissions count.
  --    Defensive cap: never more than redraft_max_lines per player (draft_configure refuses lowering it below a saved
  --    list; this guards rows written any other way): the first max lines in BR-10 order drop, the rest stay rostered.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'tracker_id', r.tracker_id, 'line_id', r.line_id,
                                               'price', r.price)
                            ORDER BY r.player_id, r.price DESC NULLS LAST, r.line_id)
                    FILTER (WHERE r.rn <= COALESCE(p_pool.redraft_max_lines, 3)), '[]'::jsonb),
         count(*) FILTER (WHERE r.rn > COALESCE(p_pool.redraft_max_lines, 3))
    INTO v_subs, v_capped
    FROM (SELECT s.player_id, s.tracker_id, s.line_id, e.price,
                 row_number() OVER (PARTITION BY s.player_id ORDER BY e.price DESC NULLS LAST, s.line_id) AS rn
            FROM public.redraft_submissions s
            JOIN public.draft_participants dp ON dp.draft_pool_id = s.draft_pool_id AND dp.player_id = s.player_id
            JOIN public.evolution_tracker t ON t.id = s.tracker_id AND t.player_id = s.player_id
                                           AND t.season_id = p_pool.season_id
            LEFT JOIN public.point_buy_list_entries e ON e.list_version_id = p_pool.list_version_id AND e.line_id = s.line_id
           WHERE s.draft_pool_id = p_pool.id) r;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_frozen',
    p_after => jsonb_build_object('count', jsonb_array_length(v_subs), 'capped', v_capped), p_reason => p_reason,
    p_is_public => false);
  IF v_capped > 0 THEN                                 -- capped lines stay rostered: their stale secret rows go
    DELETE FROM public.redraft_submissions s
     WHERE s.draft_pool_id = p_pool.id
       AND s.tracker_id NOT IN (SELECT (x->>'tracker_id')::uuid FROM jsonb_array_elements(v_subs) AS x);
  END IF;

  -- 2. Per player, dropped price desc then line id → labels A, B, C… (BR-10).
  FOR v_sub IN SELECT x FROM jsonb_array_elements(v_subs) AS x LOOP
    IF v_player IS DISTINCT FROM (v_sub->>'player_id')::uuid THEN
      v_player := (v_sub->>'player_id')::uuid;
      v_n := 0;
    END IF;
    v_n := v_n + 1;
    SELECT * INTO v_tracker FROM public.evolution_tracker WHERE id = (v_sub->>'tracker_id')::uuid FOR UPDATE;
    SELECT * INTO v_entry FROM public.point_buy_list_entries
     WHERE list_version_id = p_pool.list_version_id AND line_id = v_tracker.line_id;
    INSERT INTO public.redraft_slots (draft_pool_id, season_id, player_id, label, dropped_line_id, dropped_entry_id,
      dropped_price, transferred_real_kills, dropped_stage, dropped_tracker_snapshot)
    VALUES (p_pool.id, p_pool.season_id, v_player, chr(64 + v_n), v_tracker.line_id, v_entry.id, COALESCE(v_entry.price, 0),
      v_tracker.real_kills, v_tracker.current_stage, to_jsonb(v_tracker))          -- only real kills transfer (SPEC:757-770)
    RETURNING id INTO v_slot_id;
    INSERT INTO public.draft_line_restrictions (draft_pool_id, player_id, line_id, reason, created_by)
    VALUES (p_pool.id, v_player, v_tracker.line_id, 'own_redraft_drop', p_actor_id)
    ON CONFLICT (draft_pool_id, player_id, line_id) DO NOTHING;
    INSERT INTO public.redraft_history (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon, transfer_type,
      missing_kills_transferred, points_spent, draft_pool_id, dropped_line_id, transferred_real_kills, points_refunded)
    VALUES (p_pool.season_id, v_player, v_tracker.id, v_tracker.base_pokemon, v_tracker.locked_stage3_pokemon, 'secret_drop',
      0, 0, p_pool.id, v_tracker.line_id, v_tracker.real_kills, COALESCE(v_entry.price, 0));
    DELETE FROM public.evolution_tracker WHERE id = v_tracker.id;
    v_drops := v_drops || jsonb_build_object('player_id', v_player, 'label', chr(64 + v_n), 'line_id', v_tracker.line_id,
      'transferred_real_kills', v_tracker.real_kills, 'price', COALESCE(v_entry.price, 0));
    v_total := v_total + 1;
  END LOOP;

  -- 3. Participants: slots = drops; budget = season leftover + refunds (BR-5 ledger, now incl. redraft_slots).
  FOR v_part IN SELECT player_id FROM public.draft_participants WHERE draft_pool_id = p_pool.id LOOP
    UPDATE public.draft_participants dp
       SET slots_total = (SELECT count(*) FROM public.redraft_slots rs
                           WHERE rs.draft_pool_id = p_pool.id AND rs.player_id = v_part.player_id),
           budget_start = COALESCE(public.epb__season_remaining_points(p_pool.season_id, v_part.player_id), 0)
     WHERE dp.draft_pool_id = p_pool.id AND dp.player_id = v_part.player_id;
  END LOOP;
  UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND slots_total = 0;

  -- 4. Redraft queue (§5.2): rounds 1..max(drops); player P only in rounds 1..drops(P); snake over the frozen seats.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool.id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT dp.player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn
            FROM public.draft_participants dp
            CROSS JOIN LATERAL generate_series(1, dp.slots_total) AS r(round)
           WHERE dp.draft_pool_id = p_pool.id AND dp.slots_total > 0) s;

  -- 4b. Pool gate: every redraft slot must be fillable at once (free lines incl. the drops, own drops and redraft-locked
  --     lines excluded, the published budgets). A refusal rolls the whole publish back: the submissions stay secret
  --     and editable once the admin moves the deadline (draft_configure), so the players can change their drops.
  v_gate := public.draft__pool_completable(p_pool.id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'REDRAFT_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('slots', (v_gate->>'slots')::int, 'lines', (v_gate->>'lines')::int,
                                  'participants', (v_gate->>'participants')::int, 'min_total', (v_gate->>'min_total')::int,
                                  'budget_total', (v_gate->>'budget_total')::int)::text;
  END IF;

  UPDATE public.draft_pools
     SET phase = 'drafting', status = 'in_progress', submissions_published_at = now(), started_at = now(),
         paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = now()
   WHERE id = p_pool.id;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_published',
    p_after => jsonb_build_object('drops', v_drops), p_reason => p_reason);
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool.id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'drops', v_total, 'published', true,
    'active_slot_id', v_next);
END $$;

-- 11. draft__tick (base 20261012024916): a refused automatic publish is reported, not raised, and backed off ─────────
-- Every snapshot read ticks, so a raise here would fail every page of the pool. Only the two gate refusals are caught;
-- the publish's writes roll back to the block's savepoint, the pool stays in submissions, and the result names the
-- code (the cron route logs it). Every other error still propagates. A refusal is recorded (section 0); the publish is
-- due again only when the pool changed since (state_version) or an hour passed, so polls and cron runs do not repeat
-- the search. The record does not bump state_version (nothing a reader sees changed).
CREATE OR REPLACE FUNCTION public.draft__publish_retry_due(p_pool public.draft_pools) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_pool.publish_refused_at IS NULL
      OR p_pool.publish_refused_version IS DISTINCT FROM p_pool.state_version
      OR p_pool.publish_refused_at <= now() - interval '1 hour'
$$;

CREATE OR REPLACE FUNCTION public.draft__tick(p_pool_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_due_timeout boolean; v_due_publish boolean; v_timeouts integer := 0;
        v_published boolean := false; v_refused text := NULL; v_skipped boolean := false;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.engine <> 'queue' THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false);
  END IF;
  v_due_timeout := v_pool.phase = 'drafting' AND v_pool.paused_at IS NULL AND EXISTS (
    SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at <= now());
  v_due_publish := v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now();
  -- Backoff: a publish refused before is not due again while the pool is unchanged (and within the hour).
  v_skipped := COALESCE(v_due_publish, false) AND NOT public.draft__publish_retry_due(v_pool);
  IF NOT (COALESCE(v_due_timeout, false) OR (COALESCE(v_due_publish, false) AND NOT v_skipped)) THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false, 'publish_refused', NULL::text, 'publish_backoff', v_skipped);
  END IF;

  v_pool := public.draft__lock(p_pool_id);                           -- re-check everything under the lock
  v_skipped := false;
  IF v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now() THEN
    IF public.draft__publish_retry_due(v_pool) THEN
      BEGIN
        PERFORM public.redraft__publish_locked(v_pool, NULL, 'system', NULL);
        v_published := true;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IN ('REDRAFT_NOT_COMPLETABLE', 'POOL_CHECK_LIMIT') THEN
          v_refused := SQLERRM;
        ELSE
          RAISE;
        END IF;
      END;
      IF v_refused IS NOT NULL THEN
        UPDATE public.draft_pools SET publish_refused_at = now(), publish_refused_version = v_pool.state_version
         WHERE id = p_pool_id;
      END IF;
    ELSE
      v_skipped := true;                                             -- refused before, nothing changed since
    END IF;
  END IF;
  v_timeouts := public.draft__resolve_timeouts(p_pool_id);
  RETURN jsonb_build_object('timeouts', v_timeouts, 'published', v_published, 'publish_refused', v_refused,
                            'publish_backoff', v_skipped);
END $$;

-- 12. redraft_admin_restore_drop (base 20261012094028): the roster shrinks, nothing is forfeited; then the pool gate
-- The restored line returns to the player with its tracker, the refund leaves the budget and the player needs one
-- line fewer: their last pending queue slot (else their current one) is removed from the queue. That is a roster
-- shrink, not a lost pick, so no slot is written as forfeited. A restore that would leave the pool uncompletable is
-- refused (POOL_NOT_COMPLETABLE).
CREATE OR REPLACE FUNCTION public.redraft_admin_restore_drop(p_pool_id uuid, p_redraft_slot_id uuid, p_actor_id uuid,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.redraft_slots; v_snap public.evolution_tracker; v_owner uuid;
        v_budget_start integer; v_spent integer; v_tracker_id uuid; v_queue public.draft_slots; v_removed uuid := NULL;
        v_was_current boolean := false; v_gate jsonb;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'drafting' OR v_pool.paused_at IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_slot FROM public.redraft_slots WHERE id = p_redraft_slot_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = v_pool.season_id AND t.line_id = v_slot.dropped_line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool_id AND k.line_id = v_slot.dropped_line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_slot.dropped_line_id, 'player_id', v_owner)::text;
  END IF;
  SELECT budget_start INTO v_budget_start FROM public.draft_participants
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id FOR UPDATE;
  IF NOT FOUND THEN                                     -- a removed participant keeps redraft_slots rows: no budget to check
    RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('player_id', v_slot.player_id)::text;
  END IF;
  SELECT COALESCE(sum(points_spent), 0) INTO v_spent FROM public.draft_picks
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND voided_at IS NULL;
  IF v_budget_start IS NULL OR v_budget_start - v_slot.dropped_price - v_spent < 0 THEN   -- NULL-safe
    RAISE EXCEPTION 'RESTORE_WOULD_OVERDRAW' USING ERRCODE = 'P0001';
  END IF;

  v_snap := jsonb_populate_record(NULL::public.evolution_tracker, v_slot.dropped_tracker_snapshot);
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, total_kos, current_stage, evolved_at,
    real_kills, draft_tokens, kill_tokens, cosmo_points, suspended_until_matchday, evolution_points_awarded,
    locked_stage3_pokemon, line_id, transferred_evo_progress, redraft_slot_id)
  VALUES (v_pool.season_id, v_slot.player_id, v_snap.base_pokemon, v_snap.current_form, COALESCE(v_snap.total_kos, 0),
    COALESCE(v_snap.current_stage, 1), v_snap.evolved_at, COALESCE(v_snap.real_kills, 0), COALESCE(v_snap.draft_tokens, 0),
    COALESCE(v_snap.kill_tokens, 0), COALESCE(v_snap.cosmo_points, 0), v_snap.suspended_until_matchday,
    COALESCE(v_snap.evolution_points_awarded, 0), v_snap.locked_stage3_pokemon, v_slot.dropped_line_id,
    COALESCE(v_snap.transferred_evo_progress, 0),
    CASE WHEN v_snap.redraft_slot_id IS DISTINCT FROM v_slot.id THEN v_snap.redraft_slot_id END)
  RETURNING id INTO v_tracker_id;

  DELETE FROM public.draft_line_restrictions
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND line_id = v_slot.dropped_line_id
     AND reason = 'own_redraft_drop';
  -- draft_picks.redraft_slot_id has no ON DELETE action: a live pick on the slot is a coded error (never a raw 23503),
  -- and voided picks drop the reference (the slot id stays in this action's log entry).
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE redraft_slot_id = v_slot.id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_picks SET redraft_slot_id = NULL WHERE redraft_slot_id = v_slot.id AND voided_at IS NOT NULL;
  DELETE FROM public.redraft_slots WHERE id = v_slot.id;
  UPDATE public.draft_participants
     SET slots_total = GREATEST(slots_total - 1, 0), budget_start = budget_start - v_slot.dropped_price
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;

  -- the player needs one line fewer: their last pending queue slot leaves the queue, else their current slot (then the
  -- next one activates, still paused). Open queue slots are referenced by no pick and no other slot.
  SELECT * INTO v_queue FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status = 'pending'
   ORDER BY sort_key DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_queue FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status = 'active' FOR UPDATE;
    v_was_current := FOUND;
  END IF;
  IF v_queue.id IS NOT NULL THEN
    DELETE FROM public.draft_slots WHERE id = v_queue.id;
    v_removed := v_queue.id;
  END IF;
  IF public.draft__open_slots(p_pool_id, v_slot.player_id) = 0 THEN
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, now())
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;
  END IF;

  v_gate := public.draft__pool_completable(p_pool_id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('redraft_slot_id', v_slot.id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('redraft_slot_id', v_slot.id, 'player_id', v_slot.player_id)::text;
  END IF;
  IF v_was_current THEN PERFORM public.draft__activate_next(p_pool_id, now()); END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'drop_restored',
    p_player_id => v_slot.player_id, p_slot_id => v_removed, p_line_id => v_slot.dropped_line_id,
    p_before => jsonb_build_object('redraft_slot_id', v_slot.id, 'label', v_slot.label, 'dropped_price', v_slot.dropped_price,
                                   'transferred_real_kills', v_slot.transferred_real_kills),
    p_after => jsonb_build_object('tracker_id', v_tracker_id, 'removed_slot_id', v_removed), p_reason => p_reason);
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'tracker_id', v_tracker_id, 'removed_slot_id', v_removed);
END $$;

-- 13. Running pools must already satisfy the invariant. Fails loudly (never repairs): resolve any reported pool
-- by hand first (void/requeue, or end it while it is in setup).
DO $$ DECLARE v_pool record; v_gate jsonb; v_blocked integer;
BEGIN
  SELECT count(*) INTO v_blocked FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
   WHERE s.status = 'blocked' AND p.phase = 'drafting';
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'COMPLETABILITY_INVARIANT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('blocked_slots', v_blocked)::text;
  END IF;
  FOR v_pool IN SELECT id FROM public.draft_pools WHERE engine = 'queue' AND phase = 'drafting' LOOP
    v_gate := public.draft__pool_completable(v_pool.id);
    IF v_gate->>'status' <> 'completable' THEN
      RAISE EXCEPTION 'COMPLETABILITY_INVARIANT' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('pool_id', v_pool.id, 'status', v_gate->>'status')::text;
    END IF;
  END LOOP;
END $$;

-- Privileges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.draft__completable_search(integer[], text[], integer[], integer[], boolean[], integer),
  public.draft__pool_completable(uuid),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, text, text),
  public.draft_confirm_pick(uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text),
  public.draft_start(uuid, uuid),
  public.draft_end(uuid, uuid, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.draft__publish_retry_due(public.draft_pools),
  public.draft__tick(uuid),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft__completable_search(integer[], text[], integer[], integer[], boolean[], integer),
  public.draft__pool_completable(uuid),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, text, text),
  public.draft_confirm_pick(uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text),
  public.draft_start(uuid, uuid),
  public.draft_end(uuid, uuid, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.draft__publish_retry_due(public.draft_pools),
  public.draft__tick(uuid),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
TO service_role;

COMMIT;
