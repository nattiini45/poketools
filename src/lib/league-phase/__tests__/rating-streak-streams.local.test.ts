import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_RATING_STREAMS');

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
    const first = await ratings.updateRatingsWithStorage(players[0], players[1], false, phaseMatch, native);
    expect(await ratings.updateRatingsWithStorage(players[0], players[1], false, phaseMatch, native)).toEqual(first);
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
});
