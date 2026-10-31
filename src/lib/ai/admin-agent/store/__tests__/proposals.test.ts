/** Proposals: staging, the atomic claim and its precise refusals, decline, expiry, the reaper. */
import { describe, expect, it } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import type { NewProposal } from '../types';
import { ADMIN, CONVERSATION, FakeDb, HASH, NOW, OTHER_ADMIN, PLAN, PROPOSAL, eqOf, hasStep, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);
const TOKEN_HASH = 'b'.repeat(64);
const LATER = new Date(NOW.getTime() + 60 * 60_000);

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, p: store.proposals };
}

const proposal = (extra: Record<string, unknown> = {}) => ({
  id: PROPOSAL,
  conversation_id: CONVERSATION,
  admin_id: ADMIN,
  status: 'proposed',
  steps: [{ key: 's1' }],
  ...extra,
});

const staged: NewProposal = {
  conversationId: CONVERSATION,
  kind: 'action',
  class: 'G',
  toolRegistryVersion: 'r1',
  steps: [{ key: 's1', op: 'league_start' }],
  proposalHash: HASH,
  preview: { title: 'x' },
  previewHash: HASH,
  tokenHash: TOKEN_HASH,
  expiresAt: LATER,
  locale: 'en',
};

describe('stageProposal', () => {
  it('inserts one proposal for the conversation\'s admin, with only the token hash, and supersedes older ones with the same key', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'insert', { data: proposal() });
    await p.stageProposal(admin, { ...staged, supersedeKey: 'league_start:abc' });

    const insert = db.to('admin_agent_proposals', 'insert')[0];
    expect(insert.payload).toEqual({
      conversation_id: CONVERSATION,
      admin_id: ADMIN,
      admin_name: 'Test Admin',
      kind: 'action',
      class: 'G',
      plan_id: null,
      plan_revision: null,
      tool_registry_version: 'r1',
      steps: [{ key: 's1', op: 'league_start' }],
      proposal_hash: HASH,
      preview: { title: 'x' },
      preview_hash: HASH,
      token_hash: TOKEN_HASH,
      acks_required: [],
      expires_at: LATER.toISOString(),
      supersede_key: 'league_start:abc',
      locale: 'en',
    });
    const supersede = db.to('admin_agent_proposals', 'update')[0];
    expect(supersede.payload).toEqual({ status: 'superseded' });
    expect(eqOf(supersede, 'supersede_key')).toBe('league_start:abc');
    expect(eqOf(supersede, 'status')).toBe('proposed');
    // Retired before the insert: a supersede failure refuses a staging that wrote nothing.
    expect(db.calls.indexOf(supersede)).toBeLessThan(db.calls.indexOf(insert));
  });

  it('refuses a staging whose supersede fails, and writes no new card', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'update', { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    db.on('admin_agent_proposals', 'insert', { data: proposal() });
    await expect(p.stageProposal(admin, { ...staged, supersedeKey: 'league_start:abc' })).rejects.toThrow();
    expect(db.to('admin_agent_proposals', 'insert')).toHaveLength(0);
  });

  it('inserts under the caller-chosen id (args_hash covers the proposal id) and leaves the id to the database otherwise', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'insert', { data: proposal() });
    await p.stageProposal(admin, { ...staged, id: PROPOSAL });
    await p.stageProposal(admin, staged);
    const [withId, withoutId] = db.to('admin_agent_proposals', 'insert');
    expect((withId.payload as { id?: string }).id).toBe(PROPOSAL);
    expect('id' in (withoutId.payload as object)).toBe(false);
  });

  it('does not touch other proposals without a supersede key', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'insert', { data: proposal() });
    await p.stageProposal(admin, staged);
    expect(db.to('admin_agent_proposals', 'update')).toHaveLength(0);
  });

  it('refuses beyond maxPending with the cap error and inserts nothing', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'select', { data: null, count: 2 });
    const error = await p.stageProposal(admin, { ...staged, maxPending: 2 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'agent_cap_reached', params: { limit: 2 } });
    expect(db.to('admin_agent_proposals', 'insert')).toHaveLength(0);
  });

  it('needs a plan that is the admin\'s in this conversation for a Build', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    await expect(p.stageProposal(admin, { ...staged, kind: 'build', planId: PLAN, planRevision: 1 })).rejects.toMatchObject({ code: 'plan_stale' });
    expect(db.to('admin_agent_proposals', 'insert')).toHaveLength(0);
  });

  it('stages again at the cap when the new proposal replaces one of the pending ones (the same key)', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    // Two pending in all; one of them carries the key the new proposal supersedes.
    db.when((call) => call.table === 'admin_agent_proposals' && call.op === 'select' && hasStep(call, 'eq', 'supersede_key', 'league_start:abc'), { data: null, count: 1 });
    db.on('admin_agent_proposals', 'select', { data: null, count: 2 });
    db.on('admin_agent_proposals', 'insert', { data: proposal() });
    await expect(p.stageProposal(admin, { ...staged, supersedeKey: 'league_start:abc', maxPending: 2 })).resolves.toBeTruthy();
    expect(db.to('admin_agent_proposals', 'insert')).toHaveLength(1);
    // A different key does not get the exemption.
    const second = setup();
    ownsConversation(second.db);
    second.db.when((call) => call.table === 'admin_agent_proposals' && call.op === 'select' && hasStep(call, 'eq', 'supersede_key', 'other:key'), { data: null, count: 0 });
    second.db.on('admin_agent_proposals', 'select', { data: null, count: 2 });
    await expect(second.p.stageProposal(admin, { ...staged, supersedeKey: 'other:key', maxPending: 2 })).rejects.toMatchObject({ code: 'agent_cap_reached' });
  });

  it('refuses a step payload that carries a webhook URL, and another admin\'s conversation', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    await expect(p.stageProposal(admin, { ...staged, steps: [{ url: 'https://discord.com/api/webhooks/1/x' }] })).rejects.toMatchObject({
      reason: 'payload_forbidden',
    });
    await expect(p.stageProposal(other, staged)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.to('admin_agent_proposals')).toHaveLength(0);
  });
});

describe('reads', () => {
  it('never selects the token hash or the approval fingerprint', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'select', { data: proposal() });
    await p.getProposal(admin, PROPOSAL);
    await p.listProposals(admin, CONVERSATION);
    await p.listPendingProposals(admin, CONVERSATION);
    for (const call of db.to('admin_agent_proposals', 'select')) {
      const columns = String(call.steps.find((s) => s[0] === 'select')?.[1]);
      expect(columns).not.toMatch(/token_hash|approved_ip_hash|approved_user_agent/);
    }
    const [one, list, pending] = db.to('admin_agent_proposals', 'select');
    expect(String(one.steps[0][1])).toContain('steps');
    expect(String(list.steps[0][1])).not.toContain('steps');
    expect(String(pending.steps[0][1])).not.toContain('steps');
  });

  it('scopes by admin, so another admin\'s proposal is not found', async () => {
    const { db, p } = setup();
    expect(await p.getProposal(other, PROPOSAL)).toBeNull();
    expect(eqOf(db.calls[0], 'admin_id')).toBe(OTHER_ADMIN);
    await expect(p.getProposalOrThrow(other, PROPOSAL)).rejects.toMatchObject({ code: 'proposal_not_found', statusCode: 404 });
    expect(await p.getProposal(admin, 'nope')).toBeNull();
  });

  it('lists the pending ones as proposed and unexpired', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'select', { data: [proposal()] });
    await p.listPendingProposals(admin, CONVERSATION);
    const call = db.to('admin_agent_proposals')[0];
    expect(eqOf(call, 'status')).toBe('proposed');
    expect(hasStep(call, 'gt', 'expires_at', NOW.toISOString())).toBe(true);
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
  });

  it('narrows a list by status', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    await p.listProposals(admin, CONVERSATION, { statuses: ['completed', 'failed'] });
    expect(hasStep(db.to('admin_agent_proposals')[0], 'in', 'status', ['completed', 'failed'])).toBe(true);
  });
});

describe('claimProposal (the replay protection)', () => {
  const claim = { tokenHash: TOKEN_HASH, ipHash: 'iphash', userAgent: 'U'.repeat(600) };

  it('flips proposed to executing in one statement bound to the admin, the token and the clock', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { data: proposal({ status: 'executing' }) });
    const claimed = await p.claimProposal(admin, PROPOSAL, claim);
    expect(claimed.status).toBe('executing');
    const call = db.calls[0];
    expect(call.payload).toEqual({
      status: 'executing',
      approved_by: ADMIN,
      approved_at: NOW.toISOString(),
      approved_ip_hash: 'iphash',
      approved_user_agent: 'U'.repeat(512),
      executing_started_at: NOW.toISOString(),
    });
    expect(eqOf(call, 'id')).toBe(PROPOSAL);
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
    expect(eqOf(call, 'status')).toBe('proposed');
    expect(eqOf(call, 'token_hash')).toBe(TOKEN_HASH);
    expect(hasStep(call, 'gt', 'expires_at', NOW.toISOString())).toBe(true);
    expect(db.calls).toHaveLength(1);
  });

  const refusal = (row: Record<string, unknown> | null) => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { data: null });
    db.on('admin_agent_proposals', 'select', { data: row });
    return p.claimProposal(admin, PROPOSAL, claim).catch((e: unknown) => e);
  };

  it.each([
    ['a missing or foreign proposal', null, 'proposal_not_found'],
    ['a replay or double click', { status: 'executing', expires_at: LATER.toISOString(), token_hash: TOKEN_HASH }, 'proposal_not_pending'],
    ['a declined proposal', { status: 'declined', expires_at: LATER.toISOString(), token_hash: TOKEN_HASH }, 'proposal_not_pending'],
    ['a wrong token', { status: 'proposed', expires_at: LATER.toISOString(), token_hash: 'c'.repeat(64) }, 'proposal_token_invalid'],
    ['an expired proposal', { status: 'proposed', expires_at: new Date(NOW.getTime() - 1000).toISOString(), token_hash: TOKEN_HASH }, 'proposal_expired'],
  ])('answers %s with %s', async (_label, row, code) => {
    expect(await refusal(row)).toMatchObject({ code, statusCode: expect.any(Number) });
  });

  it('carries the current status of a handled proposal for the response', async () => {
    const error = await refusal({ status: 'completed', expires_at: LATER.toISOString(), token_hash: TOKEN_HASH });
    expect(error).toMatchObject({ code: 'proposal_not_pending', detail: { status: 'completed' } });
  });

  it('checks the token before the expiry, so an expired proposal does not confirm a wrong guess', async () => {
    const error = await refusal({ status: 'proposed', expires_at: new Date(NOW.getTime() - 1000).toISOString(), token_hash: 'c'.repeat(64) });
    expect(error).toMatchObject({ code: 'proposal_token_invalid' });
  });

  it('maps the one-executing-per-conversation index to proposal_conflict_executing', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', {
      error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_admin_agent_proposals_executing"' },
    });
    await expect(p.claimProposal(admin, PROPOSAL, claim)).rejects.toMatchObject({ code: 'proposal_conflict_executing', statusCode: 409 });
  });

  it('maps any other failure to a db error', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { error: { code: '57014', message: 'timeout' } });
    await expect(p.claimProposal(admin, PROPOSAL, claim)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError' });
  });

  it('is not found for a malformed id without a query, and never claims for another admin', async () => {
    const { db, p } = setup();
    await expect(p.claimProposal(admin, 'nope', claim)).rejects.toMatchObject({ code: 'proposal_not_found' });
    expect(db.calls).toHaveLength(0);
    await expect(p.claimProposal(other, PROPOSAL, claim)).rejects.toMatchObject({ code: 'proposal_not_found' });
    expect(eqOf(db.calls[0], 'admin_id')).toBe(OTHER_ADMIN);
  });
});

describe('decline, finish, expire, reap', () => {
  it('declines a pending proposal and says why a handled one cannot be', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { data: proposal({ status: 'declined' }) });
    expect((await p.declineProposal(admin, PROPOSAL)).status).toBe('declined');
    expect(db.calls[0].payload).toEqual({ status: 'declined', finished_at: NOW.toISOString() });
    expect(eqOf(db.calls[0], 'status')).toBe('proposed');

    const handled = setup();
    handled.db.on('admin_agent_proposals', 'update', { data: null });
    handled.db.on('admin_agent_proposals', 'select', { data: proposal({ status: 'executing' }) });
    await expect(handled.p.declineProposal(admin, PROPOSAL)).rejects.toMatchObject({ code: 'proposal_not_pending', detail: { status: 'executing' } });

    const foreign = setup();
    await expect(foreign.p.declineProposal(other, PROPOSAL)).rejects.toMatchObject({ code: 'proposal_not_found' });
  });

  it('finishes only an executing proposal', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { data: proposal({ status: 'completed' }) });
    await p.finishProposal(admin, PROPOSAL, 'completed');
    expect(db.calls[0].payload).toEqual({ status: 'completed', finished_at: NOW.toISOString() });
    expect(eqOf(db.calls[0], 'status')).toBe('executing');

    const late = setup();
    late.db.on('admin_agent_proposals', 'update', { data: null });
    late.db.on('admin_agent_proposals', 'select', { data: proposal({ status: 'completed' }) });
    await expect(late.p.finishProposal(admin, PROPOSAL, 'failed')).rejects.toMatchObject({ code: 'proposal_not_pending' });
  });

  it('expires this admin\'s overdue proposals, optionally in one conversation', async () => {
    const { db, p } = setup();
    ownsConversation(db);
    db.on('admin_agent_proposals', 'update', { data: [{ id: 'a' }, { id: 'b' }] });
    expect(await p.expireProposals(admin, CONVERSATION)).toEqual(['a', 'b']);
    const call = db.to('admin_agent_proposals', 'update')[0];
    expect(call.payload).toEqual({ status: 'expired' });
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
    expect(eqOf(call, 'status')).toBe('proposed');
    expect(eqOf(call, 'conversation_id')).toBe(CONVERSATION);
    expect(hasStep(call, 'lt', 'expires_at', NOW.toISOString())).toBe(true);

    const all = setup();
    await all.p.expireProposals(admin);
    expect(eqOf(all.db.calls[0], 'conversation_id')).toBeUndefined();
  });

  it('reaps executing proposals older than the cutoff into unknown', async () => {
    const { db, p } = setup();
    db.on('admin_agent_proposals', 'update', { data: [{ id: PROPOSAL }] });
    const cutoff = new Date(NOW.getTime() - 600_000);
    expect(await p.reapExecutingProposals(admin, cutoff)).toEqual([PROPOSAL]);
    expect(db.calls[0].payload).toEqual({ status: 'unknown', finished_at: NOW.toISOString() });
    expect(eqOf(db.calls[0], 'status')).toBe('executing');
    expect(hasStep(db.calls[0], 'lt', 'executing_started_at', cutoff.toISOString())).toBe(true);
  });
});
