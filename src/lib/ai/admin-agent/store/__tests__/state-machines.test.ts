/**
 * The assistant's three state machines (`proposal-state.ts`, `action-state.ts`, `plan-state.ts`, ADR 0004): their states
 * against the TypeScript unions and the CHECK constraints, their parity with the guard triggers of the migration, the
 * derived `expired` and the guarded writers in the store.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { IllegalTransitionError } from '@/lib/state-machine/machine';
import { actionMachine } from '../action-state';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import { planMachine } from '../plan-state';
import { effectiveProposalStatus, isProposalActionable, proposalMachine } from '../proposal-state';
import type { ActionStatus, PlanStatus, ProposalStatus } from '../types';
import { ACTION, ADMIN, CONVERSATION, FakeDb, HASH, NOW, PLAN, PROPOSAL, hasStep } from './fake-db';

const admin = adminIdOf(ADMIN);
const ROOT = process.cwd();
const MIGRATION = readFileSync(path.join(ROOT, 'supabase/migrations/20261027100000_admin_agent_tables.sql'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** The body of the last `CREATE OR REPLACE FUNCTION public.<name>` of the migration (the definition that wins). */
function functionBody(name: string): string {
  const start = MIGRATION.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf('END $$;', start));
}

/** The values of a `CONSTRAINT <name> CHECK (status IN (...))`. */
function checkValues(constraint: string): string[] {
  const match = new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\(status IN \\(([^)]*)\\)\\)`).exec(MIGRATION);
  expect(match, constraint).not.toBeNull();
  return [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('the states', () => {
  it('match the TypeScript unions', () => {
    expectTypeOf<(typeof proposalMachine.spec.states)[number]>().toEqualTypeOf<ProposalStatus>();
    expectTypeOf<(typeof actionMachine.spec.states)[number]>().toEqualTypeOf<ActionStatus>();
    expectTypeOf<(typeof planMachine.spec.states)[number]>().toEqualTypeOf<PlanStatus>();
  });

  it('match the CHECK constraints of the tables', () => {
    expect(checkValues('admin_agent_proposals_status_check').sort()).toEqual([...proposalMachine.spec.states].sort());
    expect(checkValues('admin_agent_actions_status_check').sort()).toEqual([...actionMachine.spec.states].sort());
    expect(checkValues('admin_agent_plans_status_check').sort()).toEqual([...planMachine.spec.states].sort());
  });

  it('start in the column defaults', () => {
    for (const [table, machine] of [
      ['admin_agent_proposals', proposalMachine],
      ['admin_agent_actions', actionMachine],
      ['admin_agent_plans', planMachine],
    ] as const) {
      const create = MIGRATION.slice(MIGRATION.indexOf(`CREATE TABLE public.${table} (`));
      const fallback = /status\s+text\s+NOT NULL DEFAULT '([a-z_]+)'/.exec(create)?.[1];
      expect(machine.spec.initial, table).toEqual([fallback]);
    }
  });
});

describe('parity with the guard triggers (the SQL is not changed here)', () => {
  it('admin_agent_proposals__guard refuses every move back to proposed, and the machine has none', () => {
    expect(functionBody('admin_agent_proposals__guard')).toMatch(/IF NEW\.status = 'proposed' AND OLD\.status <> 'proposed' THEN\s+RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS'/);
    expect(proposalMachine.sourcesOf('proposed')).toEqual([]);
  });

  it('admin_agent_actions__guard refuses every move back to executing and an undone from anything but ok, and the machine agrees', () => {
    const body = functionBody('admin_agent_actions__guard');
    expect(body).toMatch(/\(NEW\.status = 'executing' AND OLD\.status <> 'executing'\)/);
    expect(actionMachine.sourcesOf('executing')).toEqual([]);
    const undone = /\(NEW\.status = 'undone'((?: AND OLD\.status <> '[a-z_]+')+)\)/.exec(body);
    expect(undone).not.toBeNull();
    const allowedByTrigger = [...undone![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // The trigger lets ok and undone (an idempotent repeat, which completeAction answers without a write) become undone.
    expect(allowedByTrigger.sort()).toEqual(['ok', 'undone']);
    expect(actionMachine.sourcesOf('undone')).toEqual(['ok']);
  });

  it('admin_agent_plans__guard does not police the status (the store guard is the only one)', () => {
    expect(functionBody('admin_agent_plans__guard')).not.toMatch(/status/);
  });
});

describe('the derived expired state and the card actions', () => {
  const at = (status: ProposalStatus, expiresAt: string) => effectiveProposalStatus({ status, expires_at: expiresAt }, NOW);

  it('shows an overdue proposed card as expired, and nothing else', () => {
    expect(at('proposed', new Date(NOW.getTime() + 1000).toISOString())).toBe('proposed');
    expect(at('proposed', NOW.toISOString())).toBe('expired');
    expect(at('declined', '2020-01-01T00:00:00Z')).toBe('declined');
    expect(at('executing', '2020-01-01T00:00:00Z')).toBe('executing');
  });

  it('offers the admin an action only on a pending card', () => {
    for (const status of proposalMachine.spec.states) expect(isProposalActionable(status), status).toBe(status === 'proposed');
  });

  it('keeps plan_create on the terminal plan states', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/ai/admin-agent/staged/plan-tools.ts'), 'utf8');
    const listed = /existing\.status !== '([a-z_]+)' && existing\.status !== '([a-z_]+)'/.exec(source);
    expect(listed).not.toBeNull();
    expect([listed![1], listed![2]].sort()).toEqual([...planMachine.spec.terminal].sort());
  });
});

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, store };
}

describe('proposal writers', () => {
  it('refuses a final status the machine does not know before any query', async () => {
    const { db, store } = setup();
    await expect(store.proposals.finishProposal(admin, PROPOSAL, 'declined' as never)).rejects.toMatchObject({ code: 'proposal_not_pending', statusCode: 409 });
    expect(db.calls).toHaveLength(0);
  });
});

describe('completeAction (the ledger guard)', () => {
  const row = (status: ActionStatus) => ({ id: ACTION, conversation_id: CONVERSATION, admin_id: ADMIN, status });

  it.each(actionMachine.spec.states.filter((to) => actionMachine.sourcesOf(to).length > 0))('writes %s only from its source states', async (to) => {
    const { db, store } = setup();
    db.on('admin_agent_actions', 'update', { data: row(to) });
    await store.actions.completeAction(admin, ACTION, { status: to });
    expect(hasStep(db.calls[0], 'in', 'status', actionMachine.sourcesOf(to))).toBe(true);
  });

  it('does not guard a write that changes no status', async () => {
    const { db, store } = setup();
    db.on('admin_agent_actions', 'update', { data: row('ok') });
    await store.actions.completeAction(admin, ACTION, { verify: { status: 'confirmed' } });
    expect(db.calls[0].steps.some((step) => step[0] === 'in')).toBe(false);
  });

  it.each<[ActionStatus, ActionStatus]>([
    ['ok', 'failed'],
    ['failed', 'ok'],
    ['skipped', 'ok'],
    ['unknown', 'skipped'],
    ['failed', 'undone'],
  ])('refuses %s -> %s and leaves the row as it is', async (from, to) => {
    const { db, store } = setup();
    db.on('admin_agent_actions', 'select', { data: row(from) });
    const error = await store.actions.completeAction(admin, ACTION, { status: to }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IllegalTransitionError);
    expect(error).toMatchObject({ code: 'state_transition_invalid', statusCode: 409, from, to });
    expect(db.to('admin_agent_actions', 'update')).toHaveLength(1);
  });

  it('answers a retry that finds the row already in the requested status with the row, writing nothing more', async () => {
    const { db, store } = setup();
    db.on('admin_agent_actions', 'select', { data: row('undone') });
    expect((await store.actions.completeAction(admin, ACTION, { status: 'undone' })).status).toBe('undone');
  });

  it('says a legal move that matched no row changed underneath, and a missing row is not found', async () => {
    const raced = setup();
    raced.db.on('admin_agent_actions', 'select', { data: row('executing') });
    await expect(raced.store.actions.completeAction(admin, ACTION, { status: 'ok' })).rejects.toMatchObject({ code: 'agent_harness_error', reason: 'action_changed' });
    const missing = setup();
    await expect(missing.store.actions.completeAction(admin, ACTION, { status: 'ok' })).rejects.toMatchObject({ reason: 'action_not_found' });
  });
});

describe('plan writers', () => {
  const plan = (status: PlanStatus, revision = 2) => ({ id: PLAN, conversation_id: CONVERSATION, admin_id: ADMIN, status, revision });

  it('guards setPlanStatus with the source states of the target', async () => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'update', { data: plan('building') });
    await store.plans.setPlanStatus(admin, PLAN, 'building');
    expect(hasStep(db.calls[0], 'in', 'status', ['drafting', 'ready', 'partial'])).toBe(true);
  });

  it.each<[PlanStatus, PlanStatus]>([
    ['built', 'drafting'],
    ['abandoned', 'building'],
    ['building', 'abandoned'],
    ['drafting', 'built'],
  ])('refuses %s -> %s', async (from, to) => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'select', { data: plan(from) });
    await expect(store.plans.setPlanStatus(admin, PLAN, to)).rejects.toMatchObject({ code: 'state_transition_invalid', statusCode: 409 });
  });

  it('is plan_stale when a legal move matched no row (the plan changed between the statements)', async () => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'select', { data: plan('drafting') });
    await expect(store.plans.setPlanStatus(admin, PLAN, 'ready')).rejects.toMatchObject({ code: 'plan_stale', statusCode: 409 });
  });

  it('guards a revision write that also moves the status, and refuses an illegal one at the same revision', async () => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'select', { data: plan('built') });
    const write = { expectedRevision: 2, doc: { v: 3 }, docHash: HASH, author: 'agent' as const, status: 'ready' as const };
    await expect(store.plans.writePlanRevision(admin, PLAN, write)).rejects.toMatchObject({ code: 'state_transition_invalid' });
    expect(hasStep(db.to('admin_agent_plans', 'update')[0], 'in', 'status', ['drafting'])).toBe(true);

    const moved = setup();
    moved.db.on('admin_agent_plans', 'select', { data: plan('built', 5) });
    await expect(moved.store.plans.writePlanRevision(admin, PLAN, write)).rejects.toMatchObject({ code: 'plan_stale' });
  });
});
