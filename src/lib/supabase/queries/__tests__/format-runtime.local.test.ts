import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';

// LIVE-LOCAL test for supabase/migrations/20261105090000_format_runtime.sql. It runs the query module against a LOCAL
// Supabase stack to prove the runtime functions: events fire once, ops apply in order inside one transaction, an
// exclusive item is held by one player, a locked action refuses saves and submits, adjustments need a reason and a
// domain amendment respects the locks, checks deduplicate and resolve once. Opt-in only
// (`LOCAL_SUPABASE_FORMAT_RUNTIME=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_RUNTIME');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type RuntimeMod = typeof import('@/lib/supabase/queries/format-runtime');
type FormatOp = import('@/lib/supabase/queries/format-runtime').FormatOp;
type Json = import('@/types/database').Json;
type FormatRuntime = import('@/lib/supabase/queries/format-runtime').FormatRuntime;

let client: ClientMod['supabase'];
let rt: RuntimeMod;

const RUN = randomUUID().slice(0, 8);
const ids = { season: randomUUID(), p1: randomUUID(), p2: randomUUID(), p3: randomUUID() };

let eventCounter = 0;
const nextKey = () => `evt-${++eventCounter}`;

async function fire(ops: FormatOp[], eventKey = nextKey()): Promise<boolean> {
  return rt.fireFormatEvent({ seasonId: ids.season, eventKey, event: 'time', payload: {}, ops, firedBy: null });
}

const grant = (resource: string, player_id: string, item_id: string | null, extra: Partial<Extract<FormatOp, { op: 'grant_item' }>> = {}): FormatOp => ({
  op: 'grant_item', resource, player_id, item_id, amount: 1, exclusive: false, source: 'event', source_ref: null, ...extra,
});

async function rows<K extends keyof FormatRuntime>(key: K): Promise<FormatRuntime[K]> {
  return (await rt.getFormatRuntime(ids.season))[key];
}

const held = async (resource: string, player: string) =>
  (await rows('resourceItems')).filter((r) => r.resource_key === resource && r.player_id === player);

describe.skipIf(!optIn)('format runtime (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    rt = await import('@/lib/supabase/queries/format-runtime');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };
    await run(
      'players',
      client.from('players').insert(
        [ids.p1, ids.p2, ids.p3].map((id, i) => ({ id, name: `Runtime ${RUN} ${i}`, is_guest: true })),
        { defaultToNull: false },
      ),
    );
    await run('seasons', client.from('seasons').insert({ id: ids.season, name: `Runtime ${RUN}`, format_type: 'evolution_point_buy' }));
    await run(
      'season_formats',
      client.from('season_formats').insert({ season_id: ids.season, version_no: 1, spec: {}, spec_hash: 'a'.repeat(64), seed: 'seedseed1' }),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    await del('seasons', client.from('seasons').delete().eq('id', ids.season));
    await del('players', client.from('players').delete().in('id', [ids.p1, ids.p2, ids.p3]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  it('fires an event once: the second call returns false and applies nothing again', async () => {
    const ops: FormatOp[] = [
      { op: 'set_flag', key: 'domain:gifts', value: 'unlocked' },
      { op: 'set_attr', player_id: ids.p1, attr: 'role', value: 'sweeper', source: 'event' },
      grant('coins', ids.p1, null, { amount: 3 }),
    ];
    await expect(fire(ops, 'once')).resolves.toBe(true);
    await expect(fire(ops, 'once')).resolves.toBe(false);

    expect((await held('coins', ids.p1)).map((r) => r.amount)).toEqual([3]);
    expect((await rows('playerAttrs')).filter((r) => r.attr_key === 'role')).toHaveLength(1);
    expect((await rows('flags')).find((f) => f.key === 'domain:gifts')?.value).toBe('unlocked');
    expect((await rows('eventLog')).filter((e) => e.event_key === 'once')).toHaveLength(1);
  });

  it('sets a relation only while it has no links, and reveals it once', async () => {
    const ring = [[ids.p1, ids.p2], [ids.p2, ids.p3], [ids.p3, ids.p1]].map(([from, to]) => ({ from, to }));
    await fire([{ op: 'set_relation', relation: 'santa', links: ring }]);
    await fire([{ op: 'set_relation', relation: 'santa', links: [{ from: ids.p1, to: ids.p3 }, { from: ids.p3, to: ids.p2 }, { from: ids.p2, to: ids.p1 }] }]);

    let links = (await rows('relationLinks')).filter((l) => l.relation_key === 'santa');
    expect(links.map((l) => `${l.from_player_id}>${l.to_player_id}`).sort()).toEqual(ring.map((l) => `${l.from}>${l.to}`).sort());
    expect(links.every((l) => l.revealed_at === null)).toBe(true);

    await fire([{ op: 'reveal_relation', relation: 'santa' }]);
    links = (await rows('relationLinks')).filter((l) => l.relation_key === 'santa');
    const stamps = links.map((l) => l.revealed_at);
    expect(stamps.every((s) => s !== null)).toBe(true);

    await fire([{ op: 'reveal_relation', relation: 'santa' }]);
    const again = (await rows('relationLinks')).filter((l) => l.relation_key === 'santa').map((l) => l.revealed_at);
    expect(again).toEqual(stamps);
  });

  it('refuses a link from a player to themselves', async () => {
    await expect(fire([{ op: 'set_relation', relation: 'self', links: [{ from: ids.p1, to: ids.p1 }] }])).rejects.toBeTruthy();
  });

  it('grants and revokes items, oldest rows first, by amount', async () => {
    await fire([grant('wallet', ids.p2, null, { amount: 3 })]);
    await fire([grant('wallet', ids.p2, null, { amount: 2 })]);
    await fire([{ op: 'revoke_item', resource: 'wallet', player_id: ids.p2, item_id: null, amount: 4 }]);
    expect((await held('wallet', ids.p2)).map((r) => r.amount)).toEqual([1]);
    await fire([{ op: 'revoke_item', resource: 'wallet', player_id: ids.p2, item_id: null, amount: 9 }]);
    expect(await held('wallet', ids.p2)).toEqual([]);

    await fire([grant('box', ids.p2, 'pikachu'), grant('box', ids.p2, 'eevee')]);
    await fire([{ op: 'revoke_item', resource: 'box', player_id: ids.p2, item_id: 'pikachu', amount: 1 }]);
    expect((await held('box', ids.p2)).map((r) => r.item_id)).toEqual(['eevee']);
  });

  it('holds an exclusive item once and rolls the whole event back on a clash', async () => {
    await fire([grant('rare', ids.p1, 'mew', { exclusive: true })]);
    const key = nextKey();
    const clash = fire([{ op: 'set_flag', key: 'domain:after-clash', value: 'x' }, grant('rare', ids.p2, 'mew', { exclusive: true })], key);
    await expect(clash).rejects.toMatchObject({ code: 'resource_item_taken' });
    await expect(clash).rejects.toBeInstanceOf(rt.FormatRuntimeError);

    expect((await rows('flags')).some((f) => f.key === 'domain:after-clash')).toBe(false);
    expect((await rows('eventLog')).some((e) => e.event_key === key)).toBe(false);
    expect((await held('rare', ids.p2))).toEqual([]);
    // The same item in another resource, or not exclusive, is free.
    await expect(fire([grant('other', ids.p2, 'mew', { exclusive: true })])).resolves.toBe(true);
  });

  it('raises invalid_op for an unknown op or a missing member, and writes nothing', async () => {
    const key = nextKey();
    await expect(fire([{ op: 'set_flag', key: 'domain:bad-op', value: 1 }, { op: 'teleport' } as unknown as FormatOp], key)).rejects.toMatchObject({
      code: 'P0001', message: 'invalid_op',
    });
    await expect(fire([{ op: 'set_flag', key: 'k' } as unknown as FormatOp])).rejects.toMatchObject({ message: 'invalid_op' });
    expect((await rows('flags')).some((f) => f.key === 'domain:bad-op')).toBe(false);
    expect((await rows('eventLog')).some((e) => e.event_key === key)).toBe(false);
  });

  it('raises a track step and never lowers it', async () => {
    const step = async () => (await rows('trackProgress')).find((t) => t.player_id === ids.p1 && t.track_key === 'ladder')?.step;
    await fire([{ op: 'set_track', track: 'ladder', player_id: ids.p1, step: 3 }]);
    await fire([{ op: 'set_track', track: 'ladder', player_id: ids.p1, step: 2 }]);
    expect(await step()).toBe(3);
    await fire([{ op: 'set_track', track: 'ladder', player_id: ids.p1, step: 5 }]);
    expect(await step()).toBe(5);
  });

  describe('player actions', () => {
    const base = { seasonId: '', actionKey: 'pick', actorId: '', targetId: null as string | null, picks: [] as Json };
    const input = (over: Partial<typeof base> = {}) => ({ ...base, seasonId: ids.season, actorId: ids.p1, ...over });
    const submissionOf = async (action: string, actor: string) =>
      (await rows('actionSubmissions')).find((s) => s.action_key === action && s.actor_player_id === actor);

    it('saves a draft, submits it with its items, and replaces the items on a resubmit', async () => {
      const saved = await rt.saveFormatAction(input({ targetId: ids.p2, picks: [{ item_id: 'a' }] }));
      expect(saved).toMatchObject({ status: 'draft', actor_player_id: ids.p1, target_player_id: ids.p2, submitted_at: null });

      const submitted = await rt.submitFormatAction({
        ...input({ targetId: ids.p2 }), items: [{ resource: 'gift', item_id: 'a', exclusive: true }], lock: false,
      });
      expect(submitted).toMatchObject({ id: saved.id, status: 'submitted', locked_at: null });
      expect(submitted.submitted_at).not.toBeNull();
      expect((await held('gift', ids.p2)).map((r) => [r.item_id, r.source, r.source_ref, r.exclusive])).toEqual([['a', 'action', saved.id, true]]);

      await rt.submitFormatAction({ ...input({ targetId: ids.p2 }), items: [{ resource: 'gift', item_id: 'b', exclusive: true }], lock: false });
      expect((await held('gift', ids.p2)).map((r) => r.item_id)).toEqual(['b']);
      expect(await held('gift', ids.p1)).toEqual([]);
    });

    it('rolls the whole submit back on an exclusive clash, even the first-time draft row', async () => {
      await expect(
        rt.submitFormatAction({ ...input({ actorId: ids.p3, targetId: ids.p3 }), items: [{ resource: 'gift', item_id: 'b', exclusive: true }], lock: false }),
      ).rejects.toMatchObject({ code: 'resource_item_taken' });
      expect(await submissionOf('pick', ids.p3)).toBeUndefined();
      expect(await held('gift', ids.p3)).toEqual([]);
      expect((await held('gift', ids.p2)).map((r) => r.item_id)).toEqual(['b']);
    });

    it('locks submitted picks when the action locks, and then refuses saves and submits', async () => {
      await rt.saveFormatAction(input({ actorId: ids.p3, targetId: ids.p1 }));
      await fire([{ op: 'lock_action', action: 'pick' }]);

      expect(await submissionOf('pick', ids.p1)).toMatchObject({ status: 'locked' });
      expect((await submissionOf('pick', ids.p1))?.locked_at).not.toBeNull();
      expect(await submissionOf('pick', ids.p3)).toMatchObject({ status: 'draft', locked_at: null });
      expect((await rows('flags')).find((f) => f.key === 'action:pick')?.value).toBe('locked');

      await expect(rt.saveFormatAction(input())).rejects.toMatchObject({ code: 'action_locked' });
      await expect(rt.saveFormatAction(input({ actorId: ids.p3 }))).rejects.toBeInstanceOf(rt.FormatRuntimeError);
      await expect(rt.submitFormatAction({ ...input({ actorId: ids.p3 }), items: [], lock: false })).rejects.toMatchObject({ code: 'action_locked' });
    });

    it('locks at once with p_lock, which a later save then refuses without any flag', async () => {
      const locked = await rt.submitFormatAction({ ...input({ actionKey: 'quick' }), items: [], lock: true });
      expect(locked).toMatchObject({ status: 'locked' });
      expect(locked.locked_at).not.toBeNull();
      expect((await rows('flags')).some((f) => f.key === 'action:quick')).toBe(false);
      await expect(rt.saveFormatAction(input({ actionKey: 'quick' }))).rejects.toMatchObject({ code: 'action_locked' });
      // Another actor of the same action is not affected.
      await expect(rt.saveFormatAction(input({ actionKey: 'quick', actorId: ids.p2 }))).resolves.toMatchObject({ status: 'draft' });
    });

    it('opens an action by flag', async () => {
      await fire([{ op: 'open_action', action: 'pick' }]);
      expect((await rows('flags')).find((f) => f.key === 'action:pick')?.value).toBe('open');
      await expect(rt.saveFormatAction(input({ actorId: ids.p3 }))).resolves.toMatchObject({ status: 'draft' });
      // The p1 row stays locked: only the flag was reopened.
      await expect(rt.saveFormatAction(input())).rejects.toMatchObject({ code: 'action_locked' });
    });
  });

  describe('adjustments', () => {
    const adjust = (over: Partial<Parameters<RuntimeMod['applyFormatAdjustment']>[0]> = {}) =>
      rt.applyFormatAdjustment({
        seasonId: ids.season, kind: 'points', target: { stage: 'main', player_id: ids.p1 }, delta: { points: 2 },
        reason: 'late report', adminId: null, ops: [], guardActions: [], ...over,
      });
    const amendments = async () => {
      const { data, error } = await client.from('season_formats').select('amendments').eq('season_id', ids.season).single();
      if (error) throw new Error(JSON.stringify(error));
      return data.amendments;
    };

    it('records a points adjustment, and an adjust_points op writes its own row without an admin', async () => {
      const id = await adjust();
      expect((await rows('adjustments')).find((a) => a.id === id)).toMatchObject({
        kind: 'points', target: { stage: 'main', player_id: ids.p1 }, delta: { points: 2 }, reason: 'late report', admin_id: null,
      });

      await fire([{ op: 'adjust_points', stage: 'main', player_id: ids.p2, points: -1, reason: 'penalty' }]);
      const op = (await rows('adjustments')).find((a) => a.reason === 'penalty');
      expect(op).toMatchObject({ kind: 'points', target: { stage: 'main', player_id: ids.p2 }, delta: { points: -1 }, admin_id: null });
    });

    it('requires a reason and writes nothing without one', async () => {
      const before = (await rows('adjustments')).length;
      await expect(adjust({ reason: '   ' })).rejects.toMatchObject({ code: 'reason_required' });
      expect((await rows('adjustments')).length).toBe(before);
    });

    it('applies the ops of an adjustment in the same transaction', async () => {
      const before = (await rows('adjustments')).length;
      await expect(
        adjust({ kind: 'resource', ops: [grant('rare', ids.p3, 'mew', { exclusive: true, source: 'adjustment' })] }),
      ).rejects.toMatchObject({ code: 'resource_item_taken' });
      expect((await rows('adjustments')).length).toBe(before);

      await adjust({ kind: 'resource', ops: [grant('rare', ids.p3, 'jirachi', { exclusive: true, source: 'adjustment' })] });
      expect((await held('rare', ids.p3)).map((r) => [r.item_id, r.source])).toEqual([['jirachi', 'adjustment']]);
    });

    it('appends a domain amendment unless a guarded action is locked (flag or submission)', async () => {
      await adjust({ kind: 'domain', target: { domain: 'gifts' }, delta: { add: ['ditto'] }, guardActions: ['unrelated'] });
      expect(await amendments()).toEqual([{ add: ['ditto'] }]);

      const before = (await rows('adjustments')).length;
      await expect(adjust({ kind: 'domain', delta: { add: ['x'] }, guardActions: ['unrelated', 'pick'] })).rejects.toMatchObject({
        code: 'domain_amendment_locked',
      });
      await expect(adjust({ kind: 'domain', delta: { add: ['x'] }, guardActions: ['quick'] })).rejects.toMatchObject({
        code: 'domain_amendment_locked',
      });
      expect(await amendments()).toEqual([{ add: ['ditto'] }]);
      expect((await rows('adjustments')).length).toBe(before);

      // A flag alone (no submission yet) also refuses.
      await fire([{ op: 'lock_action', action: 'flagonly' }]);
      await expect(adjust({ kind: 'domain', delta: { add: ['x'] }, guardActions: ['flagonly'] })).rejects.toMatchObject({ code: 'domain_amendment_locked' });
    });
  });

  describe('checks', () => {
    it('opens a check once per dedupe key and resolves it only from open', async () => {
      const open = { seasonId: ids.season, source: 'standings_tie' as const, ruleId: 'tie', dedupeKey: 'tie:main:1', subject: { players: [ids.p1, ids.p2] } };
      const id = await rt.openFormatCheck(open);
      expect(id).toEqual(expect.any(String));
      await expect(rt.openFormatCheck(open)).resolves.toBeNull();
      expect((await rows('checks')).filter((c) => c.dedupe_key === 'tie:main:1')).toHaveLength(1);

      await expect(rt.resolveFormatCheck({ checkId: id as string, status: 'confirmed', adminId: null, note: 'looks right' })).resolves.toBe(true);
      await expect(rt.resolveFormatCheck({ checkId: id as string, status: 'rejected', adminId: null, note: null })).resolves.toBe(false);
      expect((await rows('checks')).find((c) => c.id === id)).toMatchObject({ status: 'confirmed', note: 'looks right' });

      await expect(rt.resolveFormatCheck({ checkId: randomUUID(), status: 'confirmed', adminId: null, note: null })).resolves.toBe(false);
      // A new check under the same key is still deduplicated after the first one resolved.
      await expect(rt.openFormatCheck(open)).resolves.toBeNull();
    });

    it('refuses an unknown source and an unknown status', async () => {
      await expect(rt.openFormatCheck({ seasonId: ids.season, source: 'vibes' as never, ruleId: 'r', dedupeKey: 'k', subject: {} })).rejects.toBeTruthy();
      const id = await rt.openFormatCheck({ seasonId: ids.season, source: 'expr', ruleId: 'r', dedupeKey: 'expr:1', subject: {} });
      await expect(rt.resolveFormatCheck({ checkId: id as string, status: 'open' as never, adminId: null, note: null })).rejects.toMatchObject({ message: 'invalid_op' });
    });
  });

  it('reads the whole runtime back and removes it with the league', async () => {
    const runtime = await rt.getFormatRuntime(ids.season);
    expect(runtime.relationLinks).toHaveLength(3);
    expect(runtime.eventLog.length).toBeGreaterThan(5);
    expect(runtime.flags.length).toBeGreaterThan(1);
    expect(runtime.adjustments.length).toBeGreaterThan(1);
    expect(runtime.checks.length).toBeGreaterThan(1);

    const { error } = await client.from('seasons').delete().eq('id', ids.season);
    expect(error).toBeNull();
    const after = await rt.getFormatRuntime(ids.season);
    expect(Object.values(after).every((list) => list.length === 0)).toBe(true);
  });
});
