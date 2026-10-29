/** The usage ledger: reservation before the call, settlement after, the caps, the windows and the sums. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import { budgetExceededError, defaultUsageCaps, usageWindows } from '../usage';
import { ADMIN, CONVERSATION, FakeDb, NOW, OTHER_ADMIN, USAGE, eqOf, hasStep, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);
const MICRO = 1_000_000;
const caps = { conversationMicro: 5 * MICRO, adminDayMicro: 20 * MICRO, adminMonthMicro: 120 * MICRO, globalDayMicro: 80 * MICRO };
const reservation = { adminName: 'Ann', conversationId: CONVERSATION, purpose: 'turn', model: 'claude-opus-5-5', estimateUsdMicro: 250_000, caps } as const;
const settlement = { inputTokens: 10, cacheWrite5mTokens: 0, cacheWrite1hTokens: 100, cacheReadTokens: 5000, outputTokens: 300, costUsdMicro: 123_456, stopReason: 'end_turn' };

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, u: store.usage };
}

afterEach(() => vi.unstubAllEnvs());

describe('usageWindows', () => {
  it('starts the day and the month at UTC midnight', () => {
    expect(usageWindows(new Date('2026-10-27T23:59:59.999Z'))).toEqual({ daySince: '2026-10-27T00:00:00.000Z', monthSince: '2026-10-01T00:00:00.000Z' });
    expect(usageWindows(new Date('2026-12-01T00:00:00.000Z'))).toEqual({ daySince: '2026-12-01T00:00:00.000Z', monthSince: '2026-12-01T00:00:00.000Z' });
  });
});

describe('defaultUsageCaps', () => {
  it('reads the Q7 defaults in micro-dollars and honours the env overrides at call time', () => {
    expect(defaultUsageCaps()).toEqual(caps);
    vi.stubEnv('ADMIN_AGENT_BUDGET_CONVERSATION_USD', '2.5');
    vi.stubEnv('ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD', '10');
    expect(defaultUsageCaps()).toMatchObject({ conversationMicro: 2_500_000, globalDayMicro: 10_000_000, adminDayMicro: 20 * MICRO });
  });
});

describe('reserveUsage', () => {
  it('reserves through the SQL function with all four caps and the window starts', async () => {
    const { db, u } = setup();
    ownsConversation(db);
    db.onRpc('admin_agent_reserve_usage', { data: [{ out_usage_id: USAGE, out_exceeded: null, out_used: null, out_cap: null }] });
    expect(await u.reserveUsage(admin, reservation)).toEqual({ ok: true, usageId: USAGE });
    expect(db.rpcCalls[0]).toEqual({
      name: 'admin_agent_reserve_usage',
      args: {
        p_admin_id: ADMIN,
        p_admin_name: 'Ann',
        p_conversation_id: CONVERSATION,
        p_purpose: 'turn',
        p_model: 'claude-opus-5-5',
        p_estimate_usd_micro: 250_000,
        p_cap_conversation: 5 * MICRO,
        p_cap_admin_day: 20 * MICRO,
        p_cap_admin_month: 120 * MICRO,
        p_cap_global_day: 80 * MICRO,
        p_day_since: '2026-10-27T00:00:00.000Z',
        p_month_since: '2026-10-01T00:00:00.000Z',
      },
    });
  });

  it('uses the configured caps when none are passed, and needs no conversation for a title call', async () => {
    const { db, u } = setup();
    db.onRpc('admin_agent_reserve_usage', { data: [{ out_usage_id: USAGE, out_exceeded: null, out_used: null, out_cap: null }] });
    await u.reserveUsage(admin, { ...reservation, conversationId: null, purpose: 'title', caps: undefined });
    expect(db.rpcCalls[0].args).toMatchObject({ p_conversation_id: null, p_purpose: 'title', p_cap_conversation: 5 * MICRO, p_cap_global_day: 80 * MICRO });
    expect(db.calls).toHaveLength(0);
  });

  it.each([
    ['conversation', 'agent_budget_conversation'],
    ['admin_day', 'agent_budget_admin_day'],
    ['admin_month', 'agent_budget_admin_month'],
    ['global_day', 'agent_budget_global_day'],
  ] as const)('reports the %s cap as refused, with used and cap, and maps it to %s', async (exceeded, code) => {
    const { db, u } = setup();
    ownsConversation(db);
    db.onRpc('admin_agent_reserve_usage', { data: [{ out_usage_id: null, out_exceeded: exceeded, out_used: 4_900_000, out_cap: 5_000_000 }] });
    const result = await u.reserveUsage(admin, reservation);
    expect(result).toEqual({ ok: false, exceeded, usedMicro: 4_900_000, capMicro: 5_000_000 });
    if (result.ok) throw new Error('unreachable');
    const error = budgetExceededError(result);
    expect(error).toMatchObject({ code, statusCode: 429, detail: { used: 4_900_000, cap: 5_000_000 } });
    expect(error.message).not.toMatch(/\d{4}/);
  });

  it('fails closed on a bad estimate or cap, before any query', async () => {
    const { db, u } = setup();
    for (const estimateUsdMicro of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(u.reserveUsage(admin, { ...reservation, estimateUsdMicro })).rejects.toMatchObject({ reason: 'bad_usage_amount' });
    }
    await expect(u.reserveUsage(admin, { ...reservation, caps: { ...caps, adminMonthMicro: undefined as unknown as number } })).rejects.toMatchObject({
      reason: 'bad_usage_amount',
    });
    expect(db.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("refuses to bill another admin's conversation", async () => {
    const { db, u } = setup();
    ownsConversation(db);
    await expect(u.reserveUsage(other, reservation)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('throws a db error when the function raises or answers nothing', async () => {
    const { db, u } = setup();
    ownsConversation(db);
    db.onRpc('admin_agent_reserve_usage', { error: { code: 'P0001', message: 'ADMIN_AGENT_CAP_REQUIRED' } }, true);
    await expect(u.reserveUsage(admin, reservation)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', dbCode: 'ADMIN_AGENT_CAP_REQUIRED' });
    db.onRpc('admin_agent_reserve_usage', { data: [] }, true);
    await expect(u.reserveUsage(admin, reservation)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError' });
  });
});

describe('settleUsage / releaseUsage', () => {
  it('settles an unsettled reservation of this admin through the SQL function', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: null } });
    expect(await u.settleUsage(admin, USAGE, settlement)).toBe(true);
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
    expect(db.rpcCalls[0]).toEqual({
      name: 'admin_agent_settle_usage',
      args: {
        p_usage_id: USAGE,
        p_input_tokens: 10,
        p_cache_write_5m_tokens: 0,
        p_cache_write_1h_tokens: 100,
        p_cache_read_tokens: 5000,
        p_output_tokens: 300,
        p_cost_usd_micro: 123_456,
        p_stop_reason: 'end_turn',
      },
    });
  });

  it('returns false for a repeat (already settled, or settled between the read and the call)', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: NOW.toISOString() } }, true);
    expect(await u.settleUsage(admin, USAGE, settlement)).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);

    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: null } });
    db.onRpc('admin_agent_settle_usage', { error: { code: 'P0001', message: 'ADMIN_AGENT_USAGE_NOT_FOUND' } });
    expect(await u.settleUsage(admin, USAGE, settlement)).toBe(false);
  });

  it("throws for a usage row that is not the admin's and for bad meters", async () => {
    const { db, u } = setup();
    await expect(u.settleUsage(other, USAGE, settlement)).rejects.toMatchObject({ reason: 'usage_not_found' });
    await expect(u.settleUsage(admin, 'nope', settlement)).rejects.toMatchObject({ reason: 'usage_not_found' });
    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: null } });
    await expect(u.settleUsage(admin, USAGE, { ...settlement, outputTokens: -1 })).rejects.toMatchObject({ reason: 'bad_usage_amount' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('maps an unexpected settle failure to a db error', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: null } });
    db.onRpc('admin_agent_settle_usage', { error: { code: '57014', message: 'timeout' } });
    await expect(u.settleUsage(admin, USAGE, settlement)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', operation: 'usage.settle' });
  });

  it('releases a reservation for a call never made as a zero-cost settlement', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: { id: USAGE, settled_at: null } });
    expect(await u.releaseUsage(admin, USAGE)).toBe(true);
    expect(db.rpcCalls[0].args).toMatchObject({ p_cost_usd_micro: 0, p_input_tokens: 0, p_output_tokens: 0, p_stop_reason: 'not_called' });
  });
});

describe('spend sums', () => {
  const row = (createdAt: string, settled: boolean, reserved: number, cost: number) => ({
    created_at: createdAt,
    settled_at: settled ? createdAt : null,
    reserved_usd_micro: reserved,
    cost_usd_micro: cost,
  });

  it('counts a settled row at its cost and an unsettled one at its reservation, per window', async () => {
    const { db, u } = setup();
    ownsConversation(db);
    db.when((c) => c.table === 'admin_agent_usage' && eqOf(c, 'admin_id') === ADMIN, {
      data: [
        row('2026-10-03T10:00:00.000Z', true, 500_000, 400_000), // month only
        row('2026-10-27T01:00:00.000Z', true, 300_000, 100_000), // day
        row('2026-10-27T11:00:00.000Z', false, 250_000, 0), // day, unsettled
      ],
    });
    db.when((c) => c.table === 'admin_agent_usage' && eqOf(c, 'conversation_id') === CONVERSATION, {
      data: [row('2026-10-27T01:00:00.000Z', true, 300_000, 100_000), row('2026-10-27T11:00:00.000Z', false, 250_000, 0)],
    });
    expect(await u.getSpend(admin, CONVERSATION)).toEqual({ conversationMicro: 350_000, adminDayMicro: 350_000, adminMonthMicro: 750_000, truncated: false });
    const monthQuery = db.to('admin_agent_usage')[0];
    expect(hasStep(monthQuery, 'gte', 'created_at', '2026-10-01T00:00:00.000Z')).toBe(true);
  });

  it('has no conversation sum without a conversation and says when a read hit its bound', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: Array.from({ length: 1000 }, () => row('2026-10-27T01:00:00.000Z', true, 0, 1)) });
    const spend = await u.getSpend(admin);
    expect(spend.conversationMicro).toBeNull();
    expect(spend.truncated).toBe(true);
    expect(spend.adminDayMicro).toBe(20_000);
  });

  it('sums the global day across admins without exposing rows', async () => {
    const { db, u } = setup();
    db.on('admin_agent_usage', 'select', { data: [row('2026-10-27T01:00:00.000Z', true, 0, 600_000), row('2026-10-27T02:00:00.000Z', false, 400_000, 0)] });
    expect(await u.getGlobalDaySpend(admin)).toEqual({ micro: 1_000_000, truncated: false });
    expect(hasStep(db.calls[0], 'gte', 'created_at', '2026-10-27T00:00:00.000Z')).toBe(true);
    expect(eqOf(db.calls[0], 'admin_id')).toBeUndefined();
  });

  it("refuses the conversation sum of another admin's conversation", async () => {
    const { db, u } = setup();
    ownsConversation(db);
    await expect(u.getSpend(other, CONVERSATION)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.to('admin_agent_usage')).toHaveLength(0);
  });
});
