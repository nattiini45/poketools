import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';

// LIVE-LOCAL test for the runtime clean-up of 20261105090000_format_runtime.sql (format__clear_runtime) and its two
// callers in 20261105120000_format_foreach_group.sql: an attach that REPLACES a format and a detach empty the nine
// format_* runtime tables of the league, so a stale event key, flag, link, item or pick of the old spec cannot block the
// new one. Another league's rows stay. Links, items, submissions or adjustments are never deleted silently: without
// `p_confirm_clear` the replace and the detach refuse with FORMAT_RUNTIME_HAS_DATA and the counts, and change nothing. Opt-in only (`LOCAL_SUPABASE_FORMAT_RUNTIME=1` or `npm run test:db`), never
// loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_RUNTIME');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type RuntimeMod = typeof import('@/lib/supabase/queries/format-runtime');

let client: ClientMod['supabase'];
let rt: RuntimeMod;

const RUN = randomUUID().slice(0, 8);
const ids = { season: randomUUID(), other: randomUUID(), p1: randomUUID(), p2: randomUUID() };
const HASH = 'b'.repeat(64);

const attach = (seasonId: string, confirmClear = false) =>
  client.rpc('format_attach_season', {
    p_season_id: seasonId,
    p_definition_id: null as unknown as string,
    p_version_no: 1,
    p_spec: {},
    p_spec_hash: HASH,
    p_seed: 'seedseed1',
    p_stages: [],
    p_preset_rulesets: {},
    p_confirm_clear: confirmClear,
  });

/** The revision of the format attached to a league, as the application reads it with the spec it validates against. */
async function revisionOf(seasonId: string): Promise<number> {
  const { data, error } = await client.from('season_formats').select('revision').eq('season_id', seasonId).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.revision;
}

/** One row in every one of the nine runtime tables of a league, written through the real writers. */
async function fillRuntime(seasonId: string, tag: string): Promise<void> {
  await rt.fireFormatEvent({
    seasonId,
    eventKey: `stage_start:${tag}`,
    event: 'stage_start',
    payload: {},
    firedBy: null,
    revision: await revisionOf(seasonId),
    ops: [
      { op: 'set_flag', key: 'domain:pool', value: 'unlocked' },
      { op: 'set_relation', relation: 'santa', links: [{ from: ids.p1, to: ids.p2 }, { from: ids.p2, to: ids.p1 }] },
      { op: 'grant_item', resource: 'coins', player_id: ids.p1, item_id: null, amount: 2, exclusive: false, source: 'event', source_ref: null },
      { op: 'set_attr', player_id: ids.p1, attr: 'role', value: 'x', source: 'event' },
      { op: 'adjust_points', stage: 'main', player_id: ids.p1, points: 1, reason: 'rule' },
      { op: 'lock_action', action: 'pick' },
      { op: 'set_track', track: 'steps', player_id: ids.p1, step: 2 },
    ],
  });
  await rt.saveFormatAction({ seasonId, actionKey: 'other_pick', actorId: ids.p1, targetId: null, picks: [], revision: await revisionOf(seasonId) });
  await rt.openFormatCheck({ seasonId, source: 'expr', ruleId: 'r', dedupeKey: `expr:${tag}`, subject: {}, revision: await revisionOf(seasonId) });
}

const sizes = async (seasonId: string) => {
  const runtime = await rt.getFormatRuntime(seasonId);
  return Object.fromEntries(Object.entries(runtime).map(([key, list]) => [key, list.length]));
};

describe.skipIf(!optIn)('format runtime clean-up on attach-replace and detach (local stack)', () => {
  beforeAll(async () => {
    ({ supabase: client } = await import('@/lib/supabase/client'));
    rt = await import('@/lib/supabase/queries/format-runtime');
    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };
    await run(
      'players',
      client.from('players').insert([ids.p1, ids.p2].map((id, i) => ({ id, name: `Attach ${RUN} ${i}`, is_guest: true })), { defaultToNull: false }),
    );
    await run(
      'seasons',
      client.from('seasons').insert([ids.season, ids.other].map((id, i) => ({ id, name: `Attach ${RUN} ${i}`, format_type: 'custom' as const }))),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    await client.from('seasons').delete().in('id', [ids.season, ids.other]);
    await client.from('players').delete().in('id', [ids.p1, ids.p2]);
  }, 60000);

  it('keeps the runtime that exists after a first attach (nothing to replace)', async () => {
    const first = await attach(ids.season);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ replaced: false });
    await attach(ids.other);
    await fillRuntime(ids.season, 'first');
    await fillRuntime(ids.other, 'other');
    expect(Object.values(await sizes(ids.season)).every((n) => n > 0)).toBe(true);
    expect(Object.values(await sizes(ids.other)).every((n) => n > 0)).toBe(true);
  });

  it('refuses a replace over links, items and submissions without the confirmation, and changes nothing', async () => {
    const before = await sizes(ids.season);
    const refused = await attach(ids.season);
    expect(refused.error).toMatchObject({ code: 'P0001', message: 'FORMAT_RUNTIME_HAS_DATA' });
    const detail = JSON.parse((refused.error as { details: string }).details) as Record<string, number>;
    expect(detail.links).toBeGreaterThan(0);
    expect(detail.items).toBeGreaterThan(0);
    expect(detail.submissions).toBeGreaterThan(0);
    expect(await sizes(ids.season)).toEqual(before);
  });

  it('refuses a detach over runtime data without the confirmation, and keeps the format', async () => {
    const before = await sizes(ids.season);
    const refused = await client.rpc('format_detach_season', { p_season_id: ids.season });
    expect(refused.error).toMatchObject({ code: 'P0001', message: 'FORMAT_RUNTIME_HAS_DATA' });
    expect(await sizes(ids.season)).toEqual(before);
    const kept = await client.from('season_formats').select('season_id').eq('season_id', ids.season);
    expect(kept.data).toHaveLength(1);
  });

  it('empties all nine runtime tables when an attach replaces the format with the confirmation, so the new spec starts clean', async () => {
    const replaced = await attach(ids.season, true);
    expect(replaced.error).toBeNull();
    expect(replaced.data).toMatchObject({ replaced: true });
    expect(Object.values(await sizes(ids.season)).every((n) => n === 0)).toBe(true);
    // The old "already fired" key and the locked flag are gone: the same event fires again and the action is open.
    await expect(
      rt.fireFormatEvent({
        seasonId: ids.season, eventKey: 'stage_start:first', event: 'stage_start', payload: {}, firedBy: null, ops: [], revision: await revisionOf(ids.season),
      }),
    ).resolves.toBe(true);
    await expect(
      rt.saveFormatAction({ seasonId: ids.season, actionKey: 'pick', actorId: ids.p1, targetId: null, picks: [], revision: await revisionOf(ids.season) }),
    ).resolves.toMatchObject({ status: 'draft' });
    // The other league kept everything.
    expect(Object.values(await sizes(ids.other)).every((n) => n > 0)).toBe(true);
  });

  it('replaces and detaches a league without links, items, submissions or adjustments with no confirmation', async () => {
    await attach(ids.season, true);
    const replaced = await attach(ids.season);
    expect(replaced.error).toBeNull();
    expect(replaced.data).toMatchObject({ replaced: true });
    // Flags and event keys alone are rebuilt by the new spec and do not need a confirmation.
    await rt.fireFormatEvent({
      seasonId: ids.season,
      eventKey: 'stage_start:flags_only',
      event: 'stage_start',
      payload: {},
      firedBy: null,
      revision: await revisionOf(ids.season),
      ops: [{ op: 'set_flag', key: 'domain:pool', value: 'unlocked' }],
    });
    expect((await attach(ids.season)).error).toBeNull();
    expect(Object.values(await sizes(ids.season)).every((n) => n === 0)).toBe(true);
  });

  it('empties all nine runtime tables on detach', async () => {
    await fillRuntime(ids.season, 'second');
    expect(Object.values(await sizes(ids.season)).some((n) => n > 0)).toBe(true);
    const refused = await client.rpc('format_detach_season', { p_season_id: ids.season });
    expect(refused.error).toMatchObject({ message: 'FORMAT_RUNTIME_HAS_DATA' });
    const detached = await client.rpc('format_detach_season', { p_season_id: ids.season, p_confirm_clear: true });
    expect(detached.error).toBeNull();
    // The confirmed detach reports what it deleted (the audit entry records it).
    const cleared = (detached.data as { cleared: Record<string, number> }).cleared;
    expect(Object.keys(cleared).sort()).toEqual(['adjustments', 'items', 'links', 'submissions']);
    expect(cleared.links + cleared.items + cleared.submissions + cleared.adjustments).toBeGreaterThan(0);
    expect(Object.values(await sizes(ids.season)).every((n) => n === 0)).toBe(true);
    expect(Object.values(await sizes(ids.other)).every((n) => n > 0)).toBe(true);
  });

  it('refuses a pick validated before an attach-replace or a detach, and keeps no pick of the old format', async () => {
    expect((await attach(ids.season, true)).error).toBeNull();
    const stale = await revisionOf(ids.season);
    expect((await attach(ids.season, true)).error).toBeNull();
    const fresh = await revisionOf(ids.season);
    expect(fresh).not.toBe(stale);
    const pick = (revision: number, actionKey: string) => ({ seasonId: ids.season, actionKey, actorId: ids.p1, targetId: null, picks: [], revision });
    await expect(rt.saveFormatAction(pick(stale, 'old_format'))).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
    await expect(rt.submitFormatAction({ ...pick(stale, 'old_format'), items: [], lock: false })).rejects.toMatchObject({ code: 'format_context_stale' });

    // Detach, then attach again: the new row never reuses the number of the old one.
    expect((await client.rpc('format_detach_season', { p_season_id: ids.season, p_confirm_clear: true })).error).toBeNull();
    await expect(rt.submitFormatAction({ ...pick(fresh, 'old_format'), items: [], lock: false })).rejects.toMatchObject({ code: 'format_context_stale' });
    expect((await attach(ids.season)).error).toBeNull();
    expect(await revisionOf(ids.season)).toBeGreaterThan(fresh);
    await expect(rt.submitFormatAction({ ...pick(fresh, 'old_format'), items: [], lock: false })).rejects.toMatchObject({ code: 'format_context_stale' });
    expect((await rt.getFormatRuntime(ids.season)).actionSubmissions).toEqual([]);
  });

  it('never leaves a pick behind an attach-replace, however the write and the attach interleave (and never deadlocks)', async () => {
    expect((await attach(ids.season, true)).error).toBeNull();
    for (let round = 0; round < 6; round++) {
      const action = `replace_race_${round}`;
      const revision = await revisionOf(ids.season);
      const [write, replaced] = await Promise.allSettled([
        rt.submitFormatAction({ seasonId: ids.season, actionKey: action, actorId: ids.p1, targetId: null, picks: [], items: [], lock: false, revision }),
        attach(ids.season, true).then((out) => {
          if (out.error) throw new Error(JSON.stringify(out.error));
        }),
      ]);
      expect(replaced.status).toBe('fulfilled');
      // Either the submit ran first and the replace emptied the runtime, or the replace came first and the submit was
      // refused as stale. A pick written for the old format after the replace is the failure.
      if (write.status === 'rejected') expect(write.reason).toMatchObject({ code: 'format_context_stale' });
      expect((await rt.getFormatRuntime(ids.season)).actionSubmissions.filter((s) => s.action_key === action)).toEqual([]);
    }
  });

  it('refuses an event and an adjustment planned before an attach-replace or a detach, and leaves the new format its key', async () => {
    expect((await attach(ids.season, true)).error).toBeNull();
    const stale = await revisionOf(ids.season);
    expect((await attach(ids.season, true)).error).toBeNull();
    const fire = (revision: number) =>
      rt.fireFormatEvent({
        seasonId: ids.season, eventKey: 'stage_start:old_format', event: 'stage_start', payload: {}, firedBy: null, revision,
        ops: [{ op: 'set_flag', key: 'domain:old_format', value: 'unlocked' }],
      });
    const adjust = (revision: number) =>
      rt.applyFormatAdjustment({
        seasonId: ids.season, kind: 'points', target: { stage: 'main', player_id: ids.p1 }, delta: { points: 1 }, reason: 'old format',
        adminId: null, ops: [], guardActions: [], revision,
      });
    await expect(fire(stale)).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
    await expect(adjust(stale)).rejects.toMatchObject({ code: 'format_context_stale' });
    let runtime = await rt.getFormatRuntime(ids.season);
    expect(runtime.eventLog).toEqual([]);
    expect(runtime.flags).toEqual([]);
    expect(runtime.adjustments).toEqual([]);

    // The key was never logged, so the event of the new format fires under it.
    await expect(fire(await revisionOf(ids.season))).resolves.toBe(true);

    // A detach removes the row: nothing planned for it is applied afterwards.
    const last = await revisionOf(ids.season);
    expect((await client.rpc('format_detach_season', { p_season_id: ids.season, p_confirm_clear: true })).error).toBeNull();
    await expect(fire(last)).rejects.toMatchObject({ code: 'format_context_stale' });
    await expect(adjust(last)).rejects.toMatchObject({ code: 'format_context_stale' });
    runtime = await rt.getFormatRuntime(ids.season);
    expect(runtime.eventLog).toEqual([]);
    expect(runtime.adjustments).toEqual([]);
  });

  it('never leaves an event or its ops behind an attach-replace, however the call and the attach interleave (and never deadlocks)', async () => {
    expect((await attach(ids.season, true)).error).toBeNull();
    for (let round = 0; round < 6; round++) {
      const key = `replace_event_race_${round}`;
      const revision = await revisionOf(ids.season);
      const [fired, replaced] = await Promise.allSettled([
        rt.fireFormatEvent({
          seasonId: ids.season, eventKey: key, event: 'time', payload: {}, firedBy: null, revision,
          ops: [{ op: 'set_flag', key: `race:${round}`, value: 'old' }, { op: 'lock_action', action: `race_${round}` }],
        }),
        attach(ids.season, true).then((out) => {
          if (out.error) throw new Error(JSON.stringify(out.error));
        }),
      ]);
      expect(replaced.status).toBe('fulfilled');
      // Either the event ran first and the replace emptied the runtime, or the replace came first and the event was refused
      // as stale before its key was logged. A key or a flag of the old format in the new runtime is the failure.
      if (fired.status === 'rejected') expect(fired.reason).toMatchObject({ code: 'format_context_stale' });
      const runtime = await rt.getFormatRuntime(ids.season);
      expect(runtime.eventLog.filter((e) => e.event_key === key)).toEqual([]);
      expect(runtime.flags.filter((f) => f.key.startsWith('race:') || f.key.startsWith('action:race_'))).toEqual([]);
    }
  });
});
