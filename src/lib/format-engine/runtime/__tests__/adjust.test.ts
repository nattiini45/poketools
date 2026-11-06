import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORMAT_ADJUSTMENT_REASON_MAX, FormatAdjustmentRefusedError } from '@/lib/supabase/queries/format-runtime';
import { PLAYERS, SEED, giftDef, item, link, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  applyFormatAdjustment: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { applyFormatAdjustment } from '@/lib/supabase/queries/format-runtime';
import { logger } from '@/lib/logger';
import { applyAdjustment, FORMAT_MAX_DOMAIN_AMENDMENTS, type AdjustmentRequest } from '../adjust';
import { fireEvent } from '../fire';
import { generateRelationLinks, validateRelationLinks } from '../relations';
import { loadFreshKitContext, type KitContext } from '../load';
import type { KitRuntimeState } from '../types';
import type { RelationDef } from '@/lib/format-kit/types';
import { MAX_DOMAIN_ENTRIES } from '@/lib/format-kit/limits';

const SEASON = 's-1';

function context(patch: Partial<KitRuntimeState> = {}): KitContext {
  const def = giftDef();
  return {
    seasonId: SEASON,
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def, patch),
    tunableIssues: [],
    phases: [{ id: 't-1', stage: def.stages[0], members: PLAYERS }],
  };
}

const request = (adjustment: AdjustmentRequest['adjustment'], reason = 'because'): AdjustmentRequest => ({
  seasonId: SEASON,
  adminId: 'admin-1',
  reason,
  adjustment,
});

const points = (reason?: string) => request({ kind: 'points', stage: 'main', playerId: 'p1', points: 1 }, reason);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(applyFormatAdjustment).mockResolvedValue('adj-1');
  vi.mocked(fireEvent).mockResolvedValue(null);
});

describe('applyAdjustment', () => {
  it('records a points adjustment without ops (the row is the effect)', async () => {
    await expect(applyAdjustment(request({ kind: 'points', stage: 'main', playerId: 'p1', points: 2 }, '  fair  '))).resolves.toEqual({ ok: true, id: 'adj-1' });
    expect(applyFormatAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'points', reason: 'fair', adminId: 'admin-1', ops: [], target: { stage: 'main', player_id: 'p1' }, delta: { points: 2 } }),
    );
  });

  it('refuses an empty reason and a reason over the stored limit, before anything is written', async () => {
    await expect(applyAdjustment(points('   '))).rejects.toMatchObject({ code: 'reason_required' });
    await expect(applyAdjustment(points('x'.repeat(FORMAT_ADJUSTMENT_REASON_MAX + 1)))).rejects.toMatchObject({
      code: 'reason_too_long',
      statusCode: 400,
    });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    await expect(applyAdjustment(points('x'.repeat(FORMAT_ADJUSTMENT_REASON_MAX)))).resolves.toMatchObject({ ok: true });
  });

  it('counts characters, not UTF-16 units, like the check constraint', async () => {
    const reason = '\u{1F600}'.repeat(FORMAT_ADJUSTMENT_REASON_MAX);
    expect(reason.length).toBe(FORMAT_ADJUSTMENT_REASON_MAX * 2);
    await expect(applyAdjustment(points(reason))).resolves.toMatchObject({ ok: true });
  });

  it('reports a league without a running kit format and a kind the format does not allow', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(applyAdjustment(points())).resolves.toEqual({ ok: false, issue: 'format_not_running' });
    const ctx = context();
    ctx.def = { ...ctx.def, rules: ctx.def.rules.filter((rule) => rule.kind !== 'adjust.manual') };
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(applyAdjustment(points())).resolves.toEqual({ ok: false, issue: 'adjust_not_allowed' });
  });

  it('checks the target and the amount', async () => {
    await expect(applyAdjustment(request({ kind: 'points', stage: 'main', playerId: 'nobody', points: 1 }))).resolves.toEqual({ ok: false, issue: 'unknown_target' });
    await expect(applyAdjustment(request({ kind: 'points', stage: 'main', playerId: 'p1', points: 0 }))).resolves.toEqual({ ok: false, issue: 'invalid_amount' });
    await expect(applyAdjustment(request({ kind: 'resource', resource: 'coins', playerId: 'p1', amount: 0 }))).resolves.toEqual({ ok: false, issue: 'invalid_amount' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
  });

  it('grants a positive resource amount and revokes a negative one', async () => {
    await applyAdjustment(request({ kind: 'resource', resource: 'coins', playerId: 'p1', amount: 2 }));
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].ops).toEqual([
      { op: 'grant_item', resource: 'coins', player_id: 'p1', item_id: null, amount: 2, exclusive: false, source: 'adjustment', source_ref: null },
    ]);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ items: [item({ resource: 'coins', player_id: 'p1', amount: 2 })] }));
    await applyAdjustment(request({ kind: 'resource', resource: 'coins', playerId: 'p1', amount: -1 }));
    expect(vi.mocked(applyFormatAdjustment).mock.calls[1][0].ops).toEqual([
      { op: 'revoke_item', resource: 'coins', player_id: 'p1', item_id: null, amount: 1 },
    ]);
  });
});

/** A single cycle over the six players of the fixture. */
const CYCLE = PLAYERS.map((from, i) => ({ from, to: PLAYERS[(i + 1) % PLAYERS.length] }));

describe('relation adjustments', () => {
  it('sets links while the relation has none, and keeps the pairs out of the history row', async () => {
    await applyAdjustment(request({ kind: 'relation', relation: 'santa', links: CYCLE }));
    const call = vi.mocked(applyFormatAdjustment).mock.calls[0][0];
    expect(call.ops).toEqual([{ op: 'set_relation', relation: 'santa', links: CYCLE }]);
    expect(call.delta).toEqual({ link_count: 6 });
    expect(call.target).toEqual({ relation: 'santa' });
  });

  it('refuses links on a relation that has links (the op would change nothing) but still reveals it', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ links: [link('p1', 'p2')] }));
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', links: CYCLE }))).resolves.toEqual({
      ok: false,
      issue: 'relation_has_links',
    });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', reveal: true }))).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].ops).toEqual([{ op: 'reveal_relation', relation: 'santa' }]);
  });

  it('refuses a reveal on its own when there is nothing hidden to reveal, writing no history row', async () => {
    const reveal = request({ kind: 'relation', relation: 'santa', reveal: true });
    // Before the draw: no links at all.
    await expect(applyAdjustment(reveal)).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    // After a reveal: every link is already revealed.
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ links: [link('p1', 'p2', 'santa', true)] }));
    await expect(applyAdjustment(reveal)).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    // Links of another relation do not count.
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ links: [link('p1', 'p2', 'other')] }));
    await expect(applyAdjustment(reveal)).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
  });
});

describe('domain adjustments', () => {
  const amend = { kind: 'domain' as const, domain: 'pool', add: [{ id: 'mew', attrs: [{ key: 'role', value: 'support' }] }] };

  it('guards the actions that use the domain as a step list', async () => {
    await applyAdjustment(request(amend));
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].guardActions).toEqual(['choose_gift']);
  });

  it('guards an action whose step grants a resource that holds the domain, even when the step lists another domain', async () => {
    const ctx = context();
    ctx.def = {
      ...ctx.def,
      domains: [...(ctx.def.domains ?? []), { key: 'other', label: ctx.def.domains![0].label, initially: 'unlocked', visibility: 'public', entries: [] }],
      rules: ctx.def.rules.map((rule) =>
        rule.kind === 'player.action' ? { ...rule, steps: rule.steps.map((step) => ({ ...step, domain: 'other' })) } : rule,
      ),
    };
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    const holder = (ctx.def.resources ?? []).find((r) => r.holds.kind === 'domain' && r.holds.domain === 'pool');
    expect(holder).toBeDefined();
    await applyAdjustment(request(amend));
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].guardActions).toEqual(['choose_gift']);
  });

  it('refuses to remove an entry a player holds, and allows removing one nobody holds', async () => {
    const ctx = context({ items: [item({ resource: 'picks', player_id: 'p1', item_id: 'blissey' })] });
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', remove: ['blissey'] }))).resolves.toEqual({ ok: false, issue: 'domain_in_use' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', remove: ['garchomp'] }))).resolves.toMatchObject({ ok: true });
  });

  it('refuses an amendment of a domain a started stage counts in a team constraint', async () => {
    const ctx = context({ firedEventKeys: ['stage_start:main'] });
    ctx.def = {
      ...ctx.def,
      stages: ctx.def.stages.map((stage, i) =>
        i === 0
          ? { ...stage, constraints: [{ kind: 'count' as const, source: { kind: 'not' as const, source: { kind: 'domain' as const, domain: 'pool', unlocked_only: false } }, max: 2 }] }
          : stage,
      ),
    };
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(applyAdjustment(request(amend))).resolves.toEqual({ ok: false, issue: 'domain_in_use' });
    // Before the stage starts the same amendment is fine.
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...ctx, state: { ...ctx.state, firedEventKeys: [] } });
    await expect(applyAdjustment(request(amend))).resolves.toMatchObject({ ok: true });
  });
});

describe('action adjustments', () => {
  it('fires action_locked after a manual lock, not after an open', async () => {
    await applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'open' }));
    expect(fireEvent).not.toHaveBeenCalled();
    await applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'locked' }));
    expect(fireEvent).toHaveBeenCalledWith(SEASON, { event: 'action_locked', action: 'choose_gift' }, 'admin-1');
  });

  it('refuses a lock on a locked action and an open on an open one (the history never records a change that did not happen)', async () => {
    const withFlag = (value: string) => context({ flags: { 'action:choose_gift': value } });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFlag('locked'));
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'locked' }))).resolves.toEqual({ ok: false, issue: 'action_state_unchanged' });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFlag('open'));
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'open' }))).resolves.toEqual({ ok: false, issue: 'action_state_unchanged' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('lets an action be locked while open, opened again after a lock, and opened before its window opens', async () => {
    const withFlag = (value?: string) => context(value === undefined ? {} : { flags: { 'action:choose_gift': value } });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFlag('open'));
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'locked' }))).resolves.toMatchObject({ ok: true });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFlag('locked'));
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'open' }))).resolves.toMatchObject({ ok: true });
    // No flag yet and a window that opens on an event: opening it early is a change, and so is a lock.
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFlag());
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'open' }))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'locked' }))).resolves.toMatchObject({ ok: true });
    expect(applyFormatAdjustment).toHaveBeenCalledTimes(4);
  });

  it('keeps the adjustment when the follow-up event fails, and logs it for the cron pass', async () => {
    vi.mocked(fireEvent).mockRejectedValue(new Error('db'));
    await expect(applyAdjustment(request({ kind: 'action', action: 'choose_gift', state: 'locked' }))).resolves.toEqual({ ok: true, id: 'adj-1' });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('points and rank adjustments', () => {
  const pts = (value: number) => request({ kind: 'points', stage: 'main', playerId: 'p1', points: value });

  it('holds points to the bound and the decimals of the kit own scoring values', async () => {
    await expect(applyAdjustment(pts(1000))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(pts(-1000))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(pts(1000.01))).resolves.toEqual({ ok: false, issue: 'invalid_amount' });
    await expect(applyAdjustment(pts(0.005))).resolves.toEqual({ ok: false, issue: 'invalid_amount' });
    await expect(applyAdjustment(pts(Number.NaN))).resolves.toEqual({ ok: false, issue: 'invalid_amount' });
    await expect(applyAdjustment(pts(1.25))).resolves.toMatchObject({ ok: true });
  });

  it('takes a rank order only as a permutation of the stage roster', async () => {
    const rank = (order: string[], stage = 'main') => request({ kind: 'rank', stage, order });
    const full = [...PLAYERS].reverse();
    await expect(applyAdjustment(rank(full))).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].delta).toEqual({ order: full });
    expect(applyFormatAdjustment).toHaveBeenCalledTimes(1);
    const repeated = [...full.slice(1), full[1]];
    for (const bad of [full.slice(1), [...full, 'p9'], repeated, [...full.slice(1), 'nobody']]) {
      await expect(applyAdjustment(rank(bad))).resolves.toEqual({ ok: false, issue: 'invalid_order' });
    }
    // A stage with no players has no order to set.
    await expect(applyAdjustment(rank(full, 'elsewhere'))).resolves.toEqual({ ok: false, issue: 'unknown_target' });
    expect(applyFormatAdjustment).toHaveBeenCalledTimes(1);
  });
});

describe('resource adjustments', () => {
  const grant = (itemId: string | null | undefined, amount = 1, resource = 'picks') =>
    request({ kind: 'resource', resource, playerId: 'p1', itemId, amount });

  it('grants a domain item that is an entry of the domain, exclusive when the resource is', async () => {
    await expect(applyAdjustment(grant('garchomp'))).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].ops).toEqual([
      { op: 'grant_item', resource: 'picks', player_id: 'p1', item_id: 'garchomp', amount: 1, exclusive: true, source: 'adjustment', source_ref: null },
    ]);
  });

  it('refuses an item outside the domain, a missing item for a domain resource and an item for a counter', async () => {
    await expect(applyAdjustment(grant('mew'))).resolves.toEqual({ ok: false, issue: 'item_outside_domain' });
    await expect(applyAdjustment(grant(null))).resolves.toEqual({ ok: false, issue: 'item_required' });
    await expect(applyAdjustment(grant(undefined))).resolves.toEqual({ ok: false, issue: 'item_required' });
    await expect(applyAdjustment(grant('garchomp', 1, 'coins'))).resolves.toEqual({ ok: false, issue: 'item_not_allowed' });
    await expect(applyAdjustment(grant('garchomp', -1))).resolves.toEqual({ ok: false, issue: 'insufficient_holding' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
  });

  it('reads the entries of the domain as amended', async () => {
    const mew = { id: 'mew', attrs: [{ key: 'role', value: 'support' }] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ amendments: [{ domain: 'pool', add: [mew] }] }));
    await expect(applyAdjustment(grant('mew'))).resolves.toMatchObject({ ok: true });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ amendments: [{ domain: 'pool', remove: ['garchomp'] }] }));
    await expect(applyAdjustment(grant('garchomp'))).resolves.toEqual({ ok: false, issue: 'item_outside_domain' });
  });

  it('revokes only what the player holds, counting every row of that resource and item', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({
        items: [
          item({ resource: 'coins', player_id: 'p1', amount: 2 }),
          item({ resource: 'coins', player_id: 'p1', amount: 1 }),
          item({ resource: 'coins', player_id: 'p2', amount: 9 }),
          item({ resource: 'picks', player_id: 'p1', item_id: 'blissey' }),
        ],
      }),
    );
    const take = (amount: number, resource = 'coins', itemId: string | null = null) =>
      request({ kind: 'resource', resource, playerId: 'p1', itemId, amount });
    await expect(applyAdjustment(take(-3))).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(applyFormatAdjustment).mock.calls[0][0].ops).toEqual([
      { op: 'revoke_item', resource: 'coins', player_id: 'p1', item_id: null, amount: 3 },
    ]);
    await expect(applyAdjustment(take(-4))).resolves.toEqual({ ok: false, issue: 'insufficient_holding' });
    await expect(applyAdjustment(take(-1, 'picks', 'blissey'))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(take(-1, 'picks', 'garchomp'))).resolves.toEqual({ ok: false, issue: 'insufficient_holding' });
    expect(applyFormatAdjustment).toHaveBeenCalledTimes(2);
  });
});

describe('a change the database refuses under its lock (a concurrent adjustment took it first)', () => {
  it('answers relation_has_links for a draw whose snapshot showed no links, and does not fire or throw', async () => {
    vi.mocked(applyFormatAdjustment).mockRejectedValue(new FormatAdjustmentRefusedError('relation_has_links'));
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true }))).resolves.toEqual({ ok: false, issue: 'relation_has_links' });
    expect(applyFormatAdjustment).toHaveBeenCalledTimes(1);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('answers insufficient_holding for a revoke whose snapshot showed enough units', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ items: [item({ resource: 'coins', player_id: 'p1', amount: 3 })] }));
    vi.mocked(applyFormatAdjustment).mockRejectedValue(new FormatAdjustmentRefusedError('insufficient_holding'));
    await expect(applyAdjustment(request({ kind: 'resource', resource: 'coins', playerId: 'p1', itemId: null, amount: -2 }))).resolves.toEqual({
      ok: false,
      issue: 'insufficient_holding',
    });
  });

  it('lets any other failure of the write propagate', async () => {
    const boom = new Error('db down');
    vi.mocked(applyFormatAdjustment).mockRejectedValue(boom);
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true }))).rejects.toBe(boom);
  });
});

describe('relation links and the draw', () => {
  const setLinks = (links: { from: string; to: string }[], extra: object = {}) =>
    request({ kind: 'relation', relation: 'santa', links, ...extra } as AdjustmentRequest['adjustment']);
  const withShape = (shape: RelationDef['shape'], members = PLAYERS): KitContext => {
    const ctx = context();
    ctx.def = { ...ctx.def, relations: (ctx.def.relations ?? []).map((r) => ({ ...r, shape })) };
    ctx.phases = [{ ...ctx.phases[0], members }];
    return ctx;
  };

  it('refuses links that do not fit the roster or the shape of the relation, writing nothing', async () => {
    const swaps = [['p1', 'p2'], ['p2', 'p1'], ['p3', 'p4'], ['p4', 'p3'], ['p5', 'p6'], ['p6', 'p5']].map(([from, to]) => ({ from, to }));
    for (const bad of [
      [],
      [{ from: 'p1', to: 'p2' }],
      swaps,
      [...CYCLE.slice(1), { from: 'p6', to: 'ghost' }],
      CYCLE.map((l) => ({ ...l, to: l.from === 'p1' ? 'p1' : l.to })),
    ]) {
      await expect(applyAdjustment(setLinks(bad))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    }
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    vi.mocked(loadFreshKitContext).mockResolvedValue(withShape('pairs'));
    await expect(applyAdjustment(setLinks(swaps))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(setLinks(CYCLE))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withShape('manual'));
    await expect(applyAdjustment(setLinks([{ from: 'p1', to: 'p2' }]))).resolves.toMatchObject({ ok: true });
    // An empty list is valid for the shared validator on a manual relation, but it is no adjustment.
    await expect(applyAdjustment(setLinks([]))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
  });

  it('refuses a relation request that would do nothing', async () => {
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa' }))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', reveal: false }))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'nobody', reveal: true }))).resolves.toEqual({ ok: false, issue: 'unknown_target' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
  });

  it('draws the links from the season seed and the roster, the same way every time, and stores only the count', async () => {
    const expected = generateRelationLinks({ key: 'santa', shape: 'derangement' }, PLAYERS, SEED);
    await expect(applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true }))).resolves.toEqual({ ok: true, id: 'adj-1' });
    await applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true }));
    const [first, second] = vi.mocked(applyFormatAdjustment).mock.calls.map((c) => c[0]);
    expect(first.ops).toEqual([{ op: 'set_relation', relation: 'santa', links: expected }]);
    expect(second.ops).toEqual(first.ops);
    expect(validateRelationLinks('derangement', PLAYERS, expected)).toBe(true);
    expect(first.delta).toEqual({ link_count: PLAYERS.length, draw: true });
    expect(JSON.stringify([first.target, first.delta])).not.toMatch(/p\d/);
    // Another roster, another draw.
    vi.mocked(loadFreshKitContext).mockResolvedValue(withShape('derangement', PLAYERS.slice(0, 4)));
    await applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true }));
    expect(vi.mocked(applyFormatAdjustment).mock.calls[2][0].ops).toEqual([
      { op: 'set_relation', relation: 'santa', links: generateRelationLinks({ key: 'santa', shape: 'derangement' }, PLAYERS.slice(0, 4), SEED) },
    ]);
  });

  it('can draw and reveal in one adjustment', async () => {
    await applyAdjustment(request({ kind: 'relation', relation: 'santa', draw: true, reveal: true }));
    const call = vi.mocked(applyFormatAdjustment).mock.calls[0][0];
    expect(call.ops.map((op) => op.op)).toEqual(['set_relation', 'reveal_relation']);
    expect(call.delta).toEqual({ reveal: true, link_count: PLAYERS.length, draw: true });
  });

  it('refuses a draw over existing links, below two players, together with links, and on a manual relation', async () => {
    const drawRequest = request({ kind: 'relation', relation: 'santa', draw: true });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ links: [link('p1', 'p2')] }));
    await expect(applyAdjustment(drawRequest)).resolves.toEqual({ ok: false, issue: 'relation_has_links' });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withShape('derangement', ['p1']));
    await expect(applyAdjustment(drawRequest)).resolves.toEqual({ ok: false, issue: 'unknown_target' });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context());
    await expect(applyAdjustment(setLinks(CYCLE, { draw: true }))).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    vi.mocked(loadFreshKitContext).mockResolvedValue(withShape('manual'));
    await expect(applyAdjustment(drawRequest)).resolves.toEqual({ ok: false, issue: 'invalid_links' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
  });
});

describe('domain amendment limits', () => {
  const entry = (id: string, role = 'support') => ({ id, attrs: [{ key: 'role', value: role }] });

  it('refuses an added entry that lacks the attribute an action step needs to be distinct, and takes one that has it', async () => {
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [{ id: 'mew', attrs: [] }] }))).resolves.toEqual({
      ok: false,
      issue: 'attr_missing',
    });
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [{ id: 'mew', attrs: [{ key: 'bonus', value: 1 }] }] }))).resolves.toEqual({
      ok: false,
      issue: 'attr_missing',
    });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [entry('mew')] }))).resolves.toMatchObject({ ok: true });
    // Removing needs no attribute.
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', remove: ['garchomp'] }))).resolves.toMatchObject({ ok: true });
  });

  it('does not ask for an attribute when no step over the domain wants distinct values', async () => {
    const ctx = context();
    ctx.def = {
      ...ctx.def,
      rules: ctx.def.rules.map((rule) =>
        rule.kind === 'player.action' ? { ...rule, steps: rule.steps.map(({ distinct_attr: _unused, ...step }) => step) } : rule,
      ),
    };
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [{ id: 'mew', attrs: [] }] }))).resolves.toMatchObject({ ok: true });
  });

  it('caps the entries of the amended domain, counting a replaced entry once', async () => {
    const room = MAX_DOMAIN_ENTRIES - 3;
    const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`mon${i}`));
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: many(room) }))).resolves.toMatchObject({ ok: true });
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: many(room + 1) }))).resolves.toEqual({ ok: false, issue: 'domain_too_large' });
    // Replacing an existing id and removing another leaves room.
    await expect(
      applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [...many(room), entry('garchomp')], remove: ['blissey'] })),
    ).resolves.toMatchObject({ ok: true });
    // The earlier amendments count.
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ amendments: [{ domain: 'pool', add: many(room) }] }));
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [entry('one-more')] }))).resolves.toEqual({
      ok: false,
      issue: 'domain_too_large',
    });
  });

  it('stores a bounded number of amendments', async () => {
    const stored = (n: number) => Array.from({ length: n }, () => ({ domain: 'pool', remove: ['nobody'] }));
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ amendments: stored(FORMAT_MAX_DOMAIN_AMENDMENTS - 1) }));
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [entry('mew')] }))).resolves.toMatchObject({ ok: true });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ amendments: stored(FORMAT_MAX_DOMAIN_AMENDMENTS) }));
    await expect(applyAdjustment(request({ kind: 'domain', domain: 'pool', add: [entry('mew')] }))).resolves.toEqual({
      ok: false,
      issue: 'amendment_limit',
    });
  });
});
