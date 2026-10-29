/**
 * The executor on an undo proposal (spec §18.8, §18.6): the steps are the compensating calls, each guarded by its own
 * precondition; a mismatch STOPS the proposal (`stale`, like any Go-live precondition, §18.6 step 6c) and the rest is recorded
 * skipped; an unknown outcome ends it `unknown` and it never resumes; the ledger rows it reversed become `undone`; and the
 * recheck allows only the compensating operations. The forward writes are ledger rows (`undo-helpers.ts`); the routes are fake
 * bindings that record their calls.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { createBindingRegistry, type RouteBinding } from '../../dispatch';
import { parseAdminAgentEnv } from '../../env';
import { PLAYERS } from '../../plans/__tests__/fixtures';
import { UNDO_MAX_STEPS } from '../../plans/undo';
import { UNDO_OPERATIONS, UNDO_ROUTES } from '../../plans/undo-recipes';
import { executeProposal, type ExecutorDeps, type ProposalResult } from '../executor';
import { approvalTokenHash, deriveApprovalToken } from '../token';
import type { StageStaged } from '../types';
import { ExecStore, recordedSession, reseal, statusesOf, type World } from './executor-helpers';
import { ADMIN, CONVERSATION_ID, DEFINITION_ID, NOW, TOKEN_SECRET, makeHarness } from './helpers';
import { LEAGUE, LiveReads, draftWrites, executedBuild, executedPinMove, leagueState, scriptLiveReads } from './undo-helpers';
import { sortedIds } from '../after-state';
import { stateHash, rosterMembersState } from '../after-state';
import type { MemoryProposal } from './helpers';
import type { StoredStep } from '../steps';

interface Call {
  op: string;
  params: Record<string, string>;
  body: unknown;
}

async function undoWorld(prepare: (h: ReturnType<typeof makeHarness>, live: LiveReads) => Promise<Record<string, unknown>>) {
  const h = makeHarness();
  const live = new LiveReads();
  const args = await prepare(h, live);
  scriptLiveReads(h, live);
  const staged = (await h.stage('propose_undo', args)) as StageStaged;
  if (staged.status !== 'staged') throw new Error(`staging refused: ${JSON.stringify(staged)}`);
  const row = h.store.proposals.find((candidate) => candidate.id === staged.proposal_id) as MemoryProposal;

  const clock = { ms: NOW.getTime() };
  const now = () => new Date(clock.ms);
  const store = new ExecStore(h.store.proposals, now);
  // One ledger: the forward rows the staging read, and the rows the undo writes.
  store.actions = h.store.actions;
  const token = deriveApprovalToken(TOKEN_SECRET, staged.proposal_id, ADMIN);
  expect(approvalTokenHash(token)).toBe(row.token_hash);

  const calls: Call[] = [];
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const script: { reply?: (call: Call, index: number) => Response } = {};
  const bindings = UNDO_OPERATIONS.map((op): RouteBinding => {
    const route = UNDO_ROUTES[op];
    const handler = async (request: NextRequest, context: { params: Promise<Record<string, string>> }): Promise<Response> => {
      const text = await request.text();
      const call: Call = { op, params: await context.params, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
      calls.push(call);
      return script.reply?.(call, calls.length - 1) ?? NextResponse.json({ success: true, data: { id: call.params.id } }, { status: 200 });
    };
    return {
      operation: op,
      method: route.method,
      path: route.routeTemplate,
      class: route.class,
      phase: 1,
      load: async () => ({ [route.method]: handler }),
      reversal: { kind: 'none' },
      bodySchema: op === 'ruleset_delete_draft' ? null : z.looseObject({}),
      paramsSchema: z.looseObject({}),
      ...(route.class === 'G' ? { outwardEffects: [] } : {}),
      verify: async () => ({ status: 'confirmed' as const }),
    } as RouteBinding;
  });
  const deps: ExecutorDeps = {
    store: store.asStore(),
    bindings: createBindingRegistry(bindings),
    fingerprints: live,
    config: () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: '1', ADMIN_AGENT_GOLIVE: '1', ADMIN_AGENT_MAX_PHASE: '1' }),
    registryVersion: () => 'abcdef0123456789',
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    recordEvent: async (_admin, _conversation, event, data) => void events.push({ event, data: { ...data } }),
    audit: () => {},
    now,
    sleep: async () => {},
  };
  const input = async () =>
    ({
      mode: 'approve' as const,
      adminId: ADMIN,
      adminName: 'Test Admin',
      isSiteAdmin: true,
      session: await recordedSession(),
      inbound: { headers: new Headers() },
      proposalId: staged.proposal_id,
      approval: { token, proposalHash: row.proposal_hash, previewHash: row.preview_hash, acks: ['compensating_changes'] },
    });
  return {
    h,
    live,
    store,
    row,
    calls,
    events,
    script,
    deps,
    steps: row.steps as unknown as StoredStep[],
    approve: async (overrides: Partial<ExecutorDeps> = {}): Promise<ProposalResult> => executeProposal({ ...deps, ...overrides }, await input()),
    input,
  };
}

const worked = async (h: ReturnType<typeof makeHarness>, live: LiveReads) => ({ proposal_id: (await executedBuild(h, live)).proposalId });

describe('approving the undo of the worked example', () => {
  it('runs the roster removes, then archives the league, as the compensating calls, and marks the rows it reversed undone', async () => {
    const world = await undoWorld(worked);
    const result = await world.approve();

    expect(result.status).toBe('completed');
    expect(world.calls.map((call) => call.op)).toEqual([...PLAYERS.map(() => 'roster_remove'), 'league_archive']);
    expect(world.calls[0]).toMatchObject({ params: { id: LEAGUE }, body: { player_id: sortedIds(PLAYERS)[0] } });
    expect(world.calls[12]).toMatchObject({ params: { id: LEAGUE }, body: { archived: true } });
    expect(statusesOf(result).every((status) => status.endsWith(':ok'))).toBe(true);

    // The forward rows are undone, the phases (residue) are untouched.
    const forward = world.store.actions.filter((row) => row.proposal_id !== world.row.id);
    expect(forward.filter((row) => row.status === 'undone').map((row) => row.tool_name).sort()).toEqual(['league_create', 'roster_add']);
    expect(forward.filter((row) => row.tool_name === 'phase_create').every((row) => row.status === 'ok')).toBe(true);
    // The undo's own rows are filed under what they acted on.
    expect(world.store.action(`undo.${forward.find((row) => row.tool_name === 'league_create')!.id}`)).toMatchObject({ status: 'ok', tool_name: 'league_archive', class: 'B', entity_id: LEAGUE });
    // One Go-live execution is claimed, whatever the number of steps.
    expect(world.store.budgetClaims).toEqual([[{ counter: 'golive_executions', amount: 1, cap: expect.any(Number) }]]);
    expect(world.events[0]).toMatchObject({ event: expect.any(String), data: { status: 'completed' } });
  });

  it('stops at a step whose precondition no longer holds: stale, the rest skipped, earlier reversals stay done and marked', async () => {
    const world = await undoWorld(worked);
    // Somebody renames the league between staging and the click.
    world.live.set('league_after', { kind: 'id', id: LEAGUE }, leagueState('Renamed after staging'));
    const result = await world.approve();

    expect(result.status).toBe('stale');
    expect(world.calls.map((call) => call.op)).toEqual(PLAYERS.map(() => 'roster_remove'));
    expect(result.steps.at(-1)).toMatchObject({ status: 'skipped', code: 'proposal_stale' });
    const forward = world.store.actions.filter((row) => row.proposal_id !== world.row.id);
    expect(forward.find((row) => row.tool_name === 'roster_add')?.status).toBe('undone');
    expect(forward.find((row) => row.tool_name === 'league_create')?.status).toBe('ok');
  });

  it('stops at the first removal that fails and leaves the roster row (not all of its steps ran) un-undone', async () => {
    const world = await undoWorld(worked);
    world.script.reply = (_call, index) => (index === 3 ? NextResponse.json({ success: false, error: 'locked', code: 'SEASON_GROUPS_SCHEDULED' }, { status: 409 }) : NextResponse.json({ success: true, data: null }, { status: 200 }));
    const result = await world.approve();

    expect(result.status).toBe('partial');
    expect(world.calls).toHaveLength(4);
    expect(result.steps[3]).toMatchObject({ status: 'failed' });
    expect(result.steps.slice(4).every((step) => step.status === 'skipped')).toBe(true);
    const forward = world.store.actions.filter((row) => row.proposal_id !== world.row.id);
    expect(forward.some((row) => row.status === 'undone')).toBe(false);
  });

  it('ends unknown after an unknown outcome and never resumes', async () => {
    const world = await undoWorld(worked);
    world.script.reply = () => NextResponse.json({ success: false, error: 'boom' }, { status: 500 });
    // The read-back cannot tell either.
    const deps = { bindings: createBindingRegistry(world.deps.bindings.all().map((binding) => ({ ...binding, verify: async () => ({ status: 'unknown' as const }) }))) };
    const result = await world.approve(deps);
    expect(result.status).toBe('unknown');
    await expect(executeProposal({ ...world.deps, ...deps }, { ...(await world.input()), mode: 'resume', approval: undefined })).rejects.toMatchObject({ code: 'proposal_not_resumable' });
  });
});

describe('the recheck of an undo proposal', () => {
  const asWorld = (world: Awaited<ReturnType<typeof undoWorld>>) => ({ row: world.row, steps: world.steps, proposalId: world.row.id }) as unknown as World;

  it('refuses a step that is not a compensating operation (a Build op smuggled into an undo)', async () => {
    const world = await undoWorld(worked);
    reseal(asWorld(world), (steps) => {
      steps[0].op = 'league_create';
      steps[0].method = 'POST';
      steps[0].route_template = '/api/seasons';
    });
    const bindings = createBindingRegistry([
      ...world.deps.bindings.all(),
      { operation: 'league_create', method: 'POST', path: '/api/seasons', class: 'B', phase: 1, load: async () => ({}), reversal: { kind: 'none' }, bodySchema: z.looseObject({}), verify: async () => ({ status: 'confirmed' as const }) } as RouteBinding,
    ]);
    await expect(world.approve({ bindings })).rejects.toMatchObject({ code: 'proposal_stale', reason: 'op_not_undoable:league_create' });
  });

  it('refuses an op the registry has but the undo allow-list does not (move_pin is allowed, publish is not)', async () => {
    const world = await undoWorld(worked);
    reseal(asWorld(world), (steps) => {
      steps[12].op = 'publish_ruleset';
      steps[12].class = 'G';
      steps[12].method = 'POST';
      steps[12].route_template = '/api/ruleset-definitions/[id]/publish';
    });
    const bindings = createBindingRegistry([
      ...world.deps.bindings.all(),
      { operation: 'publish_ruleset', method: 'POST', path: '/api/ruleset-definitions/[id]/publish', class: 'G', phase: 1, load: async () => ({}), reversal: { kind: 'none' }, outwardEffects: [], bodySchema: z.looseObject({}), paramsSchema: z.looseObject({}), verify: async () => ({ status: 'confirmed' as const }) } as RouteBinding,
    ]);
    await expect(world.approve({ bindings })).rejects.toMatchObject({ code: 'proposal_stale', reason: 'op_not_undoable:publish_ruleset' });
    expect(world.calls).toEqual([]);
  });

  it('refuses a key that does not name a ledger row, and more than 20 steps', async () => {
    const world = await undoWorld(worked);
    reseal(asWorld(world), (steps) => {
      steps[0].key = 'roster.1';
    });
    await expect(world.approve()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'op_not_undoable:roster_remove' });

    const long = await undoWorld(worked);
    reseal(asWorld(long), (steps) => {
      while (steps.length <= UNDO_MAX_STEPS) steps.push({ ...steps[0], key: `${steps[0].key}9${steps.length}` });
    });
    await expect(long.approve()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'undo_shape' });
  });

  it('refuses a stored class that differs from its binding (a roster remove stored as G)', async () => {
    const world = await undoWorld(worked);
    reseal(asWorld(world), (steps) => {
      steps[0].class = 'G';
    });
    await expect(world.approve()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'binding_differs:roster_remove' });
  });

  it('refuses an undo that is not a Go-live proposal', async () => {
    const world = await undoWorld(worked);
    reseal(asWorld(world), () => {}, (row) => {
      row.class = 'B';
    });
    await expect(world.approve()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'undo_shape' });
  });
});

describe('approving the undo of a pin move and of drafts', () => {
  it('moves the targets back and claims the pin targets besides the Go-live execution', async () => {
    const world = await undoWorld(async (h, live) => ({ proposal_id: executedPinMove(h, live).proposalId }));
    const result = await world.approve();
    expect(result.status).toBe('completed');
    expect(world.calls.map((call) => [call.op, (call.body as { to_version_no: number }).to_version_no])).toEqual([['move_pin', 1], ['move_pin', 2]]);
    expect(world.store.budgetClaims[0].map((claim) => [claim.counter, claim.amount])).toEqual([['pin_targets', 2], ['golive_executions', 1]]);
    expect(world.store.actions.find((row) => row.tool_name === 'move_pin' && row.proposal_id !== world.row.id && row.status === 'undone')).toBeDefined();
  });

  it('restores a draft save through the draft route, filed under the ruleset', async () => {
    const world = await undoWorld(async (h, live) => {
      draftWrites(h, live);
      return { ruleset_id: DEFINITION_ID, draft_rev: 2 };
    });
    const result = await world.approve();
    expect(result.status).toBe('completed');
    expect(world.calls).toEqual([{ op: 'ruleset_restore_draft', params: { id: DEFINITION_ID }, body: { draft_rev: 2, document: { schema: 1, rev: 1 } } }]);
    expect(world.store.actions.filter((row) => row.status === 'undone')).toHaveLength(1);
  });

  it('deletes a never-published draft and sends no body; the draft changing after staging stops it', async () => {
    const world = await undoWorld(async (h, live) => {
      draftWrites(h, live);
      return { ruleset_id: DEFINITION_ID };
    });
    const result = await world.approve();
    expect(result.status).toBe('completed');
    expect(world.calls).toEqual([{ op: 'ruleset_delete_draft', params: { id: DEFINITION_ID }, body: undefined }]);

    const changed = await undoWorld(async (h, live) => {
      draftWrites(h, live);
      return { ruleset_id: DEFINITION_ID };
    });
    // Published meanwhile: the precondition (zero versions, the same revision) no longer holds.
    changed.live.set('ruleset_draft_state', { kind: 'id', id: DEFINITION_ID }, { draft_rev: 2, published: true });
    expect((await changed.approve()).status).toBe('stale');
    expect(changed.calls).toEqual([]);
  });

  it('keeps the draft restore\'s own precondition: a save after staging stops it', async () => {
    const world = await undoWorld(async (h, live) => {
      draftWrites(h, live);
      return { ruleset_id: DEFINITION_ID, draft_rev: 2 };
    });
    world.live.set('ruleset_draft_doc', { kind: 'id', id: DEFINITION_ID }, { draft_rev: 3, doc_hash: 'f'.repeat(64) });
    expect((await world.approve()).status).toBe('stale');
    expect(world.calls).toEqual([]);
  });
});

describe('the helpers agree', () => {
  it('hashes a roster state the way the ledger does', () => {
    expect(stateHash(rosterMembersState(['B', 'a']))).toBe(stateHash(['a', 'b']));
    expect(CONVERSATION_ID).toBeTruthy();
  });
});
