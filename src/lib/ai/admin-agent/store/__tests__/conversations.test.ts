/** Conversations, the turn lease and the blast-radius claim against a recording client. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import { AdminAgentStoreError } from '../errors';
import { TURN_LEASE_SECONDS } from '../conversations';
import { ADMIN, CONVERSATION, FakeDb, NOW, OTHER_ADMIN, eqOf, hasStep, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, c: store.conversations };
}

const row = (overrides: Record<string, unknown> = {}) => ({ id: CONVERSATION, admin_id: ADMIN, version: 1, title: null, ...overrides });

afterEach(() => vi.restoreAllMocks());

describe('createConversation / getConversation / listConversations', () => {
  it('creates with the acting admin, the pinned model and versions, and a seed object by default', async () => {
    const { db, c } = setup();
    db.on('admin_agent_conversations', 'insert', { data: row() });
    await c.createConversation(admin, {
      adminName: 'Ann',
      uiLocale: 'de',
      model: 'claude-opus-5-5',
      effort: 'medium',
      toolSet: 'site',
      toolRegistryVersion: 'r1',
      systemPromptVersion: 'p1',
    });
    expect(db.calls[0].payload).toEqual({
      admin_id: ADMIN,
      admin_name: 'Ann',
      ui_locale: 'de',
      context: {},
      model: 'claude-opus-5-5',
      effort: 'medium',
      tool_set: 'site',
      tool_registry_version: 'r1',
      system_prompt_version: 'p1',
    });
  });

  it('reads by id AND admin, and answers null for a malformed id without a query', async () => {
    const { db, c } = setup();
    db.on('admin_agent_conversations', 'select', { data: row() });
    expect(await c.getConversation(admin, CONVERSATION)).toEqual(row());
    expect(eqOf(db.calls[0], 'id')).toBe(CONVERSATION);
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
    expect(await c.getConversation(admin, 'nope')).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it("answers null for another admin's conversation (the filter, not the caller, hides it)", async () => {
    const { db, c } = setup();
    ownsConversation(db);
    expect(await c.getConversation(other, CONVERSATION)).toBeNull();
    expect(eqOf(db.calls[0], 'admin_id')).toBe(OTHER_ADMIN);
  });

  it('lists the admin\'s conversations newest first, with a clamped page and the exact total', async () => {
    const { db, c } = setup();
    db.on('admin_agent_conversations', 'select', { data: [row()], count: 7 });
    const page = await c.listConversations(admin, { status: 'archived', limit: 1000, offset: -5 });
    expect(page).toEqual({ items: [row()], total: 7 });
    const call = db.calls[0];
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
    expect(eqOf(call, 'status')).toBe('archived');
    expect(hasStep(call, 'order', 'last_message_at', { ascending: false })).toBe(true);
    expect(hasStep(call, 'range', 0, 99)).toBe(true);
  });
});

describe('updateConversation (compare-and-set on version)', () => {
  it('writes only when the version is unchanged and bumps it', async () => {
    const { db, c } = setup();
    db.on('admin_agent_conversations', 'update', { data: row({ version: 4, title: 'T' }) });
    const result = await c.updateConversation(admin, CONVERSATION, { title: 'T' }, 3);
    expect(result?.version).toBe(4);
    const call = db.calls[0];
    expect(call.payload).toEqual({ title: 'T', version: 4 });
    expect(eqOf(call, 'version')).toBe(3);
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
  });

  it('returns null when the version moved on and throws not-found for a row that is not the admin\'s', async () => {
    const { db, c } = setup();
    db.when((x) => x.op === 'update', { data: null });
    ownsConversation(db);
    expect(await c.updateConversation(admin, CONVERSATION, { status: 'archived' }, 1)).toBeNull();
    await expect(c.updateConversation(other, CONVERSATION, { status: 'archived' }, 1)).rejects.toMatchObject({ code: 'conversation_not_found' });
  });
});

describe('turn lease', () => {
  it('acquires through the SQL function with the admin and the 320 s default', async () => {
    const { db, c } = setup();
    db.onRpc('admin_agent_acquire_turn_lease', { data: [{ out_lease_until: '2026-10-27T12:05:20.123+00:00', out_busy: null }] });
    expect(await c.acquireTurnLease(admin, CONVERSATION)).toEqual({ ok: true, leaseUntil: '2026-10-27T12:05:20.123+00:00' });
    expect(db.rpcCalls[0]).toEqual({
      name: 'admin_agent_acquire_turn_lease',
      args: { p_conversation_id: CONVERSATION, p_admin_id: ADMIN, p_lease_seconds: TURN_LEASE_SECONDS },
    });
    expect(TURN_LEASE_SECONDS).toBe(320);
  });

  it.each(['conversation_busy', 'admin_busy', 'not_found'] as const)('reports %s', async (reason) => {
    const { db, c } = setup();
    db.onRpc('admin_agent_acquire_turn_lease', { data: [{ out_lease_until: null, out_busy: reason }] });
    expect(await c.acquireTurnLease(admin, CONVERSATION)).toEqual({ ok: false, reason });
  });

  it('is not found for a malformed conversation id without calling the database', async () => {
    const { db, c } = setup();
    expect(await c.acquireTurnLease(admin, 'x')).toEqual({ ok: false, reason: 'not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('throws a db error when the function answers neither a lease nor a reason, and when it fails', async () => {
    const { db, c } = setup();
    db.onRpc('admin_agent_acquire_turn_lease', { data: [] }, true);
    await expect(c.acquireTurnLease(admin, CONVERSATION)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError' });
    db.onRpc('admin_agent_acquire_turn_lease', { error: { code: 'P0001', message: 'ADMIN_AGENT_BAD_ARGUMENT' } }, true);
    await expect(c.acquireTurnLease(admin, CONVERSATION, 0)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', dbCode: 'ADMIN_AGENT_BAD_ARGUMENT' });
  });

  it('releases only a lease that is still ours, scoped to the admin', async () => {
    const { db, c } = setup();
    db.on('admin_agent_conversations', 'update', { data: [{ id: CONVERSATION }] });
    expect(await c.releaseTurnLease(admin, CONVERSATION, '2026-10-27T12:05:20.123+00:00')).toBe(true);
    const call = db.calls[0];
    expect(call.payload).toEqual({ turn_lease_until: null });
    expect(eqOf(call, 'admin_id')).toBe(ADMIN);
    expect(eqOf(call, 'turn_lease_until')).toBe('2026-10-27T12:05:20.123+00:00');

    const second = setup();
    second.db.on('admin_agent_conversations', 'update', { data: [] });
    expect(await second.c.releaseTurnLease(admin, CONVERSATION, '2000-01-01T00:00:00.000+00:00')).toBe(false);
    expect(second.db.calls).toHaveLength(1);
    // A lease string that is not a timestamp never reaches the database.
    expect(await second.c.releaseTurnLease(admin, CONVERSATION, 'taken-over')).toBe(false);
    expect(second.db.calls).toHaveLength(1);
  });

  describe('withTurnLease', () => {
    const lease = { data: [{ out_lease_until: '2026-10-27T12:05:20.123+00:00', out_busy: null }] };

    it('runs the work under the lease and releases in finally', async () => {
      const { db, c } = setup();
      db.onRpc('admin_agent_acquire_turn_lease', lease);
      db.on('admin_agent_conversations', 'update', { data: [{ id: CONVERSATION }] });
      const seen = await c.withTurnLease(admin, CONVERSATION, async ({ leaseUntil }) => `ran with ${leaseUntil}`);
      expect(seen).toBe('ran with 2026-10-27T12:05:20.123+00:00');
      expect(db.to('admin_agent_conversations', 'update')).toHaveLength(1);
    });

    it('releases when the work throws and rethrows the work\'s error', async () => {
      const { db, c } = setup();
      db.onRpc('admin_agent_acquire_turn_lease', lease);
      db.on('admin_agent_conversations', 'update', { data: [{ id: CONVERSATION }] });
      await expect(
        c.withTurnLease(admin, CONVERSATION, async () => {
          throw new Error('model exploded');
        }),
      ).rejects.toThrow('model exploded');
      expect(db.to('admin_agent_conversations', 'update')).toHaveLength(1);
    });

    it('throws the catalogued busy error without running the work', async () => {
      const { db, c } = setup();
      db.onRpc('admin_agent_acquire_turn_lease', { data: [{ out_lease_until: null, out_busy: 'conversation_busy' }] }, true);
      const work = vi.fn();
      const error = await c.withTurnLease(admin, CONVERSATION, work).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdminAgentStoreError);
      expect(error).toMatchObject({ code: 'agent_conversation_busy', statusCode: 409 });
      expect(work).not.toHaveBeenCalled();
      expect(db.to('admin_agent_conversations', 'update')).toHaveLength(0);

      db.onRpc('admin_agent_acquire_turn_lease', { data: [{ out_lease_until: null, out_busy: 'admin_busy' }] }, true);
      await expect(c.withTurnLease(admin, CONVERSATION, work)).rejects.toMatchObject({ code: 'agent_admin_busy' });
      db.onRpc('admin_agent_acquire_turn_lease', { data: [{ out_lease_until: null, out_busy: 'not_found' }] }, true);
      await expect(c.withTurnLease(admin, CONVERSATION, work)).rejects.toMatchObject({ code: 'conversation_not_found', statusCode: 404 });
    });

    it('logs a failed release and still returns the work\'s result', async () => {
      const { db, c } = setup();
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      db.onRpc('admin_agent_acquire_turn_lease', lease);
      db.on('admin_agent_conversations', 'update', { error: { code: '57014', message: 'timeout' } });
      expect(await c.withTurnLease(admin, CONVERSATION, async () => 'done')).toBe('done');
      expect(log).toHaveBeenCalledOnce();
    });
  });
});

describe('claimBudget (blast radius)', () => {
  const claims = [{ counter: 'league_creates', amount: 1, cap: 3 }] as const;

  it('proves ownership, then claims all or nothing through the SQL function', async () => {
    const { db, c } = setup();
    ownsConversation(db);
    db.onRpc('admin_agent_claim_budget', { data: [{ out_ok: true, out_counter: null, out_value: null, out_cap: null }] });
    expect(await c.claimBudget(admin, CONVERSATION, claims)).toEqual({ ok: true });
    expect(db.rpcCalls[0].args).toEqual({ p_conversation_id: CONVERSATION, p_claims: [{ counter: 'league_creates', amount: 1, cap: 3 }] });
  });

  it('names the counter that is over its cap', async () => {
    const { db, c } = setup();
    ownsConversation(db);
    db.onRpc('admin_agent_claim_budget', { data: [{ out_ok: false, out_counter: 'league_creates', out_value: 3, out_cap: 3 }] });
    expect(await c.claimBudget(admin, CONVERSATION, claims)).toEqual({ ok: false, counter: 'league_creates', value: 3, cap: 3 });
  });

  it("never reaches the function for another admin's conversation", async () => {
    const { db, c } = setup();
    ownsConversation(db);
    await expect(c.claimBudget(other, CONVERSATION, claims)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });
});
