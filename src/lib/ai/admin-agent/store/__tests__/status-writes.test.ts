/**
 * Characterization of every status write the assistant's store performs today (CAS-93): the legal moves of
 * `admin_agent_proposals.status`, `admin_agent_actions.status` and `admin_agent_plans.status`, written the way the
 * executor, the reaper, the D tools and the plan tools write them. These pin the payloads, so that the explicit machines
 * (`proposal-state.ts`, `action-state.ts`, `plan-state.ts`) cannot change a legitimate write.
 */
import { describe, expect, it } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import type { ActionStatus, PlanStatus, ProposalFinalStatus } from '../types';
import { ACTION, ADMIN, CONVERSATION, FakeDb, HASH, NOW, PLAN, PROPOSAL, eqOf } from './fake-db';

const admin = adminIdOf(ADMIN);

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, store };
}

describe('proposal status writes', () => {
  it.each<ProposalFinalStatus>(['completed', 'partial', 'failed', 'stale', 'unknown'])('finishes an executing proposal as %s', async (status) => {
    const { db, store } = setup();
    db.on('admin_agent_proposals', 'update', { data: { id: PROPOSAL, admin_id: ADMIN, status } });
    expect((await store.proposals.finishProposal(admin, PROPOSAL, status)).status).toBe(status);
    expect(db.calls[0].payload).toEqual({ status, finished_at: NOW.toISOString() });
    expect(eqOf(db.calls[0], 'id')).toBe(PROPOSAL);
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
  });

  it('supersedes the pending Builds of a plan on a revision write', async () => {
    const { db, store } = setup();
    db.on('admin_agent_proposals', 'update', { data: [{ id: PROPOSAL }] });
    db.on('admin_agent_plans', 'update', { data: { id: PLAN, revision: 3, status: 'drafting' } });
    const written = await store.plans.writePlanRevision(admin, PLAN, { expectedRevision: 2, doc: { v: 3 }, docHash: HASH, author: 'agent' });
    expect(written.supersededProposals).toBe(1);
    const supersede = db.to('admin_agent_proposals', 'update')[0];
    expect(supersede.payload).toEqual({ status: 'superseded' });
    expect(eqOf(supersede, 'kind')).toBe('build');
  });
});

describe('action ledger status writes', () => {
  const legal: Array<[ActionStatus, ActionStatus]> = [
    ['executing', 'ok'],
    ['executing', 'failed'],
    ['executing', 'unknown'],
    ['executing', 'skipped'],
    ['unknown', 'ok'],
    ['unknown', 'failed'],
    ['unknown', 'unknown'],
    ['ok', 'undone'],
  ];

  it.each(legal)('completes a %s row as %s, scoped to the admin', async (_from, to) => {
    const { db, store } = setup();
    db.on('admin_agent_actions', 'update', { data: { id: ACTION, conversation_id: CONVERSATION, admin_id: ADMIN, status: to } });
    const row = await store.actions.completeAction(admin, ACTION, { status: to, errorCode: null });
    expect(row.status).toBe(to);
    expect(db.calls[0].payload).toEqual({ status: to, error_code: null });
    expect(eqOf(db.calls[0], 'id')).toBe(ACTION);
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
  });
});

describe('plan status writes', () => {
  const plan = (status: PlanStatus) => ({ id: PLAN, conversation_id: CONVERSATION, admin_id: ADMIN, status, revision: 2 });

  it.each<[PlanStatus, PlanStatus]>([
    ['drafting', 'ready'],
    ['drafting', 'building'],
    ['ready', 'building'],
    ['partial', 'building'],
    ['building', 'built'],
    ['building', 'partial'],
    ['drafting', 'abandoned'],
  ])('moves a %s plan to %s', async (_from, to) => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'update', { data: plan(to) });
    expect((await store.plans.setPlanStatus(admin, PLAN, to)).status).toBe(to);
    expect(db.calls[0].payload).toEqual({ status: to });
    expect(eqOf(db.calls[0], 'id')).toBe(PLAN);
  });

  it('stamps the build times with the status', async () => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'update', { data: plan('built') });
    await store.plans.setPlanStatus(admin, PLAN, 'built', { buildFinishedAt: NOW });
    expect(db.calls[0].payload).toEqual({ status: 'built', build_finished_at: NOW.toISOString() });
  });

  it('leaves the status alone on a revision write that names none (the plan tools never do)', async () => {
    const { db, store } = setup();
    db.on('admin_agent_plans', 'update', { data: plan('drafting') });
    await store.plans.writePlanRevision(admin, PLAN, { expectedRevision: 2, doc: { v: 3 }, docHash: HASH, author: 'agent' });
    expect(db.to('admin_agent_plans', 'update')[0].payload).toEqual({ doc: { v: 3 }, doc_hash: HASH, revision: 3 });
  });
});
