/**
 * Static contract of the pool-completability migration. No DB: reads the migration text.
 *
 * - Each replaced RPC is a copy of its latest definition; the base lines that are gone are exactly the blocked /
 *   forfeit / bypass lines this migration retires (plus the declarations and log payloads they fed).
 * - Nothing writes a blocked or forfeited slot, a blocked_slot pause or a slot_blocked / slot_forfeited / slot_assigned
 *   audit row any more; draft_admin_resolve_slot and the bypassing draft__commit_pick signature are dropped.
 * - Every gate site runs draft__pool_completable and raises its coded refusal, with POOL_CHECK_LIMIT for a capped search.
 * - The deadline tick reports a refused publish instead of raising, and catches nothing else.
 * - The search step cap and the portfolio budget equal the TS twin's.
 *
 * Behaviour on a real Postgres (start refusal, pick gate, void requeue, abort, publish refusal + tick report, the
 * league-list benchmark) was replayed on a local scratch database; the private companion's live-DB suite covers it on
 * a local Supabase stack.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETABILITY_NODE_LIMIT, PORTFOLIO_STEPS } from '@/lib/draft/completability';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const GATE = read('20261018140200_draft_pool_completability.sql');

function fnBody(sql: string, name: string): string {
  const start = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, sql.indexOf('END $$;', start) + 'END $$;'.length);
}

const code = (body: string): string[] =>
  body
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trim())
    .filter(Boolean);

const BASES: Record<string, string> = {
  draft__activate_next: '20261018140100_draft_quiet_hours.sql',
  draft__commit_pick: '20261012024916_draft_rpcs.sql',
  draft_confirm_pick: '20261012024916_draft_rpcs.sql',
  draft_start: '20261012024916_draft_rpcs.sql',
  draft_end: '20261012024916_draft_rpcs.sql',
  draft_admin_void_pick: '20261012024916_draft_rpcs.sql',
  redraft__publish_locked: '20261012094028_draft_review_fixes.sql',
  draft__tick: '20261012024916_draft_rpcs.sql',
  redraft_admin_restore_drop: '20261012094028_draft_review_fixes.sql',
};

/** Base code lines (trimmed, comments dropped) that the new copy no longer contains. */
const EXPECTED_REMOVED: Record<string, string[]> = {
  draft__activate_next: [
    "SET status = 'blocked', started_at = p_at, deadline_at = NULL, remaining_ms_at_pause = NULL,",
    "alert_kind = 'blocked', alert_notified_at = NULL, notified_turn_at = NULL",
    "SET paused_at = COALESCE(paused_at, p_at), pause_reason = 'blocked_slot', updated_at = now()",
    "PERFORM public.draft__log(v_pool.season_id, p_pool_id, NULL, 'system', 'slot_blocked',",
    'p_player_id => v_slot.player_id, p_slot_id => v_slot.id,',
    "p_after => jsonb_build_object('reason', CASE WHEN v_cnt < v_open THEN 'NOT_ENOUGH_LINES' ELSE 'BUDGET_INFEASIBLE' END,",
    "'open_slots', v_open, 'remaining', v_rem, 'available', v_cnt, 'min_cost', v_cost));",
  ],
  draft__commit_pick: [
    'p_client_request_id uuid, p_redraft_slot_id uuid, p_line_thresholds jsonb, p_bypass_budget boolean,',
    'p_action text, p_reason text',
    'v_pick_no integer; v_pick_id uuid; v_tracker_id uuid; v_next uuid; v_pool public.draft_pools;',
    'IF NOT p_bypass_budget THEN',
  ],
  draft_confirm_pick: [
    "SELECT * INTO v_slot FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;",
    "IF v_slot.status = 'blocked' THEN RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001'; END IF;",
    'p_redraft_slot_id, p_line_thresholds, false,',
  ],
  draft_start: ['DECLARE v_pool public.draft_pools; v_n integer; v_current uuid;'],
  draft_end: [
    'DECLARE v_pool public.draft_pools; v_forfeited integer := 0;',
    "UPDATE public.draft_slots SET status = 'forfeited', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL",
    "WHERE draft_pool_id = p_pool_id AND status IN ('pending', 'active', 'blocked');",
    'GET DIAGNOSTICS v_forfeited = ROW_COUNT;',
    "SET phase = 'complete', status = 'complete', ended_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,",
    'UPDATE public.draft_participants SET done_at = COALESCE(done_at, now()) WHERE draft_pool_id = p_pool_id;',
    "PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_ended',",
    "p_after => jsonb_build_object('phase', 'complete', 'status', 'complete', 'reason', 'admin',",
    "'forfeited_slots', v_forfeited), p_reason => p_reason);",
  ],
  draft_admin_void_pick: [
    'v_anchor public.draft_slots; v_prev numeric; v_next numeric; v_key numeric; v_r uuid; v_r_slot public.draft_slots;',
    'v_secs integer; v_entry_id uuid; v_commit jsonb := NULL;',
    'IF p_replacement_line_id IS NOT NULL AND NOT COALESCE(p_requeue, false) THEN',
    'IF COALESCE(p_requeue, false) THEN',
    'SELECT * INTO v_current FROM public.draft_slots',
    "WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;",
    "IF v_pool.pause_reason = 'blocked_slot' THEN",
    "UPDATE public.draft_pools SET pause_reason = 'admin', paused_by = p_actor_id WHERE id = p_pool_id;",
    'IF v_src.id IS NOT NULL THEN',
    'SELECT min(sort_key) INTO v_next FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key > v_src.sort_key;',
    'v_key := CASE WHEN v_next IS NULL THEN v_src.sort_key + 1 ELSE (v_src.sort_key + v_next) / 2 END;',
    'INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status,',
    'previous_slot_id, completed_at)',
    "COALESCE(v_src.nominal_pick_number, v_pick.pick_number), 'normal', 'forfeited', v_src.id, now())",
    "p_before => to_jsonb(v_pick), p_after => jsonb_build_object('restored_slot_id', v_r, 'requeue', COALESCE(p_requeue, false)),",
    "v_pick.redraft_slot_id, p_replacement_thresholds, false, 'pick_corrected', p_reason);",
    "RETURN jsonb_build_object('state_version', v_pool.state_version, 'restored_slot_id', v_r, 'requeue', COALESCE(p_requeue, false),",
  ],
  redraft__publish_locked: ['v_part record; v_next uuid; v_pool public.draft_pools; v_capped integer := 0;'],
  draft__tick: [
    'v_published boolean := false;',
    "RETURN jsonb_build_object('timeouts', v_timeouts, 'published', v_published);",
    // The due test now leaves out a backed-off publish (v_skipped).
    'IF NOT (COALESCE(v_due_timeout, false) OR COALESCE(v_due_publish, false)) THEN',
  ],
  redraft_admin_restore_drop: [
    'v_budget_start integer; v_spent integer; v_tracker_id uuid; v_queue public.draft_slots; v_forfeited uuid := NULL;',
    'IF FOUND THEN',
    "UPDATE public.draft_slots SET status = 'forfeited', completed_at = now() WHERE id = v_queue.id;",
    'v_forfeited := v_queue.id;',
    'ELSE',
    "WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status IN ('active', 'blocked') FOR UPDATE;",
    'IF FOUND THEN',
    "UPDATE public.draft_slots SET status = 'forfeited', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL",
    'WHERE id = v_queue.id;',
    'v_forfeited := v_queue.id;',
    'PERFORM public.draft__activate_next(p_pool_id, now());',
    'p_player_id => v_slot.player_id, p_slot_id => v_forfeited, p_line_id => v_slot.dropped_line_id,',
    "p_after => jsonb_build_object('tracker_id', v_tracker_id, 'forfeited_slot_id', v_forfeited), p_reason => p_reason);",
    "RETURN jsonb_build_object('state_version', v_pool.state_version, 'tracker_id', v_tracker_id, 'forfeited_slot_id', v_forfeited);",
  ],
};

describe('pool completability migration', () => {
  it.each(Object.entries(BASES))('%s is its latest definition minus only the retired lines', (fn, base) => {
    const before = code(fnBody(read(base), fn));
    const after = new Set(code(fnBody(GATE, fn)));
    const removed = before.filter((l) => !after.has(l));
    // `IF FOUND THEN` / `ELSE` repeat inside the base body: compare as multisets.
    expect(removed.sort()).toEqual([...EXPECTED_REMOVED[fn]].sort());
  });

  it('writes no blocked or forfeited state anywhere', () => {
    const body = GATE.split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(body).not.toMatch(/SET\s+status\s*=\s*'(blocked|forfeited)'/);
    expect(body).not.toMatch(/'(blocked|forfeited)'\s*,\s*v_src/);
    expect(body).not.toMatch(/pause_reason\s*=\s*'blocked_slot'/);
    expect(body).not.toMatch(/'slot_(blocked|forfeited|assigned)'/);
    expect(body).not.toMatch(/p_bypass_budget/);
  });

  it('drops the blocked-slot resolver and the bypassing commit signature', () => {
    expect(GATE).toContain(
      'DROP FUNCTION public.draft_admin_resolve_slot(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, boolean);',
    );
    expect(GATE).toContain(
      'DROP FUNCTION public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, boolean,',
    );
    expect(GATE).not.toMatch(/CREATE OR REPLACE FUNCTION public\.draft_admin_resolve_slot\(/);
  });

  it.each([
    ['draft__commit_pick', 'POOL_NOT_COMPLETABLE'],
    ['draft_start', 'LEAGUE_NOT_COMPLETABLE'],
    ['draft_admin_void_pick', 'POOL_NOT_COMPLETABLE'],
    ['redraft__publish_locked', 'REDRAFT_NOT_COMPLETABLE'],
    ['redraft_admin_restore_drop', 'POOL_NOT_COMPLETABLE'],
  ])('%s runs the pool gate and refuses with %s or POOL_CHECK_LIMIT', (fn, refusal) => {
    const body = fnBody(GATE, fn);
    expect(body).toContain('v_gate := public.draft__pool_completable(');
    expect(body).toMatch(/IF v_gate->>'status' = 'undecided' THEN\s+RAISE EXCEPTION 'POOL_CHECK_LIMIT'/);
    expect(body).toMatch(new RegExp(`ELSIF v_gate->>'status' <> 'completable' THEN\\s+RAISE EXCEPTION '${refusal}'`));
  });

  it('gates a pick after the slot is closed and before the next activation', () => {
    const body = fnBody(GATE, 'draft__commit_pick');
    const closed = body.indexOf("SET status = 'done', completed_at = now()");
    const gate = body.indexOf('v_gate := public.draft__pool_completable(p_pool.id);');
    const next = body.indexOf('v_next := public.draft__activate_next(p_pool.id, now());');
    expect(closed).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(closed);
    expect(next).toBeGreaterThan(gate);
  });

  it('requeue is the only void: requeue = false is INVALID_CONFIG before anything is read', () => {
    const body = fnBody(GATE, 'draft_admin_void_pick');
    const check = body.indexOf('IF p_requeue IS DISTINCT FROM true THEN');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf('public.draft__lock(p_pool_id)'));
  });

  it('draft_end aborts: voids picks and cancels an initial draft, refuses a running redraft', () => {
    const body = fnBody(GATE, 'draft_end');
    expect(body).toContain("IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'DRAFT_ABORT_NOT_ALLOWED'");
    expect(body).toContain('UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id');
    expect(body).toContain("RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS'");
    expect(body).toContain("SET phase = 'cancelled', status = 'complete'");
  });

  it('the tick catches only the two publish refusals and reports them', () => {
    const body = fnBody(GATE, 'draft__tick');
    expect(body).toContain('EXCEPTION WHEN raise_exception THEN');
    expect(body).toContain("IF SQLERRM IN ('REDRAFT_NOT_COMPLETABLE', 'POOL_CHECK_LIMIT') THEN");
    expect(body).toMatch(/ELSE\s+RAISE;/);
    expect(body).toContain("'publish_refused', v_refused");
  });

  it('the tick backs off a refused automatic publish until the pool changes or an hour passes', () => {
    const due = fnBody(GATE, 'draft__publish_retry_due');
    expect(due).toContain('p_pool.publish_refused_at IS NULL');
    expect(due).toContain('p_pool.publish_refused_version IS DISTINCT FROM p_pool.state_version');
    expect(due).toContain("p_pool.publish_refused_at <= now() - interval '1 hour'");
    const body = fnBody(GATE, 'draft__tick');
    // Checked before the lock (a backed-off pool takes no lock and says so) and again under it.
    expect(body.match(/public\.draft__publish_retry_due\(v_pool\)/g)).toHaveLength(2);
    expect(body.indexOf('draft__publish_retry_due(v_pool)')).toBeLessThan(body.indexOf('v_pool := public.draft__lock(p_pool_id);'));
    expect(body).toContain(
      "RETURN jsonb_build_object('timeouts', 0, 'published', false, 'publish_refused', NULL::text, 'publish_backoff', v_skipped);",
    );
    expect(body.indexOf('v_skipped := false;')).toBeGreaterThan(body.indexOf('v_pool := public.draft__lock(p_pool_id);'));
    // The refusal is recorded without a state_version bump; the result says when it was skipped.
    expect(body).toMatch(
      /IF v_refused IS NOT NULL THEN\s+UPDATE public\.draft_pools SET publish_refused_at = now\(\), publish_refused_version = v_pool\.state_version\s+WHERE id = p_pool_id;/,
    );
    expect(body).toContain("'publish_backoff', v_skipped");
    expect(GATE).toMatch(/ALTER TABLE public\.draft_pools\s+ADD COLUMN publish_refused_at timestamptz,\s+ADD COLUMN publish_refused_version integer;/);
  });

  it('activation raises the internal invariant code instead of blocking', () => {
    const body = fnBody(GATE, 'draft__activate_next');
    expect(body).toContain("RAISE EXCEPTION 'COMPLETABILITY_INVARIANT'");
  });

  it('caps the search like the TS twin', () => {
    const body = fnBody(GATE, 'draft__completable_search');
    expect(body).toContain(`p_node_limit integer DEFAULT ${DEFAULT_COMPLETABILITY_NODE_LIMIT})`);
    expect(body).toContain(`c_portfolio CONSTANT integer := ${PORTFOLIO_STEPS};`);
    expect(body).toContain("RETURN jsonb_build_object('status', 'undecided', 'nodes', v_nodes);");
  });

  it('fails the apply loudly when a running pool already breaks the invariant', () => {
    const tail = GATE.slice(GATE.indexOf('DO $$ DECLARE v_pool record;'));
    expect(tail).toContain("WHERE s.status = 'blocked' AND p.phase = 'drafting'");
    expect(tail).toContain("FOR v_pool IN SELECT id FROM public.draft_pools WHERE engine = 'queue' AND phase = 'drafting' LOOP");
    expect(tail).toMatch(/RAISE EXCEPTION 'COMPLETABILITY_INVARIANT'/);
  });
});
