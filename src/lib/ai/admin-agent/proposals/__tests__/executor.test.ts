/**
 * The executor against a REAL staged Build (the worked example of plan 4.10): claim, recheck, ledger, references, outcome
 * mapping, reconcile, resume, the reaper and the live eligibility. The routes, the store and the database are in memory; the
 * bindings are fakes whose handlers run through the real `invokeRoute` and the real verified-session override.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ERROR_CATALOGS } from '@/i18n/messages/errors';
import { stripComments } from '../../__tests__/architecture/graph';
import type { VerifyContext } from '../../dispatch';
import { uid } from '../../plans/__tests__/fixtures';
import { AdminAgentStoreError } from '../../store/errors';
import { EXECUTION_ERROR_STATUS, blastClaims, extractStepResult, ProposalExecutionError, REAPER_AGE_MS, RESUME_WINDOW_MS, SETTLE_MS, STEP_DEADLINE_MS, executeProposal } from '../executor';
import type { StoredStep } from '../steps';
import { ADMIN, OTHER_ADMIN } from './helpers';
import { LEAGUE_ID, PHASE_IDS, RULESET_ID, makeWorld, okReply, rejection, reseal, statusesOf, type World } from './executor-helpers';

const json = (status: number, body: unknown) => NextResponse.json(body, { status });
const MASKED_500 = () => json(500, { success: false, error: 'Failed to create the season' });
const MINUTE = 60_000;

let world: World;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = await makeWorld();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The rejection as the executor's own typed refusal. */
async function refusal(promise: Promise<unknown>): Promise<{ code: string | undefined; status: number; reason: string | undefined }> {
  const error = await rejection(promise);
  if (error instanceof ProposalExecutionError) return { code: error.code, status: error.statusCode, reason: error.reason };
  if (error instanceof AdminAgentStoreError) return { code: error.code, status: error.statusCode, reason: error.reason };
  throw error;
}

/** Nothing ran: no ledger row, no dispatch. */
function expectNothingRan(): void {
  expect(world.store.actions).toEqual([]);
  expect(world.calls).toEqual([]);
}

describe('a clean approve', () => {
  it('claims, runs the four steps in order and finishes the proposal completed', async () => {
    const result = await world.approve();

    expect(result).toMatchObject({ kind: 'proposal_result', proposal_id: world.proposalId, status: 'completed' });
    expect(result.plan_code).toBe(world.row.proposal_hash.slice(0, 8));
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    expect(result.steps[0]).toMatchObject({ entity_id: LEAGUE_ID });
    expect(world.calledOps()).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);
    expect(world.row.status).toBe('completed');
    expect(world.row.approved_by).toBe(ADMIN);
  });

  it('inserts the ledger row of a step BEFORE it dispatches, and completes it after', async () => {
    await world.approve();
    const log = world.store.log;
    expect(log.slice(0, 1)).toEqual(['claim']);
    for (const [key, op] of [['league', 'league_create'], ['roster.1', 'roster_add'], ['phase.regular_season', 'phase_create'], ['phase.playoffs', 'phase_create']] as const) {
      const inserted = log.indexOf(`insert:${key}`);
      const dispatched = log.indexOf(`dispatch:${op}`, inserted);
      const completed = log.indexOf(`complete:${key}:ok`);
      expect(inserted, key).toBeGreaterThan(-1);
      expect(dispatched, key).toBeGreaterThan(inserted);
      expect(completed, key).toBeGreaterThan(dispatched);
    }
    expect(log.at(-1)).toBe('finish:completed');
  });

  it('resolves $ref from the ledger result of the league step and sends the stored template, not the model', async () => {
    await world.approve();
    const [league, roster, regular, playoffs] = world.calls;
    expect(league.params).toEqual({});
    expect(roster.params).toEqual({ id: LEAGUE_ID });
    expect(regular.params).toEqual({ id: LEAGUE_ID });
    expect(playoffs.params).toEqual({ id: LEAGUE_ID });
    expect(league.body).toMatchObject({ name: 'Gen 9 OU League', format_type: 'singles' });
    // The ledger keeps the template (what was hashed), the result keeps ids only.
    expect(world.store.action('roster.1')?.args).toMatchObject({ path_params: { id: { $ref: 'league.id' } } });
    expect(world.store.action('league')?.result).toEqual({ id: LEAGUE_ID, ruleset_id: RULESET_ID });
    expect(world.store.action('phase.regular_season')?.result).toEqual({ id: PHASE_IDS.regular_season });
  });

  it('records each step in the ledger with its outcome, entity, reversibility and read-back', async () => {
    await world.approve();
    expect(world.store.action('league')).toMatchObject({
      status: 'ok',
      http_status: 201,
      outcome_kind: 'ok',
      error_code: null,
      entity_type: 'season',
      entity_id: LEAGUE_ID,
      reversibility: 'archive_league',
      method: 'POST',
      path: '/api/seasons',
      class: 'B',
      verify: { status: 'confirmed', id: LEAGUE_ID },
    });
    expect(world.store.actions.map((row) => row.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('dispatches as the verified session with the client address and the agent audit context, and no cookie', async () => {
    await world.approve();
    const [league, roster] = world.calls;
    expect(league.forwardedFor).toBe('203.0.113.7');
    expect(league.cookie).toBeNull();
    expect(league.audit).toMatchObject({
      agent_conversation_id: world.row.conversation_id,
      agent_proposal_id: world.proposalId,
      agent_step: 'league',
      agent_tool: 'league_create',
      approved_by: ADMIN,
      plan_code: world.row.proposal_hash.slice(0, 8),
      args_hash: world.steps[0].args_hash,
      tool_registry_version: world.row.tool_registry_version,
    });
    expect(roster.audit?.agent_step).toBe('roster.1');
  });

  it('writes an agent.approve and one agent.step.execute audit event per step, none of them awaited into a result', async () => {
    await world.approve();
    expect(world.audits.map((entry) => entry.action)).toEqual(['agent.approve', 'agent.step.execute', 'agent.step.execute', 'agent.step.execute', 'agent.step.execute']);
    expect(world.audits[1]).toMatchObject({ actor_id: ADMIN, actor_name: 'Test Admin', resource_type: 'season', resource_id: LEAGUE_ID, metadata: { via: 'agent', agent_step: 'league', approved_by: ADMIN } });
  });

  it('tells the conversation once, with a server-built structured event', async () => {
    const result = await world.approve();
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({ conversationId: world.row.conversation_id, event: 'proposal_executed', data: { proposal_id: world.proposalId, status: 'completed', plan_code: result.plan_code } });
    expect(world.events[0].data.steps).toEqual(result.steps);
  });

  it('claims the blast-radius counters once (a league create), with the configured cap', async () => {
    await world.approve();
    expect(world.store.budgetClaims).toEqual([[{ counter: 'league_creates', amount: 1, cap: 3 }]]);
  });

  it('charges the write limiter once, fail-closed, and stamps the claim with the approver address hash', async () => {
    await world.approve({ approval: { token: world.token, proposalHash: world.row.proposal_hash, previewHash: world.row.preview_hash, acks: ['visible_publicly'], ipHash: 'h'.repeat(64), userAgent: 'jest' } });
    expect(world.rateLimit).toHaveBeenCalledOnce();
    expect(world.rateLimit).toHaveBeenCalledWith(ADMIN, { limit: 60, windowSeconds: 3600 });
  });

  it('can store an after-fingerprint when the deps provide one', async () => {
    const deps = { ...world.deps, afterFingerprint: async (step: StoredStep) => `fp:${step.key}` };
    await executeProposal(deps, await world.input());
    expect(world.store.action('league')?.after_fingerprint).toBe('fp:league');
    expect(world.store.action('phase.playoffs')?.after_fingerprint).toBe('fp:phase.playoffs');
  });
});

describe('the claim is the replay protection', () => {
  it('lets exactly one of two simultaneous approvals run; the other gets proposal_not_pending', async () => {
    const outcomes = await Promise.allSettled([world.approve(), world.approve()]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AdminAgentStoreError);
    expect((rejected[0].reason as AdminAgentStoreError).code).toBe('proposal_not_pending');
    expect(world.calledOps()).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);
    expect(world.store.log.filter((entry) => entry === 'claim')).toHaveLength(1);
  });

  it('answers a replay with proposal_not_pending, dispatches nothing more and does not charge the limiter again', async () => {
    await world.approve();
    const calls = world.calls.length;
    expect(await refusal(world.approve())).toMatchObject({ code: 'proposal_not_pending', status: 409 });
    expect(world.calls).toHaveLength(calls);
    expect(world.rateLimit).toHaveBeenCalledOnce();
  });

  it('refuses an expired proposal (proposal_expired) and runs nothing', async () => {
    world.clock.ms += 61 * MINUTE;
    expect(await refusal(world.approve())).toMatchObject({ code: 'proposal_expired', status: 409 });
    expect(world.row.status).toBe('proposed');
    expectNothingRan();
  });

  it('refuses a wrong token (proposal_token_invalid), leaves the proposal waiting and runs nothing', async () => {
    const approval = { token: 'f'.repeat(64), proposalHash: world.row.proposal_hash, previewHash: world.row.preview_hash, acks: ['visible_publicly'] };
    expect(await refusal(world.approve({ approval }))).toMatchObject({ code: 'proposal_token_invalid', status: 409 });
    expect(world.row.status).toBe('proposed');
    expectNothingRan();
  });

  it("answers 404 for another admin's proposal and touches nothing", async () => {
    expect(await refusal(world.approve({ adminId: OTHER_ADMIN }))).toMatchObject({ code: 'proposal_not_found', status: 404 });
    expect(world.rateLimit).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('turns a second claim in the same conversation into proposal_conflict_executing', async () => {
    world.store.rows.push({ ...structuredClone(world.row), id: uid(9998), status: 'executing', executing_started_at: new Date(world.clock.ms - 2 * MINUTE).toISOString() });
    expect(await refusal(world.approve())).toMatchObject({ code: 'proposal_conflict_executing', status: 409 });
    expect(world.row.status).toBe('proposed');
    expectNothingRan();
  });
});

describe('the recheck after the claim consumes the proposal', () => {
  /** The proposal is stale, nothing ran, and the conversation was told. */
  async function expectConsumed(promise: Promise<unknown>, code: string, reason?: string): Promise<void> {
    expect(await refusal(promise)).toMatchObject({ code, status: 409, ...(reason ? { reason } : {}) });
    expect(world.row.status).toBe('stale');
    expect(world.store.log).toContain('claim');
    expect(world.store.log).toContain('finish:stale');
    expectNothingRan();
    expect(world.events.map((event) => [event.event, event.data.status])).toEqual([['proposal_executed', 'stale']]);
  }

  it('a proposal_hash that differs from the stored one is proposal_hash_mismatch, stale, with no ledger row', async () => {
    await expectConsumed(world.approve({ approval: { token: world.token, proposalHash: 'b'.repeat(64), previewHash: world.row.preview_hash, acks: ['visible_publicly'] } }), 'proposal_hash_mismatch', 'request_hash');
  });

  it('so is a preview_hash that differs', async () => {
    await expectConsumed(world.approve({ approval: { token: world.token, proposalHash: world.row.proposal_hash, previewHash: 'b'.repeat(64), acks: ['visible_publicly'] } }), 'proposal_hash_mismatch', 'request_hash');
  });

  it('a missing acknowledgement is proposal_ack_missing (the claim stands: the card disables Approve until every box is ticked)', async () => {
    await expectConsumed(world.approve({ approval: { token: world.token, proposalHash: world.row.proposal_hash, previewHash: world.row.preview_hash, acks: [] } }), 'proposal_ack_missing');
  });

  it('a stored proposal_hash edited after staging fails the recomputation from the rows', async () => {
    world.row.proposal_hash = 'c'.repeat(64);
    await expectConsumed(world.approve(), 'proposal_hash_mismatch', 'stored_hash');
  });

  it('a stored step edited after staging fails its args_hash', async () => {
    world.steps[0].body_template = { ...(world.steps[0].body_template as object), name: 'Hijacked' };
    await expectConsumed(world.approve(), 'proposal_hash_mismatch', 'step_hash');
  });

  it('a route template edited in the row is proposal_stale, never dispatched', async () => {
    world.steps[1].route_template = '/api/admin/players/[id]';
    await expectConsumed(world.approve(), 'proposal_stale', 'binding_differs:roster_add');
  });

  it('a method edited in the row is proposal_stale', async () => {
    world.steps[1].method = 'DELETE';
    await expectConsumed(world.approve(), 'proposal_stale', 'binding_differs:roster_add');
  });

  it('an op the registry does not know is proposal_stale', async () => {
    world.omit.add('phase_create');
    await expectConsumed(world.approve(), 'proposal_stale', 'unknown_op:phase_create');
  });

  it('a binding of another class than the stored step is proposal_stale', async () => {
    world.bindingOverrides.roster_add = { class: 'G', outwardEffects: [] };
    await expectConsumed(world.approve(), 'proposal_stale', 'binding_differs:roster_add');
  });

  it('a Go-live step inside a Build is proposal_stale', async () => {
    world.steps[2].class = 'G';
    world.bindingOverrides.phase_create = { class: 'G', outwardEffects: [] };
    await expectConsumed(world.approve(), 'proposal_stale', 'class_differs:phase.regular_season');
  });

  it('a registry version that is not the one the proposal was staged under is proposal_stale', async () => {
    world.registryVersion = '0000000000000000';
    await expectConsumed(world.approve(), 'proposal_stale', 'registry_version_changed');
  });

  it('an op whose phase is above ADMIN_AGENT_MAX_PHASE is proposal_stale', async () => {
    world.bindingOverrides.league_create = { phase: 2 };
    await expectConsumed(world.approve(), 'proposal_stale', 'phase_above_cap:league_create');
  });

  it('a binding that does not declare a phase counts as the last phase, not phase 0', async () => {
    world.bindingOverrides.league_create = { phase: undefined };
    await expectConsumed(world.approve(), 'proposal_stale', 'phase_above_cap:league_create');
  });

  it('a conversation that is gone is proposal_stale', async () => {
    world.store.conversation = { ...world.store.conversation, id: uid(1) };
    await expectConsumed(world.approve(), 'proposal_stale', 'conversation_gone');
  });

  it('a $ref outside the whitelist is proposal_stale', async () => {
    reseal(world, (steps) => {
      steps[1].path_params = { id: { $ref: 'player.discord_id' } };
    });
    await expectConsumed(world.approve(), 'proposal_stale', 'ref_not_allowed:roster.1');
  });

  it('an unreadable step list is proposal_stale (it still consumes the proposal)', async () => {
    world.row.steps = [{ key: 'x' }] as never;
    await expectConsumed(world.approve(), 'proposal_stale', 'steps_unreadable');
  });

  it('a Go-live proposal with the Go-live flag off is refused BEFORE the claim and stays waiting', async () => {
    reseal(world, () => {}, (row) => {
      row.class = 'G';
    });
    world.configEnv.ADMIN_AGENT_GOLIVE = '0';
    expect(await refusal(world.approve())).toMatchObject({ code: 'agent_golive_disabled', status: 403 });
    expect(world.row.status).toBe('proposed');
    expect(world.store.log).not.toContain('claim');
  });
});

describe('the ledger is written first', () => {
  it('dispatches nothing when the ledger insert fails: the step is failed with ledger_unavailable and the rest skipped', async () => {
    world.store.failInsert = '*';
    const result = await world.approve();
    expect(world.calls).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toEqual({ key: 'league', status: 'failed', code: 'ledger_unavailable' });
    expect(result.steps.slice(1).map((step) => step.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(world.row.status).toBe('failed');
    // The database detail never leaves the server log.
    expect(JSON.stringify([result, world.events, world.audits])).not.toContain('secret detail');
  });

  it('stops at the step whose insert fails and keeps what was done (partial)', async () => {
    world.store.failInsert = 'roster.1';
    const result = await world.approve();
    expect(world.calledOps()).toEqual(['league_create']);
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.status).toBe('partial');
  });

  it('does not dispatch a step whose ledger key is taken (a unique violation): it adopts the existing row', async () => {
    // The ledger the executor listed at the start was empty, then another request wrote the league row.
    const list = world.store.actionsApi.listProposalActions;
    let first = true;
    world.store.actionsApi.listProposalActions = async (...args) => {
      if (first) {
        first = false;
        world.store.actions.push({
          ...(await list(...args)).at(0),
          id: uid(1),
          conversation_id: world.row.conversation_id,
          proposal_id: world.proposalId,
          step_key: 'league',
          status: 'ok',
          result: { id: LEAGUE_ID, ruleset_id: RULESET_ID },
          entity_id: LEAGUE_ID,
        } as never);
        return [];
      }
      return list(...args);
    };
    const result = await world.approve();
    expect(world.calledOps()).toEqual(['roster_add', 'phase_create', 'phase_create']);
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    // The reference resolved from the adopted row.
    expect(world.calls[0].params).toEqual({ id: LEAGUE_ID });
  });

  it('answers unknown, not ok, when the ledger update fails after the write; a resume reconciles the executing row', async () => {
    world.store.failComplete = true;
    const result = await world.approve();
    expect(world.calledOps()).toEqual(['league_create']);
    expect(result.steps[0]).toMatchObject({ key: 'league', status: 'unknown', code: 'ledger_unavailable' });
    expect(result.status).toBe('executing');
    expect(world.store.action('league')?.status).toBe('executing');
    expect(JSON.stringify([result, world.events])).not.toContain('secret detail');
  });
});

describe('order, references and failures', () => {
  it('records a first step that fails as failed, skips the rest and dispatches nothing else', async () => {
    world.script.league_create = () => json(409, { success: false, error: 'The season exists' });
    const result = await world.approve();
    expect(world.calledOps()).toEqual(['league_create']);
    expect(statusesOf(result)).toEqual(['league:failed', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[0].code).toBe('step_failed');
    expect(result.status).toBe('failed');
    expect(world.row.status).toBe('failed');
    expect(world.store.action('league')).toMatchObject({ status: 'failed', http_status: 409, outcome_kind: 'conflict', error_code: 'step_failed' });
    expect(world.store.actions.map((row) => row.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(world.audits.map((entry) => entry.action)).toEqual(['agent.approve', 'agent.step.fail']);
    // A refused Build step is not read back: only a Go-live conflict is (a pin move can fail half done).
    expect(world.verifies).toEqual([]);
    expect(world.store.action('league')?.verify).toBeNull();
  });

  it('keeps the earlier steps when a later one fails (partial) and carries the route\'s catalogued code', async () => {
    world.script.roster_add = () => json(409, { success: false, error: 'Already in the league', code: 'participant_already_enrolled' });
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[1].code).toBe('participant_already_enrolled');
    expect(result.status).toBe('partial');
  });

  it('maps a validation failure, a forbidden answer and a rate limit to their catalogued codes', async () => {
    const cases: Array<[Response, string]> = [
      [json(422, { success: false, error: 'Invalid', code: 'validation_failed', params: { issues: 'name' } }), 'validation_failed'],
      [json(403, { success: false, error: 'No', code: 'forbidden' }), 'forbidden'],
      [json(429, { success: false, error: 'Slow down' }), 'rate_limited'],
      [json(401, { success: false, error: 'Sign in' }), 'unauthenticated'],
    ];
    for (const [reply, code] of cases) {
      const fresh = await makeWorld();
      fresh.script.league_create = () => reply.clone();
      const result = await fresh.approve();
      expect(result.steps[0], code).toMatchObject({ status: 'failed', code });
    }
  });

  it('records a step whose dependency is not ok as skipped, without dispatching it', async () => {
    reseal(world, (steps) => {
      steps[1].blocked_by = ['ghost'];
    });
    const result = await world.approve();
    expect(world.calledOps()).toEqual(['league_create']);
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(world.store.action('roster.1')).toMatchObject({ status: 'skipped' });
    expect(result.status).toBe('partial');
  });

  it('skips a step whose $ref points at a step that is not ok, and fails one whose ref does not resolve to a uuid', async () => {
    // The league answers 2xx and its read-back is confirmed, but its answer carries no usable id.
    world.script.league_create = () => json(201, { success: true, data: { name: 'No id here' } });
    world.verify.league_create = () => ({ status: 'confirmed' });
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[1].code).toBe('agent_harness_error');
    expect(world.calledOps()).toEqual(['league_create']);
  });

  it('keeps a result that is not a uuid out of the ledger', async () => {
    world.script.league_create = () => json(201, { success: true, data: { id: 'not-a-uuid', ruleset_id: RULESET_ID, name: 'x', owner_email: 'a@b.c' } });
    await world.approve();
    expect(world.store.action('league')?.result).toEqual({ ruleset_id: RULESET_ID });
  });
});

describe('preconditions', () => {
  it('a changed fingerprint skips the step, ends the proposal stale and dispatches nothing', async () => {
    world.harness.world.value.league_name_recent = { somebody: 'created a league of this name' };
    const result = await world.approve();
    expect(result.status).toBe('stale');
    expect(statusesOf(result)).toEqual(['league:skipped', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[0].code).toBe('proposal_stale');
    expect(world.calls).toEqual([]);
    expect(world.row.status).toBe('stale');
    expect(world.store.action('league')).toMatchObject({ status: 'skipped', error_code: 'proposal_stale' });
  });

  it('a read that cannot be answered counts as a change (fail closed)', async () => {
    world.harness.world.unavailable.add('league_name_recent');
    const result = await world.approve();
    expect(result.status).toBe('stale');
    expect(world.calls).toEqual([]);
  });
});

describe('outcome mapping and reconcile', () => {
  it('reads back a masked 500 and adopts the write when it is there; the step is ok and the run goes on', async () => {
    world.script.league_create = MASKED_500;
    const result = await world.approve();
    expect(world.verifies[0]).toEqual({ op: 'league_create', outcomeKind: 'masked_server_error' });
    expect(world.sleeps).toEqual([]);
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    expect(world.store.action('league')).toMatchObject({ status: 'ok', outcome_kind: 'masked_server_error', entity_id: LEAGUE_ID, result: { id: LEAGUE_ID, ruleset_id: RULESET_ID } });
    // The adopted ids feed the next step.
    expect(world.calls[1].params).toEqual({ id: LEAGUE_ID });
    expect(world.calledOps().filter((op) => op === 'league_create')).toHaveLength(1);
  });

  it('does the same for a 504', async () => {
    world.script.league_create = () => json(504, { success: false, error: 'Timeout' });
    await world.approve();
    expect(world.verifies[0].outcomeKind).toBe('upstream_timeout');
    expect(world.store.action('league')?.status).toBe('ok');
  });

  it('does the same for a handler that outlives its step timeout, and never dispatches it a second time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world.bindingOverrides.league_create = { timeoutMs: 1000 };
    world.script.league_create = () => new Promise<Response>(() => {});
    const running = world.approve();
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(500);
    const result = await running;
    expect(world.verifies[0]).toEqual({ op: 'league_create', outcomeKind: 'harness_error' });
    expect(result.steps[0].status).toBe('ok');
    expect(world.calledOps().filter((op) => op === 'league_create')).toHaveLength(1);
  });

  it('keeps a write unknown when the read-back says absent, even after the 15 s settle window; a Build stays executing and resumable', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'absent' });
    const result = await world.approve();
    expect(world.verifies.map((entry) => entry.op)).toEqual(['league_create', 'league_create']);
    expect(world.sleeps).toEqual([SETTLE_MS]);
    expect(statusesOf(result)).toEqual(['league:unknown', 'roster.1:pending', 'phase.regular_season:pending', 'phase.playoffs:pending']);
    expect(result.steps[0].code).toBe('unknown_outcome');
    expect(result.status).toBe('executing');
    expect(world.row.status).toBe('executing');
    expect(world.calledOps()).toEqual(['league_create']);
    expect(world.store.action('league')).toMatchObject({ status: 'unknown', error_code: 'unknown_outcome', outcome_kind: 'masked_server_error' });
    expect(world.audits.map((entry) => entry.action)).toEqual(['agent.approve', 'agent.step.unknown']);
    expect(world.events[0].data.status).toBe('executing');
  });

  it('adopts a write that only shows up after the settle window', async () => {
    world.script.league_create = MASKED_500;
    let reads = 0;
    world.verify.league_create = () => (++reads === 1 ? { status: 'absent' } : { status: 'confirmed', detail: { id: LEAGUE_ID, ruleset_id: RULESET_ID } });
    const result = await world.approve();
    expect(world.sleeps).toEqual([SETTLE_MS]);
    expect(result.status).toBe('completed');
  });

  it('stops on an ambiguous match with its own code and does not wait', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
    const result = await world.approve();
    expect(result.steps[0]).toMatchObject({ status: 'unknown', code: 'reconcile_ambiguous' });
    expect(world.sleeps).toEqual([]);
    expect(result.status).toBe('executing');
  });

  it('treats a 2xx whose read-back cannot find the write as unknown, not ok', async () => {
    world.verify.league_create = () => ({ status: 'absent' });
    const result = await world.approve();
    expect(result.steps[0]).toMatchObject({ status: 'unknown', code: 'unknown_outcome' });
    expect(world.sleeps).toEqual([]);
    expect(world.calledOps()).toEqual(['league_create']);
  });

  it('treats a read-back that throws as unknown and keeps its message out of every result', async () => {
    world.verify.league_create = () => {
      throw new Error('verify blew up: secret detail');
    };
    const result = await world.approve();
    expect(result.steps[0]).toMatchObject({ status: 'unknown', code: 'unknown_outcome' });
    expect(JSON.stringify([result, world.events, world.audits, world.store.actions])).not.toContain('secret detail');
  });

  it('treats a handler that throws as an unknown write, reads it back, and never leaks the message', async () => {
    world.script.league_create = () => {
      throw new Error('handler exploded: secret detail');
    };
    world.verify.league_create = () => ({ status: 'absent' });
    const result = await world.approve();
    expect(result.steps[0]).toMatchObject({ status: 'unknown', code: 'unknown_outcome' });
    expect(world.verifies[0].outcomeKind).toBe('harness_error');
    expect(JSON.stringify([result, world.events, world.audits, world.store.actions])).not.toContain('secret detail');
  });
});

describe('the deadline and resume', () => {
  it('starts no new step after 240 s: the proposal stays executing and a resume continues after the last ok step', async () => {
    world.script.league_create = (call) => {
      world.clock.ms += STEP_DEADLINE_MS + 1000;
      return okReply('league_create', call);
    };
    const first = await world.approve();
    expect(statusesOf(first)).toEqual(['league:ok', 'roster.1:pending', 'phase.regular_season:pending', 'phase.playoffs:pending']);
    expect(first.status).toBe('executing');
    expect(world.row.status).toBe('executing');
    expect(world.calledOps()).toEqual(['league_create']);

    const second = await world.resume();
    expect(second.status).toBe('completed');
    expect(statusesOf(second)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    // The league was never dispatched again; the reference came from its ledger row.
    expect(world.calledOps()).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);
    expect(world.calls[1].params).toEqual({ id: LEAGUE_ID });
    // The counters count claims: a resume is the same claim.
    expect(world.store.budgetClaims).toHaveLength(1);
    expect(world.row.status).toBe('completed');
    // Two events: the stop and the finish.
    expect(world.events.map((event) => event.data.status)).toEqual(['executing', 'completed']);
  });

  it('reconciles an unknown step on resume instead of dispatching it again, and adopts it once the write is visible', async () => {
    world.script.phase_create = (call, index) => (index === 0 ? MASKED_500() : okReply('phase_create', call));
    let visible = false;
    world.verify.phase_create = () => (visible ? { status: 'confirmed', detail: { id: PHASE_IDS.regular_season } } : { status: 'absent' });
    const first = await world.approve();
    expect(statusesOf(first)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:unknown', 'phase.playoffs:pending']);
    expect(first.status).toBe('executing');
    expect(world.calledOps()).toEqual(['league_create', 'roster_add', 'phase_create']);

    visible = true;
    world.clock.ms += 2 * MINUTE;
    const second = await world.resume();
    expect(second.status).toBe('completed');
    expect(statusesOf(second)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    // phase.regular_season was dispatched exactly once in total; only playoffs ran on the resume.
    expect(world.calledOps()).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);
    // The adoption keeps what the route originally answered, and clears the unknown code.
    expect(world.store.action('phase.regular_season')).toMatchObject({ status: 'ok', entity_id: PHASE_IDS.regular_season, outcome_kind: 'masked_server_error', http_status: 500, error_code: null });
  });

  it('leaves a young executing row to the request that may still be dispatching it, and reconciles it once that request is over', async () => {
    world.store.failComplete = true;
    await world.approve();
    expect(world.store.action('league')?.status).toBe('executing');
    world.store.failComplete = false;
    let reads = 0;
    world.verify.league_create = () => {
      reads += 1;
      return { status: 'confirmed', detail: { id: LEAGUE_ID } };
    };

    // Within the step timeout plus the settle window: no read-back, no ledger write, nothing dispatched.
    world.clock.ms += 30_000;
    const early = await world.resume();
    expect(early.status).toBe('executing');
    expect(statusesOf(early)[0]).toBe('league:unknown');
    expect(reads).toBe(0);
    expect(world.store.action('league')?.status).toBe('executing');

    world.clock.ms += 2 * MINUTE;
    const later = await world.resume();
    expect(statusesOf(later)[0]).toBe('league:ok');
    expect(reads).toBe(1);
    expect(world.calledOps().filter((op) => op === 'league_create')).toHaveLength(1);
  });

  it('keeps an unknown step unknown on resume when it still is not visible: nothing is dispatched, the Build stays resumable', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'absent' });
    await world.approve();
    world.clock.ms += 3 * MINUTE;
    const again = await world.resume();
    expect(again.status).toBe('executing');
    expect(statusesOf(again)[0]).toBe('league:unknown');
    expect(world.calledOps()).toEqual(['league_create']);
    // The row is older than the settle window, so the resume read once and did not wait (the one wait is the first run's).
    expect(world.sleeps).toEqual([SETTLE_MS]);
  });

  it('refuses a resume after ten minutes (proposal_not_resumable) and dispatches nothing', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'absent' });
    await world.approve();
    const calls = world.calls.length;
    world.clock.ms += RESUME_WINDOW_MS + 1000;
    expect(await refusal(world.resume())).toMatchObject({ code: 'proposal_not_resumable', status: 409, reason: 'resume_window_over' });
    expect(world.calls).toHaveLength(calls);
  });

  it.each([
    ['a proposal that is still waiting', (row: World['row']) => void (row.status = 'proposed'), 'status_proposed'],
    ['a proposal that finished', (row: World['row']) => void (row.status = 'completed'), 'status_completed'],
    ['a Go-live proposal', (row: World['row']) => void (row.class = 'G'), 'not_a_build'],
    ['an undo proposal', (row: World['row']) => void (row.kind = 'undo'), 'not_a_build'],
    ['a proposal another admin approved', (row: World['row']) => void (row.approved_by = OTHER_ADMIN), 'approved_by_someone_else'],
  ])('never resumes %s', async (_name, change, reason) => {
    world.row.status = 'executing';
    world.row.approved_by = ADMIN;
    world.row.executing_started_at = new Date(world.clock.ms).toISOString();
    change(world.row);
    expect(await refusal(world.resume())).toMatchObject({ code: 'proposal_not_resumable', status: 409, reason });
    expectNothingRan();
  });

  it("answers 404 when another admin tries to resume, as for an approve", async () => {
    world.row.status = 'executing';
    expect(await refusal(world.resume({ adminId: OTHER_ADMIN }))).toMatchObject({ code: 'proposal_not_found', status: 404 });
  });

  it('repeats the live checks and the recheck on a resume', async () => {
    world.script.league_create = (call) => {
      world.clock.ms += STEP_DEADLINE_MS + 1000;
      return okReply('league_create', call);
    };
    await world.approve();
    world.registryVersion = 'deployed-since';
    expect(await refusal(world.resume())).toMatchObject({ code: 'proposal_stale', reason: 'registry_version_changed' });
    expect(world.row.status).toBe('stale');
  });

  it('refuses a resume when the cap dropped to phase 0 or the assistant was switched off', async () => {
    world.script.league_create = (call) => {
      world.clock.ms += STEP_DEADLINE_MS + 1000;
      return okReply('league_create', call);
    };
    await world.approve();
    world.configEnv.ADMIN_AGENT_MAX_PHASE = '0';
    expect(await refusal(world.resume())).toMatchObject({ code: 'phase_disabled', status: 501 });
    world.configEnv.ADMIN_AGENT_MAX_PHASE = '1';
    world.configEnv.ADMIN_AGENT_ENABLED = '0';
    expect(await refusal(world.resume())).toMatchObject({ code: 'agent_disabled', status: 404 });
    expect(world.calledOps()).toEqual(['league_create']);
  });
});

describe('a Go-live proposal', () => {
  beforeEach(() => {
    reseal(
      world,
      (steps) => {
        for (const step of steps) step.class = 'G';
      },
      (row) => {
        row.class = 'G';
      },
    );
    for (const op of ['league_create', 'roster_add', 'phase_create']) world.bindingOverrides[op] = { class: 'G', outwardEffects: [] };
  });

  it('is finished unknown when a step is unknown, and the rest is skipped: it never resumes', async () => {
    world.script.roster_add = MASKED_500;
    world.verify.roster_add = () => ({ status: 'absent' });
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:unknown', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.status).toBe('unknown');
    expect(world.row.status).toBe('unknown');
    expect(await refusal(world.resume())).toMatchObject({ code: 'proposal_not_resumable' });
  });

  it('counts one Go-live execution in the blast-radius counters', async () => {
    await world.approve();
    expect(world.store.budgetClaims[0]).toContainEqual({ counter: 'golive_executions', amount: 1, cap: 6 });
  });

  it('reads a write back that the route refused with a conflict, and keeps the verdict beside the failure (a pin move can fail half done)', async () => {
    world.script.league_create = () => json(409, { success: false, error: 'A pin moved', code: 'ruleset_pin_moved', params: { target: 'Phase' } });
    world.verify.league_create = () => ({ status: 'unknown', detail: { moved: 1, expected: 2 } });
    const result = await world.approve();
    expect(result.steps[0]).toEqual({ key: 'league', status: 'failed', code: 'ruleset_pin_moved' });
    expect(world.verifies).toEqual([{ op: 'league_create', outcomeKind: 'conflict' }]);
    expect(world.store.action('league')).toMatchObject({ status: 'failed', http_status: 409, outcome_kind: 'conflict', error_code: 'ruleset_pin_moved', verify: { status: 'unknown', moved: 1, expected: 2 } });
    expect(world.sleeps).toEqual([]);
    expect(result.status).toBe('failed');
  });

  it('does not read back any other refusal: a validation failure, a lock or a missing right wrote nothing', async () => {
    const replies = [() => json(422, { success: false, error: 'invalid', code: 'ruleset_document_invalid' }), () => json(409, { success: false, error: 'locked', code: 'ruleset_pin_locked' }), () => json(403, { success: false, error: 'no', code: 'forbidden' })];
    for (const reply of replies) {
      const fresh = await makeWorld();
      reseal(
        fresh,
        (steps) => {
          for (const step of steps) step.class = 'G';
        },
        (row) => {
          row.class = 'G';
        },
      );
      for (const op of ['league_create', 'roster_add', 'phase_create']) fresh.bindingOverrides[op] = { class: 'G', outwardEffects: [] };
      fresh.script.league_create = reply;
      await fresh.approve();
      expect(fresh.verifies).toEqual([]);
      expect(fresh.store.action('league')?.verify).toBeNull();
    }
  });

  it('is refused before the claim when the Go-live flag is off', async () => {
    world.configEnv.ADMIN_AGENT_GOLIVE = '0';
    expect(await refusal(world.approve())).toMatchObject({ code: 'agent_golive_disabled' });
    expect(world.store.log).not.toContain('claim');
  });
});

describe('live eligibility, before anything is claimed', () => {
  it('refuses a role downgraded since staging with proposal_forbidden, and the proposal stays waiting', async () => {
    reseal(world, (steps) => {
      steps[0].min_role = 'site';
    });
    expect(await refusal(world.approve({ isSiteAdmin: false }))).toMatchObject({ code: 'proposal_forbidden', status: 409 });
    expect(world.row.status).toBe('proposed');
    expect(world.store.log).not.toContain('claim');
    expect(world.rateLimit).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('lets a site admin through a site-only step', async () => {
    reseal(world, (steps) => {
      steps[0].min_role = 'site';
    });
    expect((await world.approve()).status).toBe('completed');
  });

  it('answers phase_disabled while ADMIN_AGENT_MAX_PHASE is 0, and agent_disabled when the assistant is off', async () => {
    world.configEnv.ADMIN_AGENT_MAX_PHASE = '0';
    expect(await refusal(world.approve())).toMatchObject({ code: 'phase_disabled', status: 501 });
    world.configEnv.ADMIN_AGENT_MAX_PHASE = '1';
    world.configEnv.ADMIN_AGENT_ENABLED = '0';
    expect(await refusal(world.approve())).toMatchObject({ code: 'agent_disabled', status: 404 });
    expect(world.row.status).toBe('proposed');
    expect(world.rateLimit).not.toHaveBeenCalled();
  });

  it('answers a spent write limiter with agent_rate_limited, the seconds to wait, and no claim', async () => {
    world.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 41.2 });
    const error = (await rejection(world.approve())) as ProposalExecutionError;
    expect(error).toBeInstanceOf(ProposalExecutionError);
    expect(error).toMatchObject({ code: 'agent_rate_limited', statusCode: 429, retryAfterSeconds: 42, params: { seconds: 42 } });
    expect(world.row.status).toBe('proposed');
    expect(world.store.log).not.toContain('claim');
  });

  it('fails closed when the limiter cannot be consulted: its error propagates and nothing is claimed', async () => {
    const unavailable = Object.assign(new Error('limiter down'), { statusCode: 503 });
    world.rateLimit.mockRejectedValue(unavailable);
    expect(await rejection(world.approve())).toBe(unavailable);
    expect(world.store.log).not.toContain('claim');
  });

  it('stops at the conversation cap after the claim: the proposal fails, nothing runs, and the model is told', async () => {
    world.store.budgetExceeded = { counter: 'league_creates', value: 3, cap: 3 };
    expect(await refusal(world.approve())).toMatchObject({ code: 'agent_cap_reached', status: 429 });
    expect(world.row.status).toBe('failed');
    expect(world.events[0].data.status).toBe('failed');
    expectNothingRan();
  });
});

describe('the reaper', () => {
  it('moves this admin\'s overdue executing proposal to unknown, frees the conversation and tells it, then claims', async () => {
    const old = { ...structuredClone(world.row), id: uid(9997), status: 'executing' as const, executing_started_at: new Date(world.clock.ms - REAPER_AGE_MS - MINUTE).toISOString() };
    world.store.rows.push(old);
    const result = await world.approve();
    expect(result.status).toBe('completed');
    expect(old.status).toBe('unknown');
    expect(world.store.log.indexOf('reap')).toBeGreaterThan(-1);
    expect(world.store.log.indexOf('reap')).toBeLessThan(world.store.log.indexOf('claim'));
    expect(world.events[0]).toMatchObject({ event: 'proposal_executed', data: { proposal_id: uid(9997), status: 'unknown', reaped: true } });
  });

  it('leaves a younger executing proposal alone (it may be running): the claim is refused instead', async () => {
    const young = { ...structuredClone(world.row), id: uid(9996), status: 'executing' as const, executing_started_at: new Date(world.clock.ms - 5 * MINUTE).toISOString() };
    world.store.rows.push(young);
    expect(await refusal(world.approve())).toMatchObject({ code: 'proposal_conflict_executing' });
    expect(young.status).toBe('executing');
  });

  it('never reaps another admin\'s proposal', async () => {
    const theirs = { ...structuredClone(world.row), id: uid(9995), admin_id: OTHER_ADMIN, conversation_id: uid(5555), status: 'executing' as const, executing_started_at: new Date(world.clock.ms - 30 * MINUTE).toISOString() };
    world.store.rows.push(theirs);
    await world.approve();
    expect(theirs.status).toBe('executing');
  });

  it('a failing reaper does not stop an approve that has nothing to reap', async () => {
    world.store.proposals.reapExecutingProposals = async () => {
      throw new Error('reap failed');
    };
    expect((await world.approve()).status).toBe('completed');
  });
});

describe("the second lock: the resolved request is parsed with the binding's schemas before it is sent", () => {
  const strictLeague = z.strictObject({ name: z.string(), format_type: z.string(), language: z.string(), start_date: z.string(), ruleset_id: z.string() });
  const idParams = z.strictObject({ id: z.uuid() });

  it('sends the step whose request fits, with the body as the template resolved it', async () => {
    world.bindingOverrides = { league_create: { bodySchema: strictLeague }, roster_add: { paramsSchema: idParams } };
    expect((await world.approve()).status).toBe('completed');
    expect(world.calls[1].params).toEqual({ id: LEAGUE_ID });
  });

  it('does not send a body that gained a key after staging: the step fails agent_harness_error, the ledger row has no http status', async () => {
    world.bindingOverrides = { league_create: { bodySchema: strictLeague.omit({ start_date: true }) } };
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:failed', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[0].code).toBe('agent_harness_error');
    expect(world.store.action('league')).toMatchObject({ status: 'failed', error_code: 'agent_harness_error', http_status: null, outcome_kind: null });
    expect(world.calls).toEqual([]);
    expect(world.audits.map((entry) => entry.action)).toContain('agent.step.fail');
  });

  it('refuses a literal path id that is not a uuid, after the steps before it ran', async () => {
    world.bindingOverrides = { roster_add: { paramsSchema: idParams } };
    reseal(world, (steps) => {
      steps[1].path_params = { id: '../admin' };
    });
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[1].code).toBe('agent_harness_error');
    expect(world.calledOps()).toEqual(['league_create']);
  });

  it('fails closed on a binding that declares no body schema', async () => {
    world.bindingOverrides = { league_create: { bodySchema: undefined } };
    expect(statusesOf(await world.approve())[0]).toBe('league:failed');
    expect(world.calls).toEqual([]);
  });

  it('fails closed on a path with parameters and no params schema', async () => {
    world.bindingOverrides = { roster_add: { paramsSchema: undefined } };
    expect(statusesOf(await world.approve()).slice(0, 2)).toEqual(['league:ok', 'roster.1:failed']);
    expect(world.calledOps()).toEqual(['league_create']);
  });

  it('logs only the issue paths and codes of a refused request, never the values', async () => {
    world.bindingOverrides = { league_create: { bodySchema: z.strictObject({ name: z.string().max(3) }) } };
    await world.approve();
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('was refused before dispatch (body: body.name:too_big, body:unrecognized_keys)');
    expect(logged).not.toContain('Gen 9 OU League');
  });

  it('sends no body to a route that takes none (bodySchema null), and refuses a step that carries one anyway', async () => {
    world.bindingOverrides = { roster_add: { bodySchema: null } };
    await world.approve();
    expect(world.store.action('roster.1')).toMatchObject({ status: 'failed', error_code: 'agent_harness_error' });
    expect(world.calledOps()).toEqual(['league_create']);

    // A stored null body is how an empty-body step is kept; the route is sent none.
    const second = await makeWorld();
    reseal(second, (steps) => {
      steps[1].body_template = null;
    });
    second.bindingOverrides = { roster_add: { bodySchema: null } };
    await second.approve();
    expect(second.calls.find((call) => call.op === 'roster_add')?.body).toBeUndefined();
  });

  it('gives a resume no read-back for a request that no longer parses', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'absent' });
    await world.approve();
    world.bindingOverrides = { league_create: { bodySchema: z.strictObject({ name: z.string().max(3) }) } };
    world.verifies.length = 0;
    world.clock.ms += 20 * 1000 + 60 * 1000;
    const result = await world.resume();
    expect(result.steps[0]).toMatchObject({ status: 'unknown', code: 'unknown_outcome' });
    expect(world.verifies).toEqual([]);
  });
});

describe('what the read-back is given and may answer', () => {
  it('gets the approval time, whether the admin is a site admin and the context the step was dispatched with', async () => {
    const seen: VerifyContext[] = [];
    world.bindingOverrides = {
      league_create: {
        verify: async (_call, _outcome, ctx) => {
          seen.push(ctx);
          return { status: 'confirmed', detail: { id: LEAGUE_ID, ruleset_id: RULESET_ID } };
        },
      },
    };
    const input = await world.input();
    await world.run(input);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ adminId: ADMIN, isSiteAdmin: true, approvedAt: world.row.approved_at });
    expect(seen[0].dispatch?.session).toBe(input.session);
    expect(seen[0].dispatch?.audit).toMatchObject({ agent_step: 'league', agent_tool: 'league_create', approved_by: ADMIN });
  });

  it('may answer failed with a catalogued code: the step is failed, the ledger keeps the code and the id of what exists', async () => {
    world.verify.league_create = () => ({ status: 'failed', code: 'created_but_unadministrable', detail: { id: LEAGUE_ID } });
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['league:failed', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[0]).toMatchObject({ code: 'created_but_unadministrable', entity_id: LEAGUE_ID });
    expect(world.store.action('league')).toMatchObject({ status: 'failed', error_code: 'created_but_unadministrable', entity_id: LEAGUE_ID, http_status: 201, verify: { status: 'failed', id: LEAGUE_ID } });
    expect(world.audits.find((entry) => entry.action === 'agent.step.fail')).toMatchObject({ metadata: { code: 'created_but_unadministrable' } });
    expect(result.status).toBe('failed');
  });

  it('adopts a failed verdict after an unknown outcome as a failed step, without waiting for the settle window', async () => {
    world.script.league_create = MASKED_500;
    world.verify.league_create = () => ({ status: 'failed', code: 'created_but_unadministrable', detail: { id: LEAGUE_ID } });
    const result = await world.approve();
    expect(result.steps[0]).toMatchObject({ status: 'failed', code: 'created_but_unadministrable', entity_id: LEAGUE_ID });
    expect(world.sleeps).toEqual([]);
  });
});

describe('what the executor exports', () => {
  it('has an EN and a DE text, with the same placeholders, for every refusal it can throw', () => {
    const en = Object.assign({}, ...Object.values(ERROR_CATALOGS).map((catalog) => catalog.en)) as Record<string, string>;
    const de = Object.assign({}, ...Object.values(ERROR_CATALOGS).map((catalog) => catalog.de)) as Record<string, string>;
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)[^}]*\}/g)].map((match) => match[1]).sort();
    const codes = [...Object.keys(EXECUTION_ERROR_STATUS), 'ledger_unavailable', 'unknown_outcome', 'reconcile_ambiguous', 'step_failed', 'agent_harness_error', 'agent_cap_reached'];
    for (const code of codes) {
      expect(en[code]?.trim(), `${code} EN`).toBeTruthy();
      expect(de[code]?.trim(), `${code} DE`).toBeTruthy();
      expect(placeholders(de[code]), code).toEqual(placeholders(en[code]));
    }
  });

  it('keeps ids only in a step result', () => {
    expect(extractStepResult('league_create', { id: LEAGUE_ID, ruleset_id: RULESET_ID, name: 'x', owner: { email: 'a@b.c' } })).toEqual({ id: LEAGUE_ID, ruleset_id: RULESET_ID });
    expect(extractStepResult('phase_create', { id: PHASE_IDS.playoffs, ruleset_id: RULESET_ID })).toEqual({ id: PHASE_IDS.playoffs });
    expect(extractStepResult('roster_add', { id: LEAGUE_ID, added: 12 })).toBeNull();
    expect(extractStepResult('tournament_create', { id: 'nope' })).toBeNull();
    expect(extractStepResult('league_create', null)).toBeNull();
    expect(extractStepResult('league_create', [LEAGUE_ID])).toBeNull();
    expect(extractStepResult('groups_set', { groups: [{ id: uid(1), name: 'Group A', player_ids: [uid(9)] }, { id: uid(2), name: 'Group B' }, { id: uid(3), name: 'Other' }, { id: 'bad', name: 'Group C' }] })).toEqual({ A: { id: uid(1) }, B: { id: uid(2) } });
  });

  it('claims the counters of the ops a proposal holds', () => {
    const caps = { leagueCreates: 3, tournamentCreates: 2, rulesetCreates: 5, formatCreates: 8, golive: 6, pinTargets: 50 };
    const step = (op: string) => ({ op }) as StoredStep;
    expect(blastClaims({ class: 'B' }, [step('league_create'), step('roster_add'), step('tournament_create'), step('tournament_create')], caps)).toEqual([
      { counter: 'league_creates', amount: 1, cap: 3 },
      { counter: 'tournament_creates', amount: 2, cap: 2 },
    ]);
    expect(blastClaims({ class: 'B' }, [step('roster_add')], caps)).toEqual([]);
    expect(blastClaims({ class: 'G' }, [step('start_phase')], caps)).toEqual([{ counter: 'golive_executions', amount: 1, cap: 6 }]);
    // A pin move claims one per league or phase it names (the ruleset itself is not a target), then the Go-live execution.
    const pin = {
      op: 'move_pin',
      targets: [
        { kind: 'ruleset', id: 'r' },
        { kind: 'season', id: 's' },
        { kind: 'tournament', id: 't1' },
        { kind: 'tournament', id: 't2' },
      ],
    } as unknown as StoredStep;
    expect(blastClaims({ class: 'G' }, [pin], caps)).toEqual([
      { counter: 'pin_targets', amount: 3, cap: 50 },
      { counter: 'golive_executions', amount: 1, cap: 6 },
    ]);
  });
});

describe('the module boundaries of executor.ts', () => {
  const source = stripComments(readFileSync(path.join(process.cwd(), 'src/lib/ai/admin-agent/proposals/executor.ts'), 'utf8'));

  it('touches no table and no database client: the store is the only module that does', () => {
    expect(source).not.toMatch(/\.from\(\s*['"`]/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(source).not.toMatch(/admin_agent_/);
    expect(source).not.toMatch(/@\/lib\/supabase|@supabase\//);
  });

  it('reads no environment, session or cookie itself: everything arrives through its dependencies', () => {
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/@\/lib\/auth|@\/auth|next\/headers|cookies\(/);
    expect(source).not.toMatch(/runAsVerifiedSession/);
  });

  it('never reads err.message: causes are catalogued codes and the log gets the error object', () => {
    expect(source).not.toMatch(/\.message\b/);
  });

  it('has no dynamic import and no eval', () => {
    expect(source).not.toMatch(/\bimport\s*\(|\beval\s*\(|new Function\(/);
  });

  it('is imported by the approve wiring only', () => {
    const wiring = readFileSync(path.join(process.cwd(), 'src/app/api/admin/agent/_lib/approve.ts'), 'utf8');
    expect(wiring).toContain("'@/lib/ai/admin-agent/proposals/executor'");
  });
});
