import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database, Json } from '@/types/database';
import type { RatingStoragePort } from '@/lib/rating/storage';
import { insertAsSchemaOwner } from '@/test/local-schema-owner';

const optedIn = localStackOptIn('LOCAL_PHASE_RATING_STREAMS');

function session() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_poketools', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
  let output = '';
  let errors = '';
  let ended = false;
  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
  const done = new Promise<{ code: number | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
  return {
    send: (sql: string) => { if (!ended && !child.stdin.destroyed) child.stdin.write(`${sql}\n`); },
    finish: () => { if (!ended) { ended = true; child.stdin.end(); } return done; },
    waitFor: async (text: string) => {
      const until = Date.now() + 10_000;
      while (!output.includes(text)) {
        if (Date.now() >= until || child.exitCode !== null) throw new Error(`psql did not reach ${text}: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function sql(text: string) {
  const connection = session();
  connection.send(text);
  return connection.finish();
}

describe.skipIf(!optedIn)('rating/streak streams on the disposable phase-mode stack', () => {
  const players = [randomUUID(), randomUUID()];
  const ruleset = randomUUID();
  const season = randomUUID();
  const tournament = randomUUID();
  const phase = randomUUID();
  const round = randomUUID();
  const phaseRound = randomUUID();
  const standaloneMatch = randomUUID();
  const phaseMatch = randomUUID();
  const extraSeasons: string[] = [];
  const extraPhases: string[] = [];
  let client: SupabaseClient<Database>;
  let streams: typeof import('../rating-streak-streams');
  let ratings: typeof import('@/lib/rating/updateRatings');
  let streaks: typeof import('@/lib/gamification/streaks');

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await client.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(client, { id: ruleset, name: 'Stream fixture' })).error).toBeNull();
    expect((await client.from('players').insert(players.map((id) => ({ id, name: `Fixture ${id}`, is_guest: true })))).error).toBeNull();
    expect((await client.from('seasons').insert({ id: season, name: 'Stream league', format_type: 'singles', ruleset_id: ruleset })).error).toBeNull();
    expect((await client.from('tournaments').insert({ id: tournament, name: 'Stream cup', bracket_type: 'round_robin', ruleset_id: ruleset })).error).toBeNull();
    expect((await client.from('league_phases').insert({ id: phase, season_id: season, name: 'Stream phase', bracket_type: 'round_robin', ruleset_id: ruleset })).error).toBeNull();
    expect((await client.from('rounds').insert({ id: round, tournament_id: tournament, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    expect((await client.from('phase_rounds').insert({ id: phaseRound, phase_id: phase, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    const common = { player_1_id: players[0], player_2_id: players[1], winner_id: players[0], status: 'completed' as const, created_at: '2026-01-01T00:00:00Z' };
    expect((await client.from('matches').insert({ ...common, id: standaloneMatch, tournament_id: tournament, round_id: round, date_played: '2026-01-01T00:00:00.000001Z' })).error).toBeNull();
    expect((await client.from('phase_matches').insert({ ...common, id: phaseMatch, phase_id: phase, round_id: phaseRound, date_played: '2026-01-01T00:00:00.000002Z' })).error).toBeNull();
    [streams, ratings, streaks] = await Promise.all([import('../rating-streak-streams'), import('@/lib/rating/updateRatings'), import('@/lib/gamification/streaks')]);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    if (extraPhases.length) expect((await client.from('league_phases').delete().in('id', extraPhases)).error).toBeNull();
    if (extraSeasons.length) expect((await client.from('seasons').delete().in('id', extraSeasons)).error).toBeNull();
    expect((await client.from('league_phases').delete().eq('id', phase)).error).toBeNull();
    expect((await client.from('tournaments').delete().eq('id', tournament)).error).toBeNull();
    expect((await client.from('seasons').delete().eq('id', season)).error).toBeNull();
    expect((await client.from('players').delete().in('id', players)).error).toBeNull();
    expect((await deleteLocalRuleset(client, ruleset)).error).toBeNull();
  });

  it('applies a duplicate native finalize once, retries and rebuilds both sources in stable order', async () => {
    const native = streams.createMixedRatingStorage('phase');
    const standalone = streams.createMixedRatingStorage('tournament');
    await ratings.updateRatingsWithStorage(players[0], players[1], false, standaloneMatch, standalone);
    const completion = { winnerId: players[0], confirmedAt: null };
    const first = await ratings.updateRatingsWithStorage(players[0], players[1], false, phaseMatch, native, completion);
    expect(await ratings.updateRatingsWithStorage(players[0], players[1], false, phaseMatch, native, completion)).toEqual(first);
    expect((await client.from('phase_rating_history').select('id').eq('match_id', phaseMatch)).data).toHaveLength(2);
    expect((await client.from('rating_history').select('id').eq('match_id', phaseMatch)).data).toHaveLength(0);
    expect((await native.getCompletedMatches(players[0])).map((match) => match.id)).toEqual([standaloneMatch, phaseMatch]);
    await ratings.rebuildRatingsForPlayersWithStorage(players, native);
    const before = await native.getHistoryByMatches([standaloneMatch, phaseMatch]);
    await ratings.rebuildRatingsForPlayersWithStorage(players, native);
    const shape = (rows: typeof before) => rows.map(({ id: _id, ...row }) => row).sort((a, b) => a.match_id.localeCompare(b.match_id) || a.player_id.localeCompare(b.player_id));
    expect(shape(await native.getHistoryByMatches([standaloneMatch, phaseMatch]))).toEqual(shape(before));
    await streaks.recomputeStreaksWithStorage(players[0], streams.mixedStreakStorage);
    await streaks.recomputeStreaksWithStorage(players[0], streams.mixedStreakStorage);
    const stored = await client.from('player_streaks').select('*').eq('player_id', players[0]).single();
    expect(stored.data).toMatchObject({ current_win_streak: 2, last_match_id: null, last_phase_match_id: phaseMatch });
    const refused = await client.rpc('streaks_replace_player_streams', { p_player_id: players[0], p_state: stored.data!, p_expected_match_ids: [standaloneMatch] });
    expect(refused.error?.code).toBe('PT409');
    expect((await client.from('player_streaks').select('*').eq('player_id', players[0]).single()).data).toEqual(stored.data);
  }, 60_000);

  async function phaseFixture(isTest = false, status: 'scheduled' | 'completed' = 'completed') {
    const owner = { season: randomUUID(), phase: randomUUID(), round: randomUUID(), match: randomUUID() };
    expect((await client.from('seasons').insert({ id: owner.season, name: 'Rating race league', format_type: 'singles', ruleset_id: ruleset, is_test_season: isTest })).error).toBeNull();
    extraSeasons.push(owner.season);
    expect((await client.from('league_phases').insert({ id: owner.phase, season_id: owner.season, name: 'Rating race phase', bracket_type: 'round_robin', ruleset_id: ruleset })).error).toBeNull();
    extraPhases.push(owner.phase);
    expect((await client.from('phase_rounds').insert({ id: owner.round, phase_id: owner.phase, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    expect((await client.from('phase_matches').insert({ id: owner.match, phase_id: owner.phase, round_id: owner.round, player_1_id: players[0], player_2_id: players[1], winner_id: status === 'completed' ? players[0] : null, status, date_played: status === 'completed' ? '2026-02-01T00:00:00Z' : null, confirmed_at: status === 'completed' ? '2026-02-01T00:00:00Z' : null })).error).toBeNull();
    return owner;
  }

  async function snapshot() {
    const values = await Promise.all([
      client.from('player_ratings').select('*').in('player_id', players).order('player_id'),
      client.from('rating_history').select('*').in('player_id', players).order('id'),
      client.from('phase_rating_history').select('*').in('player_id', players).order('id'),
    ]);
    for (const value of values) expect(value.error).toBeNull();
    return values.map((value) => value.data);
  }

  async function replace(storage: RatingStoragePort, curve: Awaited<ReturnType<typeof ratings.loadAndComputeRatingCurve>>) {
    return storage.replacePlayerCurve(players[0], curve.computed.finalState, curve.computed.history, curve.ownHistoryMatchIds, curve.expectedMatches);
  }

  it('atomically removes excluded legacy league history without weakening the countable stream fence', async () => {
    const legacyOwner = randomUUID();
    const legacyRound = randomUUID();
    const legacyMatch = randomUUID();
    try {
      await insertAsSchemaOwner('tournaments', [{ id: legacyOwner, season_id: season, name: 'Obsolete league history fixture', bracket_type: 'round_robin', ruleset_id: ruleset }]);
      expect((await client.from('rounds').insert({ id: legacyRound, tournament_id: legacyOwner, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
      expect((await client.from('matches').insert({ id: legacyMatch, tournament_id: legacyOwner, round_id: legacyRound, player_1_id: players[0], player_2_id: players[1], winner_id: players[0], status: 'completed', date_played: '2026-01-02T00:00:00Z' })).error).toBeNull();
      expect((await client.from('rating_history').insert(players.map((player_id, index) => ({
        player_id, match_id: legacyMatch, opponent_id: players[1 - index], result: index === 0 ? 'win' : 'loss',
        rating_before: 1500, rating_after: index === 0 ? 1510 : 1490, rd_before: 350, rd_after: 300, opponent_rating: 1500,
      })))).error).toBeNull();
      const native = streams.createMixedRatingStorage('phase');
      const curve = await ratings.loadAndComputeRatingCurve(players[0], { storage: native });
      expect(curve.expectedMatches?.map((match) => match.id)).not.toContain(legacyMatch);
      expect(curve.ownHistoryMatchIds).not.toContain(legacyMatch);
      const before = await snapshot();
      const malformed = await client.rpc('rating_replace_player_streams', {
        p_player_id: players[0],
        p_state: { ...curve.computed.finalState, rating: 'invalid' },
        p_history: curve.computed.history as unknown as Json,
        p_expected_history_match_ids: curve.ownHistoryMatchIds,
        p_expected_matches: curve.expectedMatches!.map((match) => ({
          kind: match.phase_id === undefined ? 'tournament' : 'phase', match_id: match.id,
          player_1_id: match.player_1_id, player_2_id: match.player_2_id, winner_id: match.winner_id,
          confirmed_at: match.confirmed_at ?? null, date_played: match.date_played, created_at: match.created_at,
        })),
      });
      expect(malformed.error?.code).toBe('22023');
      expect(await snapshot()).toEqual(before);
      await replace(native, curve);
      const remaining = await client.from('rating_history').select('player_id').eq('match_id', legacyMatch);
      expect(remaining.error).toBeNull();
      expect(remaining.data).toEqual([{ player_id: players[1] }]);
      const countable = await native.getHistoryByMatches([standaloneMatch, phaseMatch]);
      expect(countable.filter((row) => row.player_id === players[0]).map((row) => row.match_id).sort()).toEqual([standaloneMatch, phaseMatch].sort());
      await ratings.rebuildRatingsForPlayersWithStorage(players, native);
      expect((await client.from('rating_history').select('id').eq('match_id', legacyMatch)).data).toEqual([]);
    } finally {
      expect((await client.from('tournaments').delete().eq('id', legacyOwner)).error).toBeNull();
    }
  }, 60_000);

  it('exposes no obsolete unfenced rating RPC overload', async () => {
    const result = await sql("SELECT to_regprocedure('public.phase_rating_apply_match_result(uuid,jsonb)') IS NULL AND to_regprocedure('public.rating_replace_player_streams(uuid,jsonb,jsonb,uuid[])') IS NULL;");
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe('t');
  });

  it('refuses a missing completion key rather than silently defaulting the fence', async () => {
    const before = await snapshot();
    const refused = await client.rpc('phase_rating_apply_match_result', {
      p_match_id: phaseMatch,
      p_players: [],
      p_expected_completion: { winner_id: players[0] },
    });
    expect(refused.error?.code).toBe('22023');
    expect(await snapshot()).toEqual(before);
  });

  it('rejects an old finalization after waiting for a reopen/recomplete, before reusing any newer history', async () => {
    const owner = await phaseFixture();
    const native = streams.createMixedRatingStorage('phase');
    const old = { winnerId: players[0], confirmedAt: '2026-02-01T00:00:00Z' };
    const before = await snapshot();
    const writer = session();
    let pending: Promise<unknown> | undefined;
    try {
      writer.send(`BEGIN; SET LOCAL statement_timeout = '15s'; UPDATE public.phase_matches SET status = 'in_progress', winner_id = NULL, confirmed_at = NULL WHERE id = '${owner.match}' AND status = 'completed'; UPDATE public.phase_matches SET status = 'completed', winner_id = '${players[1]}', confirmed_at = '2026-02-02T00:00:00Z' WHERE id = '${owner.match}' AND status = 'in_progress'; SELECT 'held';`);
      await writer.waitFor('held');
      pending = ratings.updateRatingsWithStorage(players[0], players[1], false, owner.match, native, old).then(() => null, (error: unknown) => error);
      const until = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < until) {
        const check = await sql("SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%phase_rating_apply_match_result%' AND wait_event_type = 'Lock';");
        if (Number(check.output.trim()) > 0) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      writer.send('COMMIT;');
      expect((await writer.finish()).code).toBe(0);
      const failure = await pending;
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error('Stale completion unexpectedly succeeded');
      expect(failure.message).toContain('no longer the expected completion');
      expect(await snapshot()).toEqual(before);
      await ratings.updateRatingsWithStorage(players[1], players[0], false, owner.match, native, { winnerId: players[1], confirmedAt: '2026-02-02T00:00:00Z' });
      const newer = await snapshot();
      await expect(ratings.updateRatingsWithStorage(players[0], players[1], false, owner.match, native, old)).rejects.toThrow('no longer the expected completion');
      expect(await snapshot()).toEqual(newer);
    } finally {
      writer.send('ROLLBACK;');
      await writer.finish();
      if (pending) await pending;
    }
  }, 60_000);

  for (const change of ['test_flag', 'completion', 'winner', 'token'] as const) {
    it(`refuses a stale full replay when concurrent ${change} changes an unrated match, then succeeds after re-reading`, async () => {
      const owner = await phaseFixture(change === 'test_flag', change === 'completion' ? 'scheduled' : 'completed');
      const native = streams.createMixedRatingStorage('phase');
      const curve = await ratings.loadAndComputeRatingCurve(players[0], { storage: native });
      expect((await client.from('phase_rating_history').select('id').eq('match_id', owner.match)).data).toHaveLength(0);
      const before = await snapshot();
      const writer = session();
      try {
        const mutation = change === 'test_flag'
          ? `UPDATE public.seasons SET is_test_season = false WHERE id = '${owner.season}' AND is_test_season;`
          : change === 'completion'
            ? `UPDATE public.phase_matches SET status = 'completed', winner_id = '${players[0]}', date_played = '2026-02-01T00:00:00Z', confirmed_at = '2026-02-01T00:00:00Z' WHERE id = '${owner.match}' AND status = 'scheduled';`
            : `UPDATE public.phase_matches SET winner_id = '${change === 'winner' ? players[1] : players[0]}', confirmed_at = '2026-02-02T00:00:00Z' WHERE id = '${owner.match}' AND status = 'completed';`;
        writer.send(`BEGIN; SET LOCAL statement_timeout = '15s'; ${mutation} SELECT 'held';`);
        await writer.waitFor('held');
        await expect(replace(native, curve)).rejects.toMatchObject({ name: 'RatingCurveStaleError' });
        expect(await snapshot()).toEqual(before);
        writer.send('COMMIT;');
        expect((await writer.finish()).code).toBe(0);
        await expect(replace(native, curve)).rejects.toMatchObject({ name: 'RatingCurveStaleError' });
        expect(await snapshot()).toEqual(before);
        const fresh = await ratings.loadAndComputeRatingCurve(players[0], { storage: native });
        await replace(native, fresh);
        const stored = await client.from('phase_rating_history').select('result').eq('match_id', owner.match).eq('player_id', players[0]).single();
        expect(stored.error).toBeNull();
        expect(stored.data?.result).toBe(change === 'winner' ? 'loss' : 'win');
        await ratings.rebuildRatingsForPlayersWithStorage(players, native);
      } finally {
        writer.send('ROLLBACK;');
        await writer.finish();
      }
    }, 60_000);
  }

  for (const kind of ['phase', 'tournament'] as const) {
    it(`refuses without deadlock while a ${kind} writer holds its owner lock, then lets the writer complete and retries`, async () => {
      const owner = await phaseFixture();
      const id = kind === 'phase' ? owner.match : randomUUID();
      if (kind === 'tournament') {
        // One pairing meets once per round (matches_round_pair_unique): the fixture's standalone match sits in `round`.
        const round2 = randomUUID();
        expect((await client.from('rounds').insert({ id: round2, tournament_id: tournament, name: 'Round 2', round_number: 2, best_of: 3 })).error).toBeNull();
        expect((await client.from('matches').insert({ id, tournament_id: tournament, round_id: round2, player_1_id: players[0], player_2_id: players[1], winner_id: players[0], status: 'completed', date_played: '2026-02-01T00:00:00Z', confirmed_at: '2026-02-01T00:00:00Z' })).error).toBeNull();
      }
      const native = streams.createMixedRatingStorage('phase');
      const curve = await ratings.loadAndComputeRatingCurve(players[0], { storage: native });
      const before = await snapshot();
      const writer = session();
      try {
        const ownerLock = kind === 'phase'
          ? `SELECT public.phase__lock('${owner.phase}');`
          : `SELECT id FROM public.tournaments WHERE id = '${tournament}' FOR UPDATE;`;
        writer.send(`BEGIN; SET LOCAL statement_timeout = '15s'; ${ownerLock} SELECT 'owner-held';`);
        await writer.waitFor('owner-held');
        await expect(replace(native, curve)).rejects.toMatchObject({ name: 'RatingCurveStaleError' });
        expect(await snapshot()).toEqual(before);
        const table = kind === 'phase' ? 'phase_matches' : 'matches';
        writer.send(`UPDATE public.${table} SET winner_id = '${players[1]}', confirmed_at = '2026-02-02T00:00:00Z' WHERE id = '${id}' AND status = 'completed'; COMMIT;`);
        const done = await writer.finish();
        expect(done.errors).not.toContain('deadlock');
        expect(done.code).toBe(0);
        await expect(replace(native, curve)).rejects.toMatchObject({ name: 'RatingCurveStaleError' });
        const fresh = await ratings.loadAndComputeRatingCurve(players[0], { storage: native });
        await replace(native, fresh);
        await ratings.rebuildRatingsForPlayersWithStorage(players, native);
      } finally {
        writer.send('ROLLBACK;');
        await writer.finish();
      }
    }, 60_000);
  }
});
