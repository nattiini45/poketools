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

/** The revision of the attached format, as the application reads it with the spec it validates against. */
async function revisionOf(): Promise<number> {
  const { data, error } = await client.from('season_formats').select('revision').eq('season_id', ids.season).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.revision;
}

type SaveInput = Omit<Parameters<RuntimeMod['saveFormatAction']>[0], 'revision'> & { revision?: number };
type SubmitInput = Omit<Parameters<RuntimeMod['submitFormatAction']>[0], 'revision'> & { revision?: number };
// Without an explicit revision the call carries the current one, like a request that loaded the format just before.
const save = async (input: SaveInput) => rt.saveFormatAction({ ...input, revision: input.revision ?? (await revisionOf()) });
const submit = async (input: SubmitInput) => rt.submitFormatAction({ ...input, revision: input.revision ?? (await revisionOf()) });

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
      const saved = await save(input({ targetId: ids.p2, picks: [{ item_id: 'a' }] }));
      expect(saved).toMatchObject({ status: 'draft', actor_player_id: ids.p1, target_player_id: ids.p2, submitted_at: null });

      const submitted = await submit({
        ...input({ targetId: ids.p2 }), items: [{ resource: 'gift', item_id: 'a', exclusive: true }], lock: false,
      });
      expect(submitted).toMatchObject({ id: saved.id, status: 'submitted', locked_at: null });
      expect(submitted.submitted_at).not.toBeNull();
      expect((await held('gift', ids.p2)).map((r) => [r.item_id, r.source, r.source_ref, r.exclusive])).toEqual([['a', 'action', saved.id, true]]);

      await submit({ ...input({ targetId: ids.p2 }), items: [{ resource: 'gift', item_id: 'b', exclusive: true }], lock: false });
      expect((await held('gift', ids.p2)).map((r) => r.item_id)).toEqual(['b']);
      expect(await held('gift', ids.p1)).toEqual([]);
    });

    it('rolls the whole submit back on an exclusive clash, even the first-time draft row', async () => {
      await expect(
        submit({ ...input({ actorId: ids.p3, targetId: ids.p3 }), items: [{ resource: 'gift', item_id: 'b', exclusive: true }], lock: false }),
      ).rejects.toMatchObject({ code: 'resource_item_taken' });
      expect(await submissionOf('pick', ids.p3)).toBeUndefined();
      expect(await held('gift', ids.p3)).toEqual([]);
      expect((await held('gift', ids.p2)).map((r) => r.item_id)).toEqual(['b']);
    });

    it('locks submitted picks when the action locks, and then refuses saves and submits', async () => {
      await save(input({ actorId: ids.p3, targetId: ids.p1 }));
      await fire([{ op: 'lock_action', action: 'pick' }]);

      expect(await submissionOf('pick', ids.p1)).toMatchObject({ status: 'locked' });
      expect((await submissionOf('pick', ids.p1))?.locked_at).not.toBeNull();
      expect(await submissionOf('pick', ids.p3)).toMatchObject({ status: 'draft', locked_at: null });
      expect((await rows('flags')).find((f) => f.key === 'action:pick')?.value).toBe('locked');

      await expect(save(input())).rejects.toMatchObject({ code: 'action_locked' });
      await expect(save(input({ actorId: ids.p3 }))).rejects.toBeInstanceOf(rt.FormatRuntimeError);
      await expect(submit({ ...input({ actorId: ids.p3 }), items: [], lock: false })).rejects.toMatchObject({ code: 'action_locked' });
    });

    it('locks at once with p_lock, which a later save then refuses without any flag', async () => {
      const locked = await submit({ ...input({ actionKey: 'quick' }), items: [], lock: true });
      expect(locked).toMatchObject({ status: 'locked' });
      expect(locked.locked_at).not.toBeNull();
      expect((await rows('flags')).some((f) => f.key === 'action:quick')).toBe(false);
      await expect(save(input({ actionKey: 'quick' }))).rejects.toMatchObject({ code: 'action_locked' });
      // Another actor of the same action is not affected.
      await expect(save(input({ actionKey: 'quick', actorId: ids.p2 }))).resolves.toMatchObject({ status: 'draft' });
    });

    it('with onlyIfUnsubmitted leaves a submitted pick alone (already submitted) and refuses a locked one (action_locked)', async () => {
      const action = 'drawn';
      // A draft (and a first-time row) is written over by the draw's picks, as the cron's deadline draw needs.
      await save(input({ actionKey: action, actorId: ids.p2, picks: [{ item_id: 'draft' }] }));
      await expect(
        submit({ ...input({ actionKey: action, actorId: ids.p2, picks: [{ item_id: 'own' }] }), items: [], lock: false, onlyIfUnsubmitted: true }),
      ).resolves.toMatchObject({ status: 'submitted', picks: [{ item_id: 'own' }] });
      // The pick is submitted now: the second draw is refused and nothing changes.
      await expect(
        submit({ ...input({ actionKey: action, actorId: ids.p2, picks: [{ item_id: 'drawn' }] }), items: [], lock: false, onlyIfUnsubmitted: true }),
      ).rejects.toBeInstanceOf(rt.FormatActionAlreadySubmittedError);
      expect(await submissionOf(action, ids.p2)).toMatchObject({ status: 'submitted', picks: [{ item_id: 'own' }] });

      // A locked pick (lock: true, the 'on_submit' kind) raises action_locked, not action_already_submitted: the lock
      // check comes first, so a caller that leaves a submitted player alone has to leave a locked one alone too.
      await submit({ ...input({ actionKey: action, actorId: ids.p3, picks: [{ item_id: 'own' }] }), items: [], lock: true });
      await expect(
        submit({ ...input({ actionKey: action, actorId: ids.p3, picks: [{ item_id: 'drawn' }] }), items: [], lock: false, onlyIfUnsubmitted: true }),
      ).rejects.toMatchObject({ code: 'action_locked' });
      expect(await submissionOf(action, ids.p3)).toMatchObject({ status: 'locked', picks: [{ item_id: 'own' }] });
    });

    it('turns a submitted pick back into a draft on a save, releasing its items and its submitted_at', async () => {
      const action = 'revise';
      const draft = await save(input({ actionKey: action, actorId: ids.p2, picks: [{ item_id: 'x' }] }));
      const submitted = await submit({
        ...input({ actionKey: action, actorId: ids.p2 }), items: [{ resource: 'gift2', item_id: 'x', exclusive: true }], lock: false,
      });
      expect(submitted).toMatchObject({ id: draft.id, status: 'submitted' });
      expect((await held('gift2', ids.p2)).map((r) => r.item_id)).toEqual(['x']);

      const revised = await save(input({ actionKey: action, actorId: ids.p2, picks: [{ item_id: 'y' }] }));
      expect(revised).toMatchObject({ id: draft.id, status: 'draft', submitted_at: null, locked_at: null });
      expect(await held('gift2', ids.p2)).toEqual([]);

      // The exclusive item is free again, the lock leaves the draft alone, and a resubmit takes the item once more.
      await fire([grant('gift2', ids.p3, 'x', { exclusive: true })]);
      await fire([{ op: 'lock_action', action }]);
      expect(await submissionOf(action, ids.p2)).toMatchObject({ status: 'draft' });
    });

    it('never leaves a submitted pick behind a locked action, however save/submit and the lock interleave', async () => {
      const keys = Array.from({ length: 12 }, (_, i) => `race${i}`);
      await Promise.all(
        keys.flatMap((action) => [
          submit({ ...input({ actionKey: action, actorId: ids.p1 }), items: [], lock: false }).catch((error) => {
            if (error?.code !== 'action_locked') throw error;
          }),
          fire([{ op: 'lock_action', action }]),
        ]),
      );
      const flags = new Map((await rows('flags')).map((f) => [f.key, f.value]));
      const subs = (await rows('actionSubmissions')).filter((sub) => keys.includes(sub.action_key));
      for (const sub of subs) {
        expect(flags.get(`action:${sub.action_key}`)).toBe('locked');
        // A submission that landed in the window between the flag check and the lock would stay 'submitted' here.
        expect(sub.status).not.toBe('submitted');
      }
    });

    it('opens an action by flag', async () => {
      await fire([{ op: 'open_action', action: 'pick' }]);
      expect((await rows('flags')).find((f) => f.key === 'action:pick')?.value).toBe('open');
      await expect(save(input({ actorId: ids.p3 }))).resolves.toMatchObject({ status: 'draft' });
      // The p1 row stays locked: only the flag was reopened.
      await expect(save(input())).rejects.toMatchObject({ code: 'action_locked' });
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

    it('refuses a second set_relation and a revoke over a short holding without writing a history row', async () => {
      const ring = [[ids.p1, ids.p2], [ids.p2, ids.p3], [ids.p3, ids.p1]].map(([from, to]) => ({ from, to }));
      const other = [[ids.p1, ids.p3], [ids.p3, ids.p2], [ids.p2, ids.p1]].map(([from, to]) => ({ from, to }));
      const setRelation = (links: typeof ring) =>
        adjust({ kind: 'relation', target: { relation: 'adj_ring' }, delta: { link_count: links.length }, ops: [{ op: 'set_relation', relation: 'adj_ring', links }] });

      const before = (await rows('adjustments')).length;
      await setRelation(ring);
      expect((await rows('adjustments')).length).toBe(before + 1);
      await expect(setRelation(other)).rejects.toMatchObject({ name: 'FormatAdjustmentRefusedError', refusal: 'relation_has_links' });
      expect((await rows('adjustments')).length).toBe(before + 1);
      const links = (await rows('relationLinks')).filter((l) => l.relation_key === 'adj_ring');
      expect(links.map((l) => `${l.from_player_id}>${l.to_player_id}`).sort()).toEqual(ring.map((l) => `${l.from}>${l.to}`).sort());

      // Two requests that both passed their snapshot check: exactly one lands, the other is refused (not a silent no-op).
      const fresh = [[ids.p1, ids.p2], [ids.p2, ids.p1]].map(([from, to]) => ({ from, to }));
      const setFresh = (relation: string) =>
        adjust({ kind: 'relation', target: { relation }, delta: { link_count: 2 }, ops: [{ op: 'set_relation', relation, links: fresh }] });
      const settled = await Promise.allSettled([setFresh('adj_race'), setFresh('adj_race')]);
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await rows('relationLinks')).filter((l) => l.relation_key === 'adj_race')).toHaveLength(2);
      expect((await rows('adjustments')).filter((a) => (a.target as { relation?: string }).relation === 'adj_race')).toHaveLength(1);

      // An event that draws the relation racing an adjustment that draws it: the event path takes the same lock, so
      // neither dies on the primary key. The event is logged and returns, the adjustment lands or is refused cleanly.
      for (let round = 0; round < 3; round++) {
        const relation = `adj_event_race_${round}`;
        const key = `event-race-${round}`;
        const [eventRes, adjRes] = await Promise.allSettled([
          fire([{ op: 'set_relation', relation, links: fresh }], key),
          adjust({ kind: 'relation', target: { relation }, delta: { link_count: 2 }, ops: [{ op: 'set_relation', relation, links: fresh }] }),
        ]);
        expect(eventRes.status).toBe('fulfilled');
        if (adjRes.status === 'rejected') {
          expect(adjRes.reason).toMatchObject({ name: 'FormatAdjustmentRefusedError', refusal: 'relation_has_links' });
        }
        expect((await rows('eventLog')).filter((e) => e.event_key === key)).toHaveLength(1);
        expect((await rows('relationLinks')).filter((l) => l.relation_key === relation)).toHaveLength(2);
      }

      // A revoke needs the units: one is held, two are asked for.
      await fire([grant('adj_coins', ids.p1, null, { amount: 1 })]);
      const revoke = (amount: number) =>
        adjust({ kind: 'resource', target: { resource: 'adj_coins', player_id: ids.p1, item_id: null }, delta: { amount: -amount },
          ops: [{ op: 'revoke_item', resource: 'adj_coins', player_id: ids.p1, item_id: null, amount }] });
      const adjustments = (await rows('adjustments')).length;
      await expect(revoke(2)).rejects.toMatchObject({ name: 'FormatAdjustmentRefusedError', refusal: 'insufficient_holding' });
      expect((await rows('adjustments')).length).toBe(adjustments);
      expect((await held('adj_coins', ids.p1)).reduce((sum, r) => sum + r.amount, 0)).toBe(1);
      await revoke(1);
      expect(await held('adj_coins', ids.p1)).toHaveLength(0);
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

  describe('resource capacity', () => {
    const RACES = 6;
    const submissionOf = async (action: string, actor: string) =>
      (await rows('actionSubmissions')).find((s) => s.action_key === action && s.actor_player_id === actor);
    const units = async (resource: string, player: string) => (await held(resource, player)).reduce((sum, r) => sum + r.amount, 0);
    const adjustGrant = (resource: string, player: string, item: string) =>
      rt.applyFormatAdjustment({
        seasonId: ids.season, kind: 'resource', target: { resource, player_id: player, item_id: item }, delta: { amount: 1 },
        reason: 'capacity test', adminId: null, ops: [grant(resource, player, item, { source: 'adjustment' })], guardActions: [],
      });
    const item = (resource: string, item_id: string) => ({ resource, item_id, exclusive: false });
    const base = () => ({ seasonId: ids.season, actionKey: 'cap', actorId: ids.p1, targetId: null as string | null, picks: [] as Json });

    beforeAll(async () => {
      // The capacity of a resource lives in the attached spec, which the database reads itself.
      const resources = [
        { key: 'cap_pack', capacity: 2 },
        ...Array.from({ length: RACES }, (_, i) => ({ key: `cap_one_${i}`, capacity: 1 })),
      ];
      const { error } = await client.from('season_formats').update({ spec: { resources } }).eq('season_id', ids.season);
      if (error) throw new Error(JSON.stringify(error));
    });

    it('refuses a grant over the capacity on every path, and writes nothing of the refused call', async () => {
      await fire([grant('cap_pack', ids.p1, 'a')]);
      expect(await units('cap_pack', ids.p1)).toBe(1);

      // An event: the whole event rolls back, its flag and its log row included.
      const key = nextKey();
      await expect(
        fire([{ op: 'set_flag', key: 'domain:after-capacity', value: 'x' }, grant('cap_pack', ids.p1, 'b', { amount: 2 })], key),
      ).rejects.toMatchObject({ name: 'FormatRuntimeError', code: 'resource_capacity_reached', statusCode: 409 });
      expect((await rows('flags')).some((f) => f.key === 'domain:after-capacity')).toBe(false);
      expect((await rows('eventLog')).some((e) => e.event_key === key)).toBe(false);

      // A submission: two items on top of the one held, so the whole submission is refused, the first item included.
      const over = { ...base(), actionKey: 'cap_act', actorId: ids.p1, items: [item('cap_pack', 'c'), item('cap_pack', 'd')], lock: false };
      await expect(submit(over)).rejects.toMatchObject({ code: 'resource_capacity_reached' });
      expect(await submissionOf('cap_act', ids.p1)).toBeUndefined();
      expect(await units('cap_pack', ids.p1)).toBe(1);

      // An adjustment: the audit row goes with the refused grant (the first grant fills the pack, the second is refused).
      const adjustments = (await rows('adjustments')).length;
      await adjustGrant('cap_pack', ids.p1, 'z');
      await expect(adjustGrant('cap_pack', ids.p1, 'y')).rejects.toMatchObject({ code: 'resource_capacity_reached' });
      expect((await rows('adjustments')).length).toBe(adjustments + 1);
      expect(await units('cap_pack', ids.p1)).toBe(2);
    });

    it('does not count the items of the submission it replaces, and does not cap a resource without a capacity', async () => {
      const action = 'cap_replace';
      await submit({ ...base(), actionKey: action, actorId: ids.p2, items: [item('cap_pack', 'a'), item('cap_pack', 'b')], lock: false });
      expect(await units('cap_pack', ids.p2)).toBe(2);
      // The same actor submits again: the two items it granted are not "held" against the new ones.
      await submit({ ...base(), actionKey: action, actorId: ids.p2, items: [item('cap_pack', 'c'), item('cap_pack', 'd')], lock: false });
      expect((await held('cap_pack', ids.p2)).map((r) => r.item_id).sort()).toEqual(['c', 'd']);
      await submit({
        ...base(), actionKey: 'cap_free', actorId: ids.p2, items: [item('uncapped', 'a'), item('uncapped', 'b'), item('uncapped', 'c')], lock: false,
      });
      expect(await units('uncapped', ids.p2)).toBe(3);
    });

    it('lets exactly one of several concurrent grants of different paths take the last free unit', async () => {
      for (let i = 0; i < RACES; i++) {
        const resource = `cap_one_${i}`;
        const outcomes = await Promise.allSettled([
          submit({ ...base(), actionKey: `cap_a${i}`, actorId: ids.p1, targetId: ids.p2, items: [item(resource, 'a')], lock: false }),
          submit({ ...base(), actionKey: `cap_b${i}`, actorId: ids.p3, targetId: ids.p2, items: [item(resource, 'b')], lock: false }),
          fire([grant(resource, ids.p2, 'c')]),
          adjustGrant(resource, ids.p2, 'd'),
        ]);
        expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'resource_capacity_reached' });
        }
        expect(await units(resource, ids.p2)).toBe(1);
      }
    });

    it('orders two submissions that grant the same resources in a different step order, without a deadlock', async () => {
      const [r1, r2] = ['cap_one_0', 'cap_one_1'];
      for (let i = 0; i < 4; i++) {
        const outcomes = await Promise.allSettled([
          submit({ ...base(), actionKey: `cap_order${i}_0`, actorId: ids.p1, targetId: ids.p3, items: [item(r1, `x${i}`), item(r2, `x${i}`)], lock: false }),
          submit({ ...base(), actionKey: `cap_order${i}_1`, actorId: ids.p2, targetId: ids.p3, items: [item(r2, `y${i}`), item(r1, `y${i}`)], lock: false }),
        ]);
        // The capacity leaves room for one of them at most; a deadlock (40P01) would be another code.
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'resource_capacity_reached' });
        }
      }
    });
  });

  describe('format context revision', () => {
    const pick = (actionKey: string, actorId = ids.p1) => ({ seasonId: ids.season, actionKey, actorId, targetId: null as string | null, picks: [] as Json });
    const submissionOf = async (action: string, actor: string) =>
      (await rows('actionSubmissions')).find((s) => s.action_key === action && s.actor_player_id === actor);
    const update = async (patch: Record<string, unknown>) => {
      const { error } = await client.from('season_formats').update(patch).eq('season_id', ids.season);
      if (error) throw new Error(JSON.stringify(error));
    };

    it('refuses a save and a submit validated before a domain amendment, and writes nothing', async () => {
      const stale = await revisionOf();
      await rt.applyFormatAdjustment({
        seasonId: ids.season, kind: 'domain', target: { domain: 'gifts' }, delta: { add: ['revision-test'] }, reason: 'late entry',
        adminId: null, ops: [], guardActions: [],
      });
      const current = await revisionOf();
      expect(current).toBeGreaterThan(stale);

      await expect(submit({ ...pick('rev_a'), items: [], lock: false, revision: stale })).rejects.toMatchObject({
        name: 'FormatRuntimeError', code: 'format_context_stale', statusCode: 409,
      });
      await expect(save({ ...pick('rev_a'), revision: stale })).rejects.toMatchObject({ code: 'format_context_stale' });
      expect(await submissionOf('rev_a', ids.p1)).toBeUndefined();

      await expect(save({ ...pick('rev_a'), revision: current })).resolves.toMatchObject({ status: 'draft' });
      await expect(submit({ ...pick('rev_a'), items: [], lock: false, revision: current })).resolves.toMatchObject({ status: 'submitted' });
    });

    it('moves the revision on an engine switch, a replaced spec, a detach and a re-attach, and never reuses a number', async () => {
      const kept = await client.from('season_formats').select('*').eq('season_id', ids.season).single();
      expect(kept.error).toBeNull();
      const seen: number[] = [await revisionOf()];
      const step = async (change: () => Promise<void>) => {
        await change();
        seen.push(await revisionOf());
      };
      await step(() => update({ engine: 'shadow' }));
      await step(() => update({ engine: 'kit' }));
      await step(() => update({ spec: kept.data?.spec }));
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual([...seen].sort((a, b) => a - b));

      // The format is detached: nothing validated before can be written, whatever its number was.
      const last = seen[seen.length - 1];
      expect((await client.from('season_formats').delete().eq('season_id', ids.season)).error).toBeNull();
      await expect(submit({ ...pick('rev_b'), items: [], lock: false, revision: last })).rejects.toMatchObject({ code: 'format_context_stale' });
      await expect(save({ ...pick('rev_b'), revision: last })).rejects.toMatchObject({ code: 'format_context_stale' });

      // The same row attached again (a restore does this) is a new version: the old number does not come back.
      const { error } = await client.from('season_formats').insert(kept.data as never);
      expect(error).toBeNull();
      const again = await revisionOf();
      expect(again).toBeGreaterThan(last);
      await expect(submit({ ...pick('rev_b'), items: [], lock: false, revision: last })).rejects.toMatchObject({ code: 'format_context_stale' });
      await expect(submit({ ...pick('rev_b'), items: [], lock: false, revision: again })).resolves.toMatchObject({ status: 'submitted' });
    });

    it('requires a revision', async () => {
      const call = await client.rpc('format_action_save', {
        p_season_id: ids.season, p_action_key: 'rev_c', p_actor: ids.p1, p_target: null as unknown as string, p_picks: [],
        p_expected_revision: null as unknown as number,
      });
      expect(call.error).toMatchObject({ code: 'P0001', message: 'invalid_op' });
    });

    it('never stores a pick against a format that changed, however the write and the change interleave', async () => {
      for (let i = 0; i < 8; i++) {
        const action = `rev_race_${i}`;
        const revision = await revisionOf();
        const [write, change] = await Promise.allSettled([
          submit({ ...pick(action), items: [], lock: false, revision }),
          update({ tunables: { n: i } }),
        ]);
        expect(change.status).toBe('fulfilled');
        // The pick landed before the change, or it was refused as stale: nothing else (no deadlock, no half write).
        if (write.status === 'rejected') expect(write.reason).toMatchObject({ code: 'format_context_stale' });
        expect(Boolean(await submissionOf(action, ids.p1))).toBe(write.status === 'fulfilled');
      }
    });
  });

  describe('checks', () => {
    it('opens a check once per dedupe key and resolves it only from open', async () => {
      const open = { seasonId: ids.season, source: 'standings_tie' as const, ruleId: 'tie', dedupeKey: 'tie:main:1', subject: { players: [ids.p1, ids.p2] } };
      const id = await rt.openFormatCheck(open);
      expect(id).toEqual(expect.any(String));
      await expect(rt.openFormatCheck(open)).resolves.toBeNull();
      expect((await rows('checks')).filter((c) => c.dedupe_key === 'tie:main:1')).toHaveLength(1);

      await expect(rt.resolveFormatCheck({ seasonId: ids.season, checkId: id as string, status: 'confirmed', adminId: null, note: 'looks right' })).resolves.toBe(true);
      await expect(rt.resolveFormatCheck({ seasonId: ids.season, checkId: id as string, status: 'rejected', adminId: null, note: null })).resolves.toBe(false);
      expect((await rows('checks')).find((c) => c.id === id)).toMatchObject({ status: 'confirmed', note: 'looks right' });

      await expect(rt.resolveFormatCheck({ seasonId: ids.season, checkId: randomUUID(), status: 'confirmed', adminId: null, note: null })).resolves.toBe(false);
      // A check of this league is not resolved through another league's id: the league is part of the key.
      const foreign = await rt.openFormatCheck({ seasonId: ids.season, source: 'expr', ruleId: 'r', dedupeKey: 'foreign:1', subject: {} });
      await expect(rt.resolveFormatCheck({ seasonId: randomUUID(), checkId: foreign as string, status: 'confirmed', adminId: null, note: null })).resolves.toBe(false);
      expect((await rows('checks')).find((c) => c.id === foreign)).toMatchObject({ status: 'open', resolved_at: null });
      await expect(rt.resolveFormatCheck({ seasonId: ids.season, checkId: foreign as string, status: 'rejected', adminId: null, note: null })).resolves.toBe(true);
      // A new check under the same key is still deduplicated after the first one resolved.
      await expect(rt.openFormatCheck(open)).resolves.toBeNull();
    });

    it('refuses an unknown source and an unknown status', async () => {
      await expect(rt.openFormatCheck({ seasonId: ids.season, source: 'vibes' as never, ruleId: 'r', dedupeKey: 'k', subject: {} })).rejects.toBeTruthy();
      const id = await rt.openFormatCheck({ seasonId: ids.season, source: 'expr', ruleId: 'r', dedupeKey: 'expr:1', subject: {} });
      await expect(rt.resolveFormatCheck({ seasonId: ids.season, checkId: id as string, status: 'open' as never, adminId: null, note: null })).rejects.toMatchObject({ message: 'invalid_op' });
    });
  });

  it('reads the whole runtime back and removes it with the league', async () => {
    const runtime = await rt.getFormatRuntime(ids.season);
    expect(runtime.relationLinks.filter((l) => l.relation_key === 'santa')).toHaveLength(3);
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
