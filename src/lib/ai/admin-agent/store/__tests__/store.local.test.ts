import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { createAdminAgentStore, type AdminAgentStore } from '../create';
import { AdminAgentStoreError } from '../errors';
import { adminIdOf, type AdminId } from '../ids';
import type { AdminAgentDb } from '../context';
import type { NewAction, NewMessage, NewProposal } from '../types';

// LIVE-LOCAL test of the Admin Assistant store against the real tables and functions of a LOCAL Supabase stack
// (migration 20261027100000_admin_agent_tables.sql). The unit twins mock the client; this one proves what a mock cannot:
//   * the turn lease: eight concurrent acquires, exactly one wins; one turn per admin across conversations;
//   * seq allocation under contention, and idempotent client message ids;
//   * the plan revision compare-and-set: of two writers at the same revision exactly one wins;
//   * the atomic proposal claim: of several approvers with the right token exactly one wins;
//   * the usage reservation and the cap math: sequential and concurrent, settle and release, every cap;
//   * the blast-radius counters under concurrency;
//   * the triggers still holding behind the store (a ledger row never returns to executing).
//
// It seeds LOCAL data only, never loads `.env`, never runs in CI. Rows cannot be deleted through the API on purpose,
// so cleanup is the real retention purge: the test conversations are aged past the audit window first and the purge
// drops them with everything below them. The residue are `admin_agent_usage` rows (settled, admin_id NULL once the
// test players are gone): usage is kept for two years by design.
//
//   LOCAL_ADMIN_AGENT_STORE=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/ai/admin-agent/store/__tests__/store.local.test.ts
//
// The local key comes from `supabase status -o env` (SERVICE_ROLE_KEY).
const optIn = process.env.LOCAL_ADMIN_AGENT_STORE === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[admin-agent-store.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[admin-agent-store.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`);
  }
}

/** A key passed on the command line, never the vitest placeholder. */
function localServiceKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value === 'dummy-service-role-key') {
    throw new Error('[admin-agent-store.local] refusing to run: pass the LOCAL SUPABASE_SERVICE_ROLE_KEY on the command line');
  }
  return value;
}

if (optIn) {
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  localServiceKey();
}

const DAY = 86_400_000;
const SLOW = 5 * 60_000;
const MICRO = 1_000_000;
const HASH = (c: string) => c.repeat(64);
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const BIG = 1_000_000 * MICRO;

const NEW_CONVERSATION = {
  adminName: 'Store Test Admin',
  uiLocale: 'en',
  model: 'test-model',
  effort: 'medium',
  toolSet: 'site',
  toolRegistryVersion: 'r1',
  systemPromptVersion: 'p1',
} as const;

describe.skipIf(!optIn)('Admin Assistant store on the local stack', () => {
  let db: AdminAgentDb;
  let store: AdminAgentStore;
  const players: string[] = [];
  const conversations: string[] = [];

  async function newAdmin(name: string): Promise<AdminId> {
    const id = randomUUID();
    const { error } = await db.from('players').insert({ id, name: `aas_${name}_${id.slice(0, 8)}`, is_guest: true });
    if (error) throw new Error(`player ${name}: ${error.message}`);
    players.push(id);
    return adminIdOf(id);
  }

  async function newConversation(admin: AdminId) {
    const conversation = await store.conversations.createConversation(admin, NEW_CONVERSATION);
    conversations.push(conversation.id);
    return conversation;
  }

  const user = (text: string, clientMsgId?: string): NewMessage => ({ role: 'user', kind: 'chat', content: [{ type: 'text', text }], clientMsgId });

  beforeAll(async () => {
    db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL as string, localServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    store = createAdminAgentStore(db);
  }, SLOW);

  afterAll(async () => {
    for (const id of conversations) {
      await db.from('admin_agent_conversations').update({ last_message_at: ago(800) }).eq('id', id);
    }
    for (let i = 0; i < 5; i += 1) {
      const { data, error } = await db.rpc('admin_agent_retention_purge', {});
      if (error) {
        console.warn(`[admin-agent-store.local] cleanup purge: ${error.message}`);
        break;
      }
      if ((data as { conversations_deleted: number }).conversations_deleted === 0) break;
    }
    const { error } = await db.from('players').delete().in('id', players);
    if (error) console.warn(`[admin-agent-store.local] cleanup players: ${error.message}`);
  }, SLOW);

  describe('turn lease', () => {
    it('lets exactly one of eight concurrent acquires win, and the lease is free again after release', async () => {
      const admin = await newAdmin('lease');
      const { id } = await newConversation(admin);
      const results = await Promise.all(Array.from({ length: 8 }, () => store.conversations.acquireTurnLease(admin, id)));
      const winners = results.filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      for (const r of results.filter((x) => !x.ok)) expect(r).toEqual({ ok: false, reason: 'conversation_busy' });

      const lease = winners[0];
      if (!lease.ok) throw new Error('unreachable');
      expect(await store.conversations.releaseTurnLease(admin, id, '2000-01-01T00:00:00.000+00:00')).toBe(false);
      expect(await store.conversations.releaseTurnLease(admin, id, lease.leaseUntil)).toBe(true);
      expect((await store.conversations.acquireTurnLease(admin, id)).ok).toBe(true);
    });

    it('allows one turn per admin across conversations, but not across admins', async () => {
      const a = await newAdmin('lease-a');
      const b = await newAdmin('lease-b');
      const a1 = await newConversation(a);
      const a2 = await newConversation(a);
      const b1 = await newConversation(b);
      expect((await store.conversations.acquireTurnLease(a, a1.id)).ok).toBe(true);
      expect(await store.conversations.acquireTurnLease(a, a2.id)).toEqual({ ok: false, reason: 'admin_busy' });
      expect((await store.conversations.acquireTurnLease(b, b1.id)).ok).toBe(true);
    });

    it("is not found for another admin's conversation", async () => {
      const a = await newAdmin('lease-owner');
      const b = await newAdmin('lease-thief');
      const { id } = await newConversation(a);
      expect(await store.conversations.acquireTurnLease(b, id)).toEqual({ ok: false, reason: 'not_found' });
    });

    it('withTurnLease: of two concurrent turns one runs, the other gets the busy error, and the lease is released after', async () => {
      const admin = await newAdmin('with-lease');
      const { id } = await newConversation(admin);
      let running = 0;
      let peak = 0;
      const turn = () =>
        store.conversations.withTurnLease(admin, id, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 300));
          running -= 1;
          return 'ran';
        });
      const settled = await Promise.allSettled([turn(), turn()]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.find((s) => s.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(AdminAgentStoreError);
      expect(rejected?.status === 'rejected' && (rejected.reason as AdminAgentStoreError).code).toBe('agent_conversation_busy');
      expect(peak).toBe(1);
      expect(await store.conversations.withTurnLease(admin, id, async () => 'again')).toBe('again');
    });
  });

  describe('messages', () => {
    it('gives five concurrent appenders five distinct, contiguous numbers and keeps seq_head in step', async () => {
      const admin = await newAdmin('append');
      const { id } = await newConversation(admin);
      const appended = await Promise.all(Array.from({ length: 5 }, (_, i) => store.messages.appendMessage(admin, id, user(`m${i}`))));
      expect(appended.map((a) => a.message.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect((await store.conversations.getConversation(admin, id))?.seq_head).toBe(5);
      const history = await store.messages.loadHistory(admin, id);
      expect(history.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(history.truncated).toBe(false);
      expect((await store.messages.loadTail(admin, id, 2)).map((m) => m.seq)).toEqual([4, 5]);
    });

    it('stores a retried client message once, whether the retry is sequential or concurrent', async () => {
      const admin = await newAdmin('idempotent');
      const { id } = await newConversation(admin);
      const first = await store.messages.appendMessage(admin, id, user('hello', 'client-1'));
      const again = await store.messages.appendMessage(admin, id, user('hello', 'client-1'));
      expect(first.duplicate).toBe(false);
      expect(again).toMatchObject({ duplicate: true, message: { seq: first.message.seq } });

      const racers = await Promise.all([store.messages.appendMessage(admin, id, user('x', 'client-2')), store.messages.appendMessage(admin, id, user('x', 'client-2'))]);
      expect(racers.filter((r) => !r.duplicate)).toHaveLength(1);
      expect(new Set(racers.map((r) => r.message.seq)).size).toBe(1);
      expect((await store.messages.loadHistory(admin, id)).messages.filter((m) => m.client_msg_id === 'client-2')).toHaveLength(1);
    });

    it("never shows or writes another admin's transcript", async () => {
      const a = await newAdmin('transcript-owner');
      const b = await newAdmin('transcript-thief');
      const { id } = await newConversation(a);
      await store.messages.appendMessage(a, id, user('private'));
      await expect(store.messages.loadHistory(b, id)).rejects.toMatchObject({ code: 'conversation_not_found' });
      await expect(store.messages.appendMessage(b, id, user('injected'))).rejects.toMatchObject({ code: 'conversation_not_found' });
      expect(await store.conversations.getConversation(b, id)).toBeNull();
      expect((await store.conversations.listConversations(b)).items.map((c) => c.id)).not.toContain(id);
      expect((await store.messages.loadHistory(a, id)).messages).toHaveLength(1);
    });

    it('refuses a forbidden payload without writing', async () => {
      const admin = await newAdmin('hygiene');
      const { id } = await newConversation(admin);
      await expect(
        store.messages.appendMessage(admin, id, { role: 'assistant', kind: 'chat', content: [{ type: 'tool_use', id: 't', name: 'x', input: { discord_id: '1' } }] }),
      ).rejects.toMatchObject({ reason: 'payload_forbidden' });
      expect((await store.conversations.getConversation(admin, id))?.seq_head).toBe(0);
    });
  });

  describe('plans', () => {
    it('lets exactly one of two writers at the same revision win, with a complete history', async () => {
      const admin = await newAdmin('plan');
      const { id } = await newConversation(admin);
      const plan = await store.plans.createPlan(admin, { conversationId: id, mode: 'create', doc: { v: 1 }, docHash: HASH('a') });
      expect(plan.revision).toBe(1);
      expect((await store.plans.getActivePlan(admin, id))?.id).toBe(plan.id);

      const proposal = await store.proposals.stageProposal(admin, {
        conversationId: id,
        kind: 'build',
        class: 'B',
        planId: plan.id,
        planRevision: 1,
        toolRegistryVersion: 'r1',
        steps: [{ key: 's1' }],
        proposalHash: HASH('b'),
        preview: {},
        previewHash: HASH('c'),
        tokenHash: HASH('d'),
        expiresAt: new Date(Date.now() + 60_000),
        locale: 'en',
      });

      const write = (n: number) => store.plans.writePlanRevision(admin, plan.id, { expectedRevision: 1, doc: { v: n }, docHash: HASH('e'), author: 'agent' });
      const settled = await Promise.allSettled([write(2), write(3)]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const lost = settled.find((s) => s.status === 'rejected');
      expect(lost?.status === 'rejected' && (lost.reason as AdminAgentStoreError).code).toBe('plan_stale');

      const current = await store.plans.getPlan(admin, plan.id);
      expect(current?.revision).toBe(2);
      const revisions = await store.plans.listRevisions(admin, plan.id);
      expect(revisions.map((r) => r.revision)).toEqual([2, 1]);
      expect(revisions[0].doc).toEqual(current?.doc);
      // The pending Build of revision 1 was superseded by the revision.
      expect((await store.proposals.getProposal(admin, proposal.id))?.status).toBe('superseded');

      const next = await store.plans.writePlanRevision(admin, plan.id, { expectedRevision: 2, doc: { v: 4 }, docHash: HASH('f'), author: 'admin', status: 'ready' });
      expect(next.plan).toMatchObject({ revision: 3, status: 'ready' });
    });

    it("is not found for another admin's plan", async () => {
      const a = await newAdmin('plan-owner');
      const b = await newAdmin('plan-thief');
      const { id } = await newConversation(a);
      const plan = await store.plans.createPlan(a, { conversationId: id, mode: 'amend', doc: {}, docHash: HASH('a') });
      expect(await store.plans.getPlan(b, plan.id)).toBeNull();
      await expect(store.plans.writePlanRevision(b, plan.id, { expectedRevision: 1, doc: {}, docHash: HASH('a'), author: 'admin' })).rejects.toMatchObject({
        code: 'conversation_not_found',
      });
      await expect(store.plans.createPlan(b, { conversationId: id, mode: 'create', doc: {}, docHash: HASH('a') })).rejects.toMatchObject({ code: 'conversation_not_found' });
    });
  });

  describe('proposals', () => {
    const base = (conversationId: string, token: string, extra: Partial<NewProposal> = {}): NewProposal => ({
        conversationId,
        kind: 'action',
        class: 'G',
        toolRegistryVersion: 'r1',
        steps: [{ key: 's1' }],
        proposalHash: HASH('b'),
        preview: {},
        previewHash: HASH('c'),
        tokenHash: HASH(token),
        expiresAt: new Date(Date.now() + 60_000),
        locale: 'en',
        ...extra,
      });

    it('lets exactly one of four concurrent approvers claim, and refuses the rest as already handled', async () => {
      const admin = await newAdmin('claim');
      const { id } = await newConversation(admin);
      const proposal = await store.proposals.stageProposal(admin, base(id, 'a'));
      expect(proposal.status).toBe('proposed');
      expect((await store.proposals.listPendingProposals(admin, id)).map((p) => p.id)).toEqual([proposal.id]);

      const settled = await Promise.allSettled(Array.from({ length: 4 }, () => store.proposals.claimProposal(admin, proposal.id, { tokenHash: HASH('a'), ipHash: 'h', userAgent: 'ua' })));
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      for (const s of settled.filter((x) => x.status === 'rejected')) {
        expect(s.status === 'rejected' && (s.reason as AdminAgentStoreError).code).toMatch(/^proposal_(not_pending|conflict_executing)$/);
      }
      const claimed = await store.proposals.getProposal(admin, proposal.id);
      expect(claimed).toMatchObject({ status: 'executing', approved_by: admin });
      expect(claimed).not.toHaveProperty('token_hash');

      expect((await store.proposals.finishProposal(admin, proposal.id, 'completed')).status).toBe('completed');
      await expect(store.proposals.claimProposal(admin, proposal.id, { tokenHash: HASH('a') })).rejects.toMatchObject({ code: 'proposal_not_pending' });
    });

    it('tells a wrong token, an expired proposal and another admin\'s proposal apart', async () => {
      const a = await newAdmin('claim-a');
      const b = await newAdmin('claim-b');
      const { id } = await newConversation(a);
      const live = await store.proposals.stageProposal(a, base(id, 'a'));
      await expect(store.proposals.claimProposal(a, live.id, { tokenHash: HASH('9') })).rejects.toMatchObject({ code: 'proposal_token_invalid' });
      await expect(store.proposals.claimProposal(b, live.id, { tokenHash: HASH('a') })).rejects.toMatchObject({ code: 'proposal_not_found' });
      expect((await store.proposals.getProposal(a, live.id))?.status).toBe('proposed');

      const old = await store.proposals.stageProposal(a, base(id, 'e', { expiresAt: new Date(Date.now() - 1000) }));
      await expect(store.proposals.claimProposal(a, old.id, { tokenHash: HASH('e') })).rejects.toMatchObject({ code: 'proposal_expired' });
      expect(await store.proposals.expireProposals(a, id)).toEqual([old.id]);
      expect((await store.proposals.getProposal(a, old.id))?.status).toBe('expired');
    });

    it('allows one executing proposal per conversation, supersedes by key, caps pending ones and declines', async () => {
      const admin = await newAdmin('conflict');
      const { id } = await newConversation(admin);
      const one = await store.proposals.stageProposal(admin, base(id, 'a', { supersedeKey: 'tool:target' }));
      const two = await store.proposals.stageProposal(admin, base(id, 'b', { supersedeKey: 'tool:target' }));
      expect((await store.proposals.getProposal(admin, one.id))?.status).toBe('superseded');
      expect((await store.proposals.getProposal(admin, two.id))?.status).toBe('proposed');

      const three = await store.proposals.stageProposal(admin, base(id, 'c'));
      await expect(store.proposals.stageProposal(admin, { ...base(id, 'd'), maxPending: 2 })).rejects.toMatchObject({ code: 'agent_cap_reached' });

      await store.proposals.claimProposal(admin, two.id, { tokenHash: HASH('b') });
      await expect(store.proposals.claimProposal(admin, three.id, { tokenHash: HASH('c') })).rejects.toMatchObject({ code: 'proposal_conflict_executing' });
      expect((await store.proposals.declineProposal(admin, three.id)).status).toBe('declined');
      await expect(store.proposals.declineProposal(admin, three.id)).rejects.toMatchObject({ code: 'proposal_not_pending' });

      expect(await store.proposals.reapExecutingProposals(admin, new Date(Date.now() + 1000))).toEqual([two.id]);
      expect((await store.proposals.getProposal(admin, two.id))?.status).toBe('unknown');
    });
  });

  describe('ledger, refs and snapshots', () => {
    it('inserts the ledger row once per dispatch key and completes it; a finished row never reopens', async () => {
      const admin = await newAdmin('ledger');
      const { id } = await newConversation(admin);
      const input: NewAction = { conversationId: id, toolUseId: 'toolu_1', toolName: 'format_save_draft', class: 'D', args: { n: 1 }, argsHash: HASH('a') };
      const first = await store.actions.insertAction(admin, input);
      expect(first.inserted).toBe(true);
      expect(await store.actions.insertAction(admin, input)).toEqual({ inserted: false });
      if (!first.inserted) throw new Error('unreachable');

      const done = await store.actions.completeAction(admin, first.action.id, { status: 'ok', httpStatus: 200, entityType: 'format', entityId: randomUUID(), result: { ok: true } });
      expect(done).toMatchObject({ status: 'ok', http_status: 200 });
      await expect(store.actions.completeAction(admin, first.action.id, { status: 'executing' })).rejects.toMatchObject({
        name: 'AdminAgentStoreDbError',
        dbCode: 'ADMIN_AGENT_STATUS_REGRESS',
      });
      expect((await store.actions.getActionByToolUse(admin, id, 'toolu_1'))?.id).toBe(first.action.id);
      expect((await store.actions.listActions(admin, id)).map((a) => a.id)).toEqual([first.action.id]);

      const snapshot = await store.snapshots.insertSnapshot(admin, { actionId: first.action.id, document: { before: 1 }, docHash: HASH('b') });
      expect((await store.snapshots.insertSnapshot(admin, { actionId: first.action.id, document: { before: 2 }, docHash: HASH('c') })).id).toBe(snapshot.id);
      expect((await store.snapshots.getSnapshot(admin, first.action.id))?.document).toEqual({ before: 1 });
    });

    it("keeps a step key unique per proposal and hides the ledger and snapshots from other admins", async () => {
      const a = await newAdmin('ledger-a');
      const b = await newAdmin('ledger-b');
      const { id } = await newConversation(a);
      const proposal = await store.proposals.stageProposal(a, {
        conversationId: id,
        kind: 'action',
        class: 'B',
        toolRegistryVersion: 'r1',
        steps: [{ key: 's1' }],
        proposalHash: HASH('b'),
        preview: {},
        previewHash: HASH('c'),
        tokenHash: HASH('d'),
        expiresAt: new Date(Date.now() + 60_000),
        locale: 'en',
      });
      const step: NewAction = { conversationId: id, toolName: 'league_create', class: 'B', proposalId: proposal.id, stepKey: 's1', args: {}, argsHash: HASH('a') };
      const inserted = await store.actions.insertAction(a, step);
      expect(inserted.inserted).toBe(true);
      expect(await store.actions.insertAction(a, step)).toEqual({ inserted: false });
      await expect(store.actions.insertAction(b, step)).rejects.toMatchObject({ code: 'conversation_not_found' });
      if (!inserted.inserted) throw new Error('unreachable');
      expect(await store.actions.getAction(b, inserted.action.id)).toBeNull();
      expect(await store.snapshots.getSnapshot(b, inserted.action.id)).toBeNull();
      expect(await store.actions.listProposalActions(b, proposal.id)).toEqual([]);
      expect((await store.actions.listProposalActions(a, proposal.id)).map((x) => x.step_key)).toEqual(['s1']);
    });

    it('records refs insert-only and answers which ids a conversation has seen', async () => {
      const admin = await newAdmin('refs');
      const { id } = await newConversation(admin);
      const seen = randomUUID();
      const unseen = randomUUID();
      expect(await store.refs.recordRefs(admin, id, [{ kind: 'season', id: seen, label: 'League A', source: 'tool_result' }])).toBe(1);
      await store.refs.recordRefs(admin, id, [{ kind: 'season', id: seen, label: 'Renamed', source: 'user_message' }]);
      const known = await store.refs.knownRefIds(admin, id, [seen, unseen]);
      expect([...known]).toEqual([seen]);
      expect((await store.refs.listRefs(admin, id, 'season'))[0]).toMatchObject({ label: 'League A', source: 'tool_result' });
      const thief = await newAdmin('refs-thief');
      await expect(store.refs.knownRefIds(thief, id, [seen])).rejects.toMatchObject({ code: 'conversation_not_found' });
    });
  });

  describe('usage reservation and caps', () => {
    const caps = (over: Partial<Record<'conversationMicro' | 'adminDayMicro' | 'adminMonthMicro' | 'globalDayMicro', number>> = {}) => ({
      conversationMicro: BIG,
      adminDayMicro: BIG,
      adminMonthMicro: BIG,
      globalDayMicro: BIG,
      ...over,
    });
    const reserve = (admin: AdminId, conversationId: string | null, estimateUsdMicro: number, c: ReturnType<typeof caps>) =>
      store.usage.reserveUsage(admin, { adminName: 'Store Test Admin', conversationId, purpose: 'turn', model: 'test-model', estimateUsdMicro, caps: c });
    const settle = (admin: AdminId, usageId: string, costUsdMicro: number) =>
      store.usage.settleUsage(admin, usageId, { inputTokens: 1, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 1, costUsdMicro, stopReason: 'end_turn' });

    it('counts reservations as spent until settled, then the real cost, and refuses at the conversation cap', async () => {
      const admin = await newAdmin('usage-conv');
      const { id } = await newConversation(admin);
      const c = caps({ conversationMicro: MICRO });
      const one = await reserve(admin, id, 400_000, c);
      const two = await reserve(admin, id, 400_000, c);
      expect(one.ok && two.ok).toBe(true);
      // 800k reserved: a third 400k would reach 1.2M.
      expect(await reserve(admin, id, 400_000, c)).toEqual({ ok: false, exceeded: 'conversation', usedMicro: 800_000, capMicro: MICRO });
      // Exactly reaching the cap is allowed; passing it by one micro-dollar is not.
      const exact = await reserve(admin, id, 200_000, c);
      expect(exact.ok).toBe(true);
      expect(await reserve(admin, id, 1, c)).toMatchObject({ ok: false, exceeded: 'conversation', usedMicro: MICRO });

      if (!one.ok || !two.ok || !exact.ok) throw new Error('unreachable');
      // Settling replaces the reservation with the real cost; a cheaper call frees room.
      expect(await settle(admin, one.usageId, 100_000)).toBe(true);
      expect(await settle(admin, one.usageId, 100_000)).toBe(false);
      expect((await store.usage.getSpend(admin, id)).conversationMicro).toBe(100_000 + 400_000 + 200_000);
      expect((await reserve(admin, id, 300_000, c)).ok).toBe(true);
      // A released call (never made) costs nothing.
      expect(await store.usage.releaseUsage(admin, two.usageId)).toBe(true);
      expect((await store.usage.getSpend(admin, id)).conversationMicro).toBe(100_000 + 0 + 200_000 + 300_000);
    });

    it('lets exactly three of eight concurrent reservations through a day cap that fits three', async () => {
      const admin = await newAdmin('usage-race');
      const { id } = await newConversation(admin);
      const c = caps({ adminDayMicro: MICRO });
      const results = await Promise.all(Array.from({ length: 8 }, () => reserve(admin, id, 300_000, c)));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false, exceeded: 'admin_day', capMicro: MICRO });
      const spend = await store.usage.getSpend(admin, id);
      expect(spend).toMatchObject({ conversationMicro: 900_000, adminDayMicro: 900_000, adminMonthMicro: 900_000 });
    });

    it('enforces the month cap and keeps usage outside a conversation (a title call) in the admin\'s sums', async () => {
      const admin = await newAdmin('usage-month');
      const c = caps({ adminMonthMicro: 500_000 });
      const title = await reserve(admin, null, 300_000, c);
      expect(title.ok).toBe(true);
      expect(await reserve(admin, null, 300_000, c)).toEqual({ ok: false, exceeded: 'admin_month', usedMicro: 300_000, capMicro: 500_000 });
      expect((await store.usage.getSpend(admin)).adminMonthMicro).toBe(300_000);
    });

    it('enforces the global day cap across admins', async () => {
      const a = await newAdmin('usage-global-a');
      const b = await newAdmin('usage-global-b');
      const before = (await store.usage.getGlobalDaySpend(a)).micro;
      const c = caps({ globalDayMicro: before + 500_000 });
      expect((await reserve(a, null, 300_000, c)).ok).toBe(true);
      const refused = await reserve(b, null, 300_000, c);
      expect(refused).toMatchObject({ ok: false, exceeded: 'global_day', capMicro: before + 500_000 });
      expect((await store.usage.getGlobalDaySpend(b)).micro).toBe(before + 300_000);
    });

    it("settles only the admin's own reservation and bills only the admin's own conversation", async () => {
      const a = await newAdmin('usage-own');
      const b = await newAdmin('usage-other');
      const { id } = await newConversation(a);
      const reserved = await reserve(a, id, 100_000, caps());
      if (!reserved.ok) throw new Error('unreachable');
      await expect(settle(b, reserved.usageId, 1)).rejects.toMatchObject({ reason: 'usage_not_found' });
      await expect(reserve(b, id, 100_000, caps())).rejects.toMatchObject({ code: 'conversation_not_found' });
      expect(await settle(a, reserved.usageId, 1)).toBe(true);
    });
  });

  describe('blast-radius counters', () => {
    it('lets exactly three of six concurrent claims through a cap of three, all or nothing', async () => {
      const admin = await newAdmin('blast');
      const { id } = await newConversation(admin);
      const results = await Promise.all(Array.from({ length: 6 }, () => store.conversations.claimBudget(admin, id, [{ counter: 'league_creates', amount: 1, cap: 3 }])));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      for (const r of results.filter((x) => !x.ok)) expect(r).toEqual({ ok: false, counter: 'league_creates', value: 3, cap: 3 });

      // A claim over two counters changes neither when one of them is over its cap.
      const mixed = await store.conversations.claimBudget(admin, id, [
        { counter: 'tournament_creates', amount: 1, cap: 3 },
        { counter: 'league_creates', amount: 1, cap: 3 },
      ]);
      expect(mixed).toEqual({ ok: false, counter: 'league_creates', value: 3, cap: 3 });
      expect(await store.conversations.getConversation(admin, id)).toMatchObject({ blast_league_creates: 3, blast_tournament_creates: 0 });
    });
  });

  describe('conversations', () => {
    it('lists newest activity first, compare-and-sets titles and hides other admins\' conversations', async () => {
      const a = await newAdmin('list-a');
      const b = await newAdmin('list-b');
      const older = await newConversation(a);
      const newer = await newConversation(a);
      await store.messages.appendMessage(a, newer.id, user('bump'));
      const page = await store.conversations.listConversations(a);
      expect(page.total).toBe(2);
      expect(page.items.map((c) => c.id)).toEqual([newer.id, older.id]);
      expect((await store.conversations.listConversations(b)).total).toBe(0);

      const titled = await store.conversations.updateConversation(a, older.id, { title: 'Set up league' }, older.version);
      expect(titled).toMatchObject({ title: 'Set up league', version: older.version + 1 });
      expect(await store.conversations.updateConversation(a, older.id, { title: 'Late' }, older.version)).toBeNull();
      await expect(store.conversations.updateConversation(b, older.id, { title: 'x' }, older.version + 1)).rejects.toMatchObject({ code: 'conversation_not_found' });
      expect((await store.conversations.updateConversation(a, older.id, { status: 'archived' }, older.version + 1))?.status).toBe('archived');
      expect((await store.conversations.listConversations(a, { status: 'archived' })).total).toBe(1);
    });
  });
});
