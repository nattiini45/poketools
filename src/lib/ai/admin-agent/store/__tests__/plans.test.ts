/** Plans and their append-only revisions: the compare-and-set revision write. */
import { describe, expect, it, vi } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import type { PlanRevisionWrite } from '../types';
import { ADMIN, CONVERSATION, FakeDb, HASH, NOW, OTHER_ADMIN, PLAN, eqOf, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, p: store.plans };
}

const plan = (revision = 1, extra: Record<string, unknown> = {}) => ({
  id: PLAN,
  conversation_id: CONVERSATION,
  admin_id: ADMIN,
  admin_name: 'Test Admin',
  mode: 'create',
  status: 'drafting',
  revision,
  doc: { v: 1 },
  doc_hash: HASH,
  build_started_at: null,
  build_finished_at: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...extra,
});

describe('createPlan', () => {
  it('inserts the plan with the conversation\'s admin name, its revision 1 history row and the active pointer', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_plans', 'insert', { data: plan() });
    const created = await p.createPlan(admin, { conversationId: CONVERSATION, mode: 'create', doc: { v: 1 }, docHash: HASH });
    expect(created.id).toBe(PLAN);
    expect(db.to('admin_agent_plans', 'insert')[0].payload).toEqual({
      conversation_id: CONVERSATION,
      admin_id: ADMIN,
      admin_name: 'Test Admin',
      mode: 'create',
      doc: { v: 1 },
      doc_hash: HASH,
    });
    expect(db.to('admin_agent_plan_revisions', 'insert')[0].payload).toEqual({ plan_id: PLAN, revision: 1, doc: { v: 1 }, patch: null, author: 'agent' });
    const active = db.to('admin_agent_conversations', 'update')[0];
    expect(active.payload).toEqual({ active_plan_id: PLAN });
    expect(eqOf(active, 'admin_id')).toBe(ADMIN);
  });

  it("refuses another admin's conversation and a document with a private key", async () => {
    const { db, p } = setup();
    ownsConversation(db);
    await expect(p.createPlan(other, { conversationId: CONVERSATION, mode: 'create', doc: {}, docHash: HASH })).rejects.toMatchObject({
      code: 'conversation_not_found',
    });
    await expect(p.createPlan(admin, { conversationId: CONVERSATION, mode: 'create', doc: { league: { webhook_url: 'x' } }, docHash: HASH })).rejects.toMatchObject({
      reason: 'payload_forbidden',
    });
    expect(db.calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });
});

describe('getActivePlan', () => {
  it('follows the conversation\'s pointer and answers null without one', async () => {
    const { db, p } = setup();
    db.when((c) => c.table === 'admin_agent_conversations' && c.steps.some((s) => s[0] === 'select' && s[1] === 'active_plan_id'), { data: { active_plan_id: PLAN } });
    ownsConversation(db);
    db.on('admin_agent_plans', 'select', { data: plan(3) });
    expect((await p.getActivePlan(admin, CONVERSATION))?.revision).toBe(3);
    expect(eqOf(db.to('admin_agent_plans')[0], 'admin_id')).toBe(ADMIN);

    const none = setup();
    none.db.when((c) => c.steps.some((s) => s[0] === 'select' && s[1] === 'active_plan_id'), { data: { active_plan_id: null } });
    ownsConversation(none.db);
    expect(await none.p.getActivePlan(admin, CONVERSATION)).toBeNull();
  });
});

describe('writePlanRevision', () => {
  const write: PlanRevisionWrite = { expectedRevision: 2, doc: { v: 2 }, docHash: HASH, patch: [{ op: 'replace' }], author: 'admin' };

  it('advances only from the revision read, appends the history row and supersedes the plan\'s pending Builds', async () => {
    const { db, p } = setup();
    db.on('admin_agent_plans', 'update', { data: plan(3, { doc: { v: 2 } }) });
    db.on('admin_agent_proposals', 'update', { data: [{ id: 'x' }, { id: 'y' }] });
    const written = await p.writePlanRevision(admin, PLAN, { ...write, status: 'ready' });
    expect(written.plan.revision).toBe(3);
    expect(written.supersededProposals).toBe(2);

    const advance = db.to('admin_agent_plans', 'update')[0];
    expect(advance.payload).toEqual({ doc: { v: 2 }, doc_hash: HASH, revision: 3, status: 'ready' });
    expect(eqOf(advance, 'revision')).toBe(2);
    expect(eqOf(advance, 'admin_id')).toBe(ADMIN);
    expect(db.to('admin_agent_plan_revisions', 'insert')[0].payload).toEqual({
      plan_id: PLAN,
      revision: 3,
      doc: { v: 2 },
      patch: [{ op: 'replace' }],
      author: 'admin',
    });
    const supersede = db.to('admin_agent_proposals', 'update')[0];
    expect(supersede.payload).toEqual({ status: 'superseded' });
    expect(eqOf(supersede, 'plan_id')).toBe(PLAN);
    expect(eqOf(supersede, 'kind')).toBe('build');
    expect(eqOf(supersede, 'status')).toBe('proposed');
    expect(eqOf(supersede, 'admin_id')).toBe(ADMIN);
    // Only cards for an older revision than the one written.
    expect(supersede.steps.find((step) => step[0] === 'lt')).toEqual(['lt', 'plan_revision', 3]);
    // The superseding comes first, the history is written only after the plan advanced.
    expect(db.calls.indexOf(supersede)).toBeLessThan(db.calls.indexOf(advance));
    expect(db.calls.indexOf(advance)).toBeLessThan(db.calls.indexOf(db.to('admin_agent_plan_revisions', 'insert')[0]));
  });

  it('keeps the write when the history row cannot be appended: the plan has moved, so the caller must not see a failure', async () => {
    const { db, p } = setup();
    db.on('admin_agent_plans', 'update', { data: plan(3, { doc: { v: 2 } }) });
    db.on('admin_agent_plan_revisions', 'insert', { error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const written = await p.writePlanRevision(admin, PLAN, write);
    expect(written.plan.revision).toBe(3);
    // Tried twice, then logged.
    expect(db.to('admin_agent_plan_revisions', 'insert')).toHaveLength(2);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is plan_stale when the plan moved on, writes no history row and reports the current revision', async () => {
    const { db, p } = setup();
    db.on('admin_agent_plans', 'update', { data: null });
    db.on('admin_agent_plans', 'select', { data: plan(5) });
    const error = await p.writePlanRevision(admin, PLAN, write).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'plan_stale', statusCode: 409, detail: { expectedRevision: 2, currentRevision: 5 } });
    expect(db.to('admin_agent_plan_revisions')).toHaveLength(0);
  });

  it('answers not found for a plan that is not the admin\'s (the same refusal as a missing one)', async () => {
    const { db, p } = setup();
    await expect(p.writePlanRevision(other, PLAN, write)).rejects.toMatchObject({ code: 'conversation_not_found', reason: 'plan_not_found' });
    await expect(p.writePlanRevision(admin, 'nope', write)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.to('admin_agent_plan_revisions')).toHaveLength(0);
  });

  it('refuses a private key in the document or the patch before any write', async () => {
    const { db, p } = setup();
    await expect(p.writePlanRevision(admin, PLAN, { ...write, doc: { ban_reason: 'x' } })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    await expect(p.writePlanRevision(admin, PLAN, { ...write, patch: [{ value: { password: 'x' } }] })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    expect(db.calls).toHaveLength(0);
  });
});

describe('setPlanStatus / revisions', () => {
  it('moves the status and stamps the build times', async () => {
    const { db, p } = setup();
    db.on('admin_agent_plans', 'update', { data: plan(2, { status: 'building' }) });
    await p.setPlanStatus(admin, PLAN, 'building', { buildStartedAt: NOW });
    expect(db.calls[0].payload).toEqual({ status: 'building', build_started_at: NOW.toISOString() });
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
  });

  it('is not found for a plan of another admin', async () => {
    const { db, p } = setup();
    await expect(p.setPlanStatus(other, PLAN, 'abandoned')).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(eqOf(db.calls[0], 'admin_id')).toBe(OTHER_ADMIN);
  });

  it('lists and reads revisions only of an owned plan', async () => {
    const { db, p } = setup();
    db.on('admin_agent_plans', 'select', { data: plan() });
    db.on('admin_agent_plan_revisions', 'select', { data: [{ plan_id: PLAN, revision: 2 }] });
    expect(await p.listRevisions(admin, PLAN, 10)).toEqual([{ plan_id: PLAN, revision: 2 }]);

    const foreign = setup();
    await expect(foreign.p.listRevisions(other, PLAN)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(await foreign.p.getRevision(other, PLAN, 1)).toBeNull();
    expect(foreign.db.to('admin_agent_plan_revisions')).toHaveLength(0);
  });
});
