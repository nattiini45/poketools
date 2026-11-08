import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test for the fences of the Format Studio engine migrations (20261105090000, 20261105120000, 20261106090000):
//   * format_check_open carries the revision of the context it was planned from (no ghost check, no burnt dedupe key),
//     and an attach clears the orphan rows of a league without a format;
//   * round_write takes the league locks first, moves the phase with its round and refuses a stale revision, so a round
//     write and a format detach never both succeed;
//   * an adjustment decides domain_in_use, action_state_unchanged and a short revoke under its own locks;
//   * the exclusive keys are locked in one order (no 40P01 between two submits that grant [X, Y] and [Y, X]);
//   * the enrollment replace decides "frozen / rounds" under the phase lock and the freeze is one atomic update;
//   * the confirmation of a clear is bound to the counts the admin saw; the format_type guard; the clock shift of a restore.
// Opt-in only (`LOCAL_SUPABASE_FORMAT_RUNTIME=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_RUNTIME');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type RuntimeMod = typeof import('@/lib/supabase/queries/format-runtime');
type RoundsMod = typeof import('@/lib/supabase/queries/rounds');
type TournamentsMod = typeof import('@/lib/supabase/queries/tournaments');
type Json = import('@/types/database').Json;

let client: ClientMod['supabase'];
let rt: RuntimeMod;
let roundsQ: RoundsMod;
let tournamentsQ: TournamentsMod;

const RUN = randomUUID().slice(0, 8);
const HASH = 'c'.repeat(64);
const players = { p1: randomUUID(), p2: randomUUID(), p3: randomUUID() };
const rulesetId = randomUUID();
const seasonsToDrop: string[] = [];

const must = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[${label}] ${JSON.stringify(error)}`);
};

/** A custom league with an attached format (its spec is what the database reads) and, optionally, one keyed phase. */
async function league(spec: Json = {}, withPhase = false): Promise<{ season: string; phase: string | null }> {
  const season = randomUUID();
  seasonsToDrop.push(season);
  await must('season', client.from('seasons').insert({ id: season, name: `Fences ${RUN} ${season.slice(0, 4)}`, format_type: 'custom' }));
  await must('format', client.from('season_formats').insert({ season_id: season, version_no: 1, spec, spec_hash: HASH, seed: 'seedseed1' }));
  let phase: string | null = null;
  if (withPhase) {
    phase = randomUUID();
    await must(
      'phase',
      client.from('tournaments').insert({
        id: phase, season_id: season, name: 'Main', bracket_type: 'round_robin', ruleset_id: rulesetId, format_stage_key: 'main', stage_order: 1,
      }),
    );
  }
  return { season, phase };
}

async function revisionOf(season: string): Promise<number> {
  const { data, error } = await client.from('season_formats').select('revision').eq('season_id', season).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.revision;
}

/** What an admin's amendment, engine switch or replace does to the row: any UPDATE moves the revision. */
const bumpRevision = (season: string) => must('bump', client.from('season_formats').update({ tunables: { n: Math.random() } }).eq('season_id', season));

const attach = (season: string, over: Record<string, unknown> = {}) =>
  client.rpc('format_attach_season', {
    p_season_id: season,
    p_definition_id: null as unknown as string,
    p_version_no: 1,
    p_spec: {},
    p_spec_hash: HASH,
    p_seed: 'seedseed1',
    p_stages: [],
    p_preset_rulesets: {},
    ...over,
  });

const grant = (resource: string, player_id: string, item_id: string | null, extra: Record<string, unknown> = {}) =>
  ({ op: 'grant_item', resource, player_id, item_id, amount: 1, exclusive: false, source: 'event', source_ref: null, ...extra }) as import('@/lib/supabase/queries/format-runtime').FormatOp;

const fire = async (season: string, ops: import('@/lib/supabase/queries/format-runtime').FormatOp[], key: string) =>
  rt.fireFormatEvent({ seasonId: season, eventKey: key, event: 'time', payload: {}, ops, firedBy: null, revision: await revisionOf(season) });

const itemsOf = async (season: string, resource: string, player?: string) => {
  let query = client.from('format_resource_items').select('*').eq('season_id', season).eq('resource_key', resource);
  if (player) query = query.eq('player_id', player);
  const { data, error } = await query;
  if (error) throw new Error(JSON.stringify(error));
  return data ?? [];
};

const checksOf = async (season: string) => {
  const { data, error } = await client.from('format_checks').select('*').eq('season_id', season);
  if (error) throw new Error(JSON.stringify(error));
  return data ?? [];
};

describe.skipIf(!optIn)('format fences (local stack)', () => {
  beforeAll(async () => {
    ({ supabase: client } = await import('@/lib/supabase/client'));
    rt = await import('@/lib/supabase/queries/format-runtime');
    roundsQ = await import('@/lib/supabase/queries/rounds');
    tournamentsQ = await import('@/lib/supabase/queries/tournaments');
    await must('ruleset', insertLocalRuleset(client, { id: rulesetId, name: `Fences ${RUN} Ruleset` }));
    await must(
      'players',
      client.from('players').insert(Object.values(players).map((id, i) => ({ id, name: `Fences ${RUN} ${i}`, is_guest: true })), { defaultToNull: false }),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    if (seasonsToDrop.length > 0) await client.from('seasons').delete().in('id', seasonsToDrop);
    await client.from('players').delete().in('id', Object.values(players));
    await deleteLocalRuleset(client, rulesetId);
  }, 60000);

  describe('format_check_open carries the revision of its context', () => {
    it('opens under the current revision and refuses a stale one without burning the dedupe key', async () => {
      const { season } = await league();
      const stale = await revisionOf(season);
      await bumpRevision(season); // a replace, an engine switch or an amendment since the context was loaded
      const input = { seasonId: season, source: 'expr' as const, ruleId: 'r', dedupeKey: 'expr:fence:1', subject: {} };

      await expect(rt.openFormatCheck({ ...input, revision: stale })).rejects.toMatchObject({ name: 'FormatRuntimeError', code: 'format_context_stale' });
      expect(await checksOf(season)).toEqual([]);
      // The key stayed free: the current format opens its own check under it.
      await expect(rt.openFormatCheck({ ...input, revision: await revisionOf(season) })).resolves.toEqual(expect.any(String));
      expect(await checksOf(season)).toHaveLength(1);
    });

    it('opens nothing for a league whose format was detached since (no ghost check for the next first attach)', async () => {
      const { season } = await league();
      const revision = await revisionOf(season);
      const detached = await client.rpc('format_detach_season', { p_season_id: season });
      expect(detached.error).toBeNull();
      await expect(
        rt.openFormatCheck({ seasonId: season, source: 'deadline_missed', ruleId: 'r', dedupeKey: 'deadline:ghost', subject: {}, revision }),
      ).rejects.toMatchObject({ code: 'format_context_stale' });
      expect(await checksOf(season)).toEqual([]);
    });

    it('clears the rows an old writer left in a league without a format when the first attach comes', async () => {
      const season = randomUUID();
      seasonsToDrop.push(season);
      await must('season', client.from('seasons').insert({ id: season, name: `Fences ${RUN} orphan`, format_type: 'custom' }));
      await must('orphan check', client.from('format_checks').insert({ season_id: season, source: 'deadline_missed', rule_id: 'r', dedupe_key: 'deadline:orphan', subject: {} }));
      expect(await checksOf(season)).toHaveLength(1);

      const first = await attach(season);
      expect(first.error).toBeNull();
      expect(first.data).toMatchObject({ replaced: false });
      expect(await checksOf(season)).toEqual([]);
    });
  });

  describe('format_forfeit_complete decides the format and the status in one transaction', () => {
    const forfeitMatch = async (engine: 'kit' | 'shadow' = 'kit') => {
      const { season, phase } = await league({}, true);
      await must('engine', client.from('season_formats').update({ engine }).eq('season_id', season));
      const round = randomUUID();
      const match = randomUUID();
      await must('round', client.from('rounds').insert({ id: round, tournament_id: phase as string, name: 'Round 1', round_number: 1, best_of: 1 }));
      await must('match', client.from('matches').insert({ id: match, round_id: round, tournament_id: phase as string, player_1_id: players.p1, player_2_id: players.p2 }));
      return { season, match, revision: await revisionOf(season) };
    };
    const rowOf = async (match: string) => {
      const { data, error } = await client.from('matches').select('status, winner_id, confirmed_at, date_played, auto_confirm_at, finalized_at').eq('id', match).single();
      if (error) throw new Error(JSON.stringify(error));
      return data;
    };

    it('completes the match with the fields of a completed status write', async () => {
      const { season, match, revision } = await forfeitMatch();
      await expect(rt.completeFormatForfeit({ seasonId: season, matchId: match, expectedStatus: 'scheduled', winnerId: players.p1, revision })).resolves.toBe(true);
      const row = await rowOf(match);
      expect(row).toMatchObject({ status: 'completed', winner_id: players.p1, auto_confirm_at: null, finalized_at: null });
      expect(row.confirmed_at).not.toBeNull();
      expect(row.date_played).not.toBeNull();
    });

    it('writes nothing for a stale revision, a league off the kit, or a detached format', async () => {
      const stale = await forfeitMatch();
      await bumpRevision(stale.season);
      await expect(
        rt.completeFormatForfeit({ seasonId: stale.season, matchId: stale.match, expectedStatus: 'scheduled', winnerId: players.p1, revision: stale.revision }),
      ).rejects.toMatchObject({ name: 'FormatRuntimeError', code: 'format_context_stale' });
      expect((await rowOf(stale.match)).status).toBe('scheduled');

      const off = await forfeitMatch('shadow');
      await expect(
        rt.completeFormatForfeit({ seasonId: off.season, matchId: off.match, expectedStatus: 'scheduled', winnerId: players.p1, revision: off.revision }),
      ).rejects.toMatchObject({ code: 'format_context_stale' });
      expect((await rowOf(off.match)).status).toBe('scheduled');

      const detached = await forfeitMatch();
      // format_detach_season refuses a league with rounds; what the forfeit must survive is the missing row itself.
      await must('detach', client.from('season_formats').delete().eq('season_id', detached.season));
      await expect(
        rt.completeFormatForfeit({ seasonId: detached.season, matchId: detached.match, expectedStatus: 'scheduled', winnerId: players.p1, revision: detached.revision }),
      ).rejects.toMatchObject({ code: 'format_context_stale' });
      expect((await rowOf(detached.match)).status).toBe('scheduled');
    });

    it('answers false and writes nothing when the status moved or the match is of another league', async () => {
      const { season, match, revision } = await forfeitMatch();
      await expect(rt.completeFormatForfeit({ seasonId: season, matchId: match, expectedStatus: 'in_progress', winnerId: players.p1, revision })).resolves.toBe(false);
      expect((await rowOf(match)).status).toBe('scheduled');

      const other = await forfeitMatch();
      await expect(rt.completeFormatForfeit({ seasonId: other.season, matchId: match, expectedStatus: 'scheduled', winnerId: players.p1, revision: other.revision })).resolves.toBe(false);
      expect((await rowOf(match)).status).toBe('scheduled');
    });
  });

  describe('round_write', () => {
    const pairs = [{ player_1_id: players.p1, player_2_id: players.p2 }];

    it('moves the phase to active and raises current_round in the round transaction, never backwards', async () => {
      const { season, phase } = await league({}, true);
      const revision = await revisionOf(season);
      const first = await roundsQ.createRoundWithMatches({ tournament_id: phase as string, name: 'Round 3', round_number: 3, best_of: 1, matches: pairs, expected_revision: revision });
      expect(first.round_number).toBe(3);
      const afterFirst = (await client.from('tournaments').select('status, current_round').eq('id', phase as string).single()).data;
      expect(afterFirst).toEqual({ status: 'active', current_round: 3 });

      // An earlier week filled later (a retry) never moves the counter back.
      await roundsQ.createRoundWithMatches({ tournament_id: phase as string, name: 'Round 2', round_number: 2, best_of: 1, matches: pairs, expected_revision: revision });
      expect((await client.from('tournaments').select('status, current_round').eq('id', phase as string).single()).data).toEqual({ status: 'active', current_round: 3 });
    });

    it('refuses a write planned from a format that was replaced since, and writes nothing', async () => {
      const { season, phase } = await league({}, true);
      const planned = await revisionOf(season);
      await bumpRevision(season);
      await expect(
        roundsQ.createRoundWithMatches({ tournament_id: phase as string, name: 'Round 1', round_number: 1, best_of: 1, matches: pairs, expected_revision: planned }),
      ).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
      expect((await client.from('rounds').select('id').eq('tournament_id', phase as string)).data).toEqual([]);
      expect((await client.from('tournaments').select('status, current_round').eq('id', phase as string).single()).data).toEqual({ status: 'upcoming', current_round: 0 });
    });

    it('never lets a round write and a format detach both succeed (the detach would cascade the round away)', async () => {
      for (let i = 0; i < 6; i++) {
        const { season, phase } = await league({}, true);
        const revision = await revisionOf(season);
        const [write, detach] = await Promise.allSettled([
          roundsQ.createRoundWithMatches({ tournament_id: phase as string, name: 'Round 1', round_number: 1, best_of: 1, matches: pairs, expected_revision: revision }),
          client.rpc('format_detach_season', { p_season_id: season, p_confirm_clear: true }).then(({ error }) => {
            if (error) throw error;
          }),
        ]);
        const rounds = (await client.from('rounds').select('id').eq('tournament_id', phase as string)).data ?? [];
        if (write.status === 'fulfilled') {
          // The write won: the detach saw the round (the phase is active now) and refused, the round is still there.
          expect(detach.status).toBe('rejected');
          expect((detach as PromiseRejectedResult).reason).toMatchObject({ message: 'FORMAT_SEASON_STARTED' });
          expect(rounds).toHaveLength(1);
        } else {
          // The detach won: the phase is gone, so the write was refused instead of being cascade-deleted after an answer.
          expect(detach.status).toBe('fulfilled');
          expect(rounds).toEqual([]);
        }
      }
    });
  });

  describe('round_delete', () => {
    const pairs = [{ player_1_id: players.p1, player_2_id: players.p2 }];

    it('deletes the round and its matches together, cancels the challenge that points at a match, and refuses a match that is not scheduled any more', async () => {
      const { season, phase } = await league({}, true);
      const round = await roundsQ.createRoundWithMatches({ tournament_id: phase as string, name: 'Round 1', round_number: 1, best_of: 1, matches: pairs });
      const matchId = ((await client.from('matches').select('id').eq('round_id', round.id)).data ?? [])[0]?.id as string;
      await must(
        'challenge',
        client.from('format_challenges').insert({
          season_id: season, phase_id: phase as string, challenger_id: players.p2, defender_id: players.p1, round: 1, status: 'accepted',
          match_id: matchId, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      );

      // A result landed after the application's own reset: refused, nothing deleted.
      await must('played', client.from('matches').update({ status: 'in_progress' }).eq('id', matchId));
      const refused = await client.rpc('round_delete', { p_round_id: round.id });
      expect(refused.error).toMatchObject({ code: 'P0001', message: 'round_changed' });
      expect((await client.from('rounds').select('id').eq('id', round.id)).data).toHaveLength(1);

      await must('reset', client.from('matches').update({ status: 'scheduled' }).eq('id', matchId));
      const deleted = await client.rpc('round_delete', { p_round_id: round.id });
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual({ outcome: 'deleted', matches: 1 });
      expect((await client.from('rounds').select('id').eq('id', round.id)).data).toEqual([]);
      expect((await client.from('matches').select('id').eq('round_id', round.id)).data).toEqual([]);
      // The accepted challenge no longer claims a match that is gone (and does not count towards the cooldown).
      expect((await client.from('format_challenges').select('status, match_id').eq('season_id', season)).data).toEqual([{ status: 'cancelled', match_id: null }]);
      // A second delete finds nothing.
      expect((await client.rpc('round_delete', { p_round_id: round.id })).data).toEqual({ outcome: 'not_found' });
    });
  });

  describe('adjustments decide the state-reading refusals under their own locks', () => {
    const resources = [{ key: 'box', capacity: 5, holds: { kind: 'domain', domain: 'gifts' } }];

    it('refuses a domain amendment that removes an entry a resource holding the domain still holds (domain_in_use)', async () => {
      const { season } = await league({ resources });
      await fire(season, [grant('box', players.p1, 'gold')], 'give-gold');
      const amend = async (remove: string[]) =>
        rt.applyFormatAdjustment({
          seasonId: season, kind: 'domain', target: { domain: 'gifts' }, delta: { domain: 'gifts', remove }, reason: 'amend', adminId: null,
          ops: [], guardActions: [], revision: await revisionOf(season),
        });
      await expect(amend(['gold'])).rejects.toMatchObject({ name: 'FormatAdjustmentRefusedError', refusal: 'domain_in_use' });
      // Nothing was recorded or amended; an entry nobody holds goes through.
      expect((await client.from('format_adjustments').select('id').eq('season_id', season)).data).toEqual([]);
      await expect(amend(['silver'])).resolves.toEqual(expect.any(String));
    });

    it('takes no ops on a domain amendment (they would be applied after the season_formats row lock, with their locks taken late)', async () => {
      const { season } = await league({ resources });
      await expect(
        rt.applyFormatAdjustment({
          seasonId: season, kind: 'domain', target: { domain: 'gifts' }, delta: { domain: 'gifts', remove: [] }, reason: 'x', adminId: null,
          ops: [{ op: 'lock_action', action: 'a' }], guardActions: [], revision: await revisionOf(season),
        }),
      ).rejects.toMatchObject({ message: 'invalid_op' });
    });

    it('refuses an action adjustment to the state the action is already in, so the history never records a change that did not happen', async () => {
      const { season } = await league({});
      const adjust = async (state: 'open' | 'locked') =>
        rt.applyFormatAdjustment({
          seasonId: season, kind: 'action', target: { action: 'a1' }, delta: { state }, reason: 'manual', adminId: null,
          ops: [state === 'open' ? { op: 'open_action', action: 'a1' } : { op: 'lock_action', action: 'a1' }], guardActions: [], revision: await revisionOf(season),
        });
      await expect(adjust('locked')).resolves.toEqual(expect.any(String));
      await expect(adjust('locked')).rejects.toMatchObject({ refusal: 'action_state_unchanged' });
      await expect(adjust('open')).resolves.toEqual(expect.any(String));
      await expect(adjust('open')).rejects.toMatchObject({ refusal: 'action_state_unchanged' });
      expect((await client.from('format_adjustments').select('id').eq('season_id', season)).data).toHaveLength(2);
    });

    it('never records a revoke that removed nothing: an adjustment and an event racing for the one unit leave a history that matches the holding', async () => {
      for (let i = 0; i < 6; i++) {
        const { season } = await league({ resources: [{ key: 'coin', capacity: 5 }] });
        await fire(season, [grant('coin', players.p1, null)], 'give-coin');
        const [adjusted, evented] = await Promise.allSettled([
          (async () =>
            rt.applyFormatAdjustment({
              seasonId: season, kind: 'resource', target: { resource: 'coin', player_id: players.p1, item_id: null }, delta: { amount: -1 },
              reason: 'revoke', adminId: null,
              ops: [{ op: 'revoke_item', resource: 'coin', player_id: players.p1, item_id: null, amount: 1 }], guardActions: [], revision: await revisionOf(season),
            }))(),
          fire(season, [{ op: 'revoke_item', resource: 'coin', player_id: players.p1, item_id: null, amount: 1 }], 'revert-coin'),
        ]);
        expect(evented.status).toBe('fulfilled'); // an event's revoke stays lenient
        const rows = (await client.from('format_adjustments').select('id').eq('season_id', season)).data ?? [];
        expect(await itemsOf(season, 'coin', players.p1)).toEqual([]);
        // Whoever came second: the adjustment is recorded only when it removed the unit itself.
        if (adjusted.status === 'rejected') {
          expect((adjusted as PromiseRejectedResult).reason).toMatchObject({ refusal: 'insufficient_holding' });
          expect(rows).toHaveLength(0);
        } else {
          expect(rows).toHaveLength(1);
        }
      }
    });
  });

  describe('exclusive items', () => {
    it('orders the exclusive keys: two submits granting [X, Y] and [Y, X] to different players never deadlock', async () => {
      const { season } = await league({});
      const submit = async (action: string, actor: string, items: string[]) =>
        rt.submitFormatAction({
          seasonId: season, actionKey: action, actorId: actor, targetId: null, picks: [] as Json,
          items: items.map((item_id) => ({ resource: 'rare', item_id, exclusive: true })), lock: false, revision: await revisionOf(season),
        });
      for (let i = 0; i < 6; i++) {
        const a = `x${i}`;
        const b = `y${i}`;
        const outcomes = await Promise.allSettled([submit(`act_a${i}`, players.p1, [a, b]), submit(`act_b${i}`, players.p2, [b, a])]);
        for (const outcome of outcomes) {
          // A clean 'taken' for the loser; a deadlock (40P01) would surface as another code.
          if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'resource_item_taken' });
        }
        expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
      }
    });
  });

  describe('phase enrollment', () => {
    const entries = (ids: string[]) => ids.map((player_id, index) => ({ player_id, seed: index + 1 }));
    const source = (over: Record<string, unknown> = {}) => ({ type: 'roster', source_phase_id: null, synced_at: '2026-01-01T00:00:00.000Z', frozen: false, ...over });
    const replace = (phase: string, ids: string[], expected: string | null, force = false, src: Record<string, unknown> = source({ synced_at: new Date().toISOString() })) =>
      tournamentsQ.replacePhaseEnrollment(phase, entries(ids), src as never, expected, force);
    const seed = async () => {
      const { phase } = await league({}, true);
      await must('source', client.from('tournaments').update({ enrollment_source: source() }).eq('id', phase as string));
      return phase as string;
    };
    const enrolled = async (phase: string) => ((await client.from('tournament_participants').select('player_id').eq('tournament_id', phase)).data ?? []).map((r) => r.player_id).sort();
    const sourceOf = async (phase: string) => (await client.from('tournaments').select('enrollment_source').eq('id', phase).single()).data?.enrollment_source as Record<string, unknown>;

    it('freezes in one atomic update that leaves synced_at and the contributions alone, and a replace after it is refused under the lock', async () => {
      const phase = await seed();
      await must('contributions', client.from('tournaments').update({ enrollment_source: source({ contributions: [{ block: 'a' }] }) }).eq('id', phase));
      await expect(replace(phase, [players.p1, players.p2], '2026-01-01T00:00:00.000Z')).resolves.toBe(true);
      const before = await sourceOf(phase);

      await tournamentsQ.freezeEnrollment(phase);
      const after = await sourceOf(phase);
      expect(after).toMatchObject({ ...before, frozen: true });
      expect(after.synced_at).toBe(before.synced_at);

      // A sync that read the phase unfrozen (its expected token still matches) is refused: the admin's roster stays.
      await expect(replace(phase, [players.p3], after.synced_at as string)).rejects.toMatchObject({ code: 'ENROLLMENT_FROZEN' });
      expect(await enrolled(phase)).toEqual([players.p1, players.p2].sort());
      // A forced sync overwrites on purpose and keeps the stored frozen flag, whatever the source it computed said.
      await expect(replace(phase, [players.p3], after.synced_at as string, true, source({ synced_at: 'T2', frozen: false }))).resolves.toBe(true);
      expect(await enrolled(phase)).toEqual([players.p3]);
      expect((await sourceOf(phase)).frozen).toBe(true);
    });

    it('refuses a sync that is not forced once a round exists, before anything is deleted', async () => {
      const phase = await seed();
      await expect(replace(phase, [players.p1], '2026-01-01T00:00:00.000Z')).resolves.toBe(true);
      await must('round', client.from('rounds').insert({ tournament_id: phase, name: 'Round 1', round_number: 1, best_of: 1 }));
      const token = (await sourceOf(phase)).synced_at as string;
      await expect(replace(phase, [players.p2], token)).rejects.toMatchObject({ code: 'ENROLLMENT_ROUNDS_EXIST' });
      expect(await enrolled(phase)).toEqual([players.p1]);
    });
  });

  describe('attach and detach', () => {
    it('binds the confirmation of a clear to the counts the admin saw', async () => {
      const { season } = await league({});
      await fire(season, [grant('coin', players.p1, null)], 'gift-1');
      const refused = await attach(season);
      expect(refused.error).toMatchObject({ message: 'FORMAT_RUNTIME_HAS_DATA' });
      const shown = JSON.parse((refused.error as { details: string }).details) as Record<string, number>;

      // More rows arrived while the dialog was open: the confirmation does not cover them.
      await fire(season, [grant('coin', players.p2, null), grant('coin', players.p3, null)], 'gift-2');
      const stale = await attach(season, { p_confirm_clear: true, p_confirmed_counts: shown });
      expect(stale.error).toMatchObject({ message: 'FORMAT_RUNTIME_HAS_DATA' });
      const fresh = JSON.parse((stale.error as { details: string }).details) as Record<string, number>;
      expect(fresh.items).toBeGreaterThan(shown.items);
      expect((await itemsOf(season, 'coin')).length).toBe(3);

      const confirmed = await attach(season, { p_confirm_clear: true, p_confirmed_counts: fresh });
      expect(confirmed.error).toBeNull();
      expect(await itemsOf(season, 'coin')).toEqual([]);
    });

    it('locks every phase row before it decides the league has not started, so an active phase refuses the attach', async () => {
      const { season, phase } = await league({}, true);
      await must('activate', client.from('tournaments').update({ status: 'active' }).eq('id', phase as string));
      expect((await attach(season)).error).toMatchObject({ message: 'FORMAT_SEASON_STARTED' });
      expect((await client.rpc('format_detach_season', { p_season_id: season })).error).toMatchObject({ message: 'FORMAT_SEASON_STARTED' });
    });

    it('deletes the challenges of the old spec with the rest of the runtime', async () => {
      const { season, phase } = await league({}, true);
      await must('participants', client.from('tournament_participants').insert([players.p1, players.p2].map((player_id) => ({ tournament_id: phase as string, player_id }))));
      await must(
        'challenge',
        client.from('format_challenges').insert({
          season_id: season, phase_id: phase as string, challenger_id: players.p2, defender_id: players.p1, round: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      );
      const cleared = await client.rpc('format__clear_runtime', { p_season_id: season });
      expect(cleared.error).toBeNull();
      expect((await client.from('format_challenges').select('id').eq('season_id', season)).data).toEqual([]);
    });
  });

  describe('format_type guard', () => {
    it('refuses to switch a league with an attached format away from custom, and a started league either way', async () => {
      const { season } = await league({});
      const switched = await client.from('seasons').update({ format_type: 'evolution_point_buy' }).eq('id', season);
      expect(switched.error).toMatchObject({ message: 'season_format_type_locked' });
      expect((await client.from('seasons').select('format_type').eq('id', season).single()).data?.format_type).toBe('custom');

      // Without a format and before the start a switch is free; the legacy types never needed a format.
      await must('detach', client.rpc('format_detach_season', { p_season_id: season }));
      await must('to legacy', client.from('seasons').update({ format_type: 'evolution_point_buy' }).eq('id', season));
      await must('back to custom', client.from('seasons').update({ format_type: 'custom' }).eq('id', season));
      await must('legacy to legacy', client.from('seasons').update({ format_type: 'evolution_point_buy', name: 'renamed' }).eq('id', season));

      // A started league keeps its type.
      await must('start', client.from('seasons').update({ status: 'active' }).eq('id', season));
      expect((await client.from('seasons').update({ format_type: 'custom' }).eq('id', season)).error).toMatchObject({ message: 'season_format_type_locked' });
    });
  });

  describe('recycle bin clock', () => {
    it('adds the time a league spent in the trash to the format row, once per restore', async () => {
      const shifted = await client.rpc('league_trash__shift', { p_rel: 'season_formats', p_row: { clock_shift_seconds: 10 } as Json, p_shift: '1 day' });
      expect(shifted.error).toBeNull();
      expect((shifted.data as { clock_shift_seconds: number }).clock_shift_seconds).toBe(86410);
      const first = await client.rpc('league_trash__shift', { p_rel: 'season_formats', p_row: {} as Json, p_shift: '90 minutes' });
      expect((first.data as { clock_shift_seconds: number }).clock_shift_seconds).toBe(5400);
    });
  });
});
