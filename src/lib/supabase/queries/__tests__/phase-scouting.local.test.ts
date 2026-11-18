import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_SCOUTING');

describe.skipIf(!optedIn)('native scouting claims on the disposable database', () => {
  const [rulesetId, seasonId, phaseId, roundId, deniedMatch, raceMatch, firstMatch, playerId, opponentId] =
    Array.from({ length: 9 }, () => randomUUID());
  let admin: SupabaseClient<Database>;

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    assertLoopbackUrl(url, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(url, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await admin.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: 'Scouting fixture' })).error).toBeNull();
    expect((await admin.from('players').insert([playerId, opponentId].map(id => ({
      id, name: `Fixture ${id}`, is_guest: true,
    })))).error).toBeNull();
    expect((await admin.from('seasons').insert({
      id: seasonId, name: 'Scouting fixture', format_type: 'singles', ruleset_id: rulesetId,
    })).error).toBeNull();
    expect((await admin.from('league_phases').insert({
      id: phaseId, season_id: seasonId, name: 'Scouting phase', bracket_type: 'round_robin', ruleset_id: rulesetId,
    })).error).toBeNull();
    expect((await admin.from('phase_participants').insert([playerId, opponentId].map(id => ({
      phase_id: phaseId, player_id: id,
    })))).error).toBeNull();
    expect((await admin.from('phase_rounds').insert({
      id: roundId, phase_id: phaseId, name: 'Round 1', round_number: 1, best_of: 3,
    })).error).toBeNull();
    expect((await admin.from('phase_matches').insert([deniedMatch, raceMatch, firstMatch].map(id => ({
      id, phase_id: phaseId, round_id: roundId, player_1_id: playerId, player_2_id: opponentId, status: 'scheduled' as const,
    })))).error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    expect((await admin.from('ai_generations').delete().eq('player_id', playerId)).error).toBeNull();
    expect((await admin.from('phase_matches').delete().eq('phase_id', phaseId)).error).toBeNull();
    expect((await admin.from('league_phases').delete().eq('id', phaseId)).error).toBeNull();
    expect((await admin.from('seasons').delete().eq('id', seasonId)).error).toBeNull();
    expect((await admin.from('players').delete().in('id', [playerId, opponentId])).error).toBeNull();
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  }, 60_000);

  const claim = (matchId: string, limit: number, expectedId?: string) => admin.rpc('phase_scouting_claim', {
    p_phase_id: phaseId, p_match_id: matchId, p_player_id: playerId, p_model_id: 'new-model',
    p_has_user_team: true, p_daily_limit: limit,
    ...(expectedId && { p_expected_id: expectedId, p_expected_status: 'completed' }),
  });

  async function completedReport(matchId: string) {
    const { data, error } = await admin.from('phase_match_prep_analyses').insert({
      match_id: matchId, player_id: playerId, model_id: 'old-model', status: 'completed',
      analysis: { opponent_profile: 'Synthetic scouting report' },
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function charges() {
    const { error, count } = await admin.from('ai_generations').select('id', { count: 'exact', head: true })
      .eq('player_id', playerId).eq('endpoint', 'match-prep-analysis');
    if (error) throw error;
    if (count === null) throw new Error('Missing scouting generation count');
    return count;
  }

  it('returns a zero-quota refusal without mutating the completed report or charging', async () => {
    const old = await completedReport(deniedMatch);
    const before = await charges();
    const refused = await claim(deniedMatch, 0, old.id);
    expect(refused.error).toBeNull();
    expect(refused.data).toEqual({ kind: 'limited', limit: 0 });
    const stored = await admin.from('phase_match_prep_analyses').select().eq('match_id', deniedMatch).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toEqual(old);
    expect(await charges()).toBe(before);
  });

  it.each([true, false])('charges exactly once for concurrent claims (replacing=%s)', async replacing => {
    const matchId = replacing ? raceMatch : firstMatch;
    const old = replacing ? await completedReport(matchId) : null;
    const before = await charges();
    const results = await Promise.all([claim(matchId, 10, old?.id), claim(matchId, 10, old?.id)]);
    for (const result of results) expect(result.error).toBeNull();
    const stored = await admin.from('phase_match_prep_analyses').select().eq('match_id', matchId).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ status: 'pending', model_id: 'new-model', player_id: playerId });
    expect(stored.data?.id).not.toBe(old?.id);
    expect(results.map(result => result.data)).toEqual(expect.arrayContaining([
      { kind: 'lost' },
      expect.objectContaining({ kind: 'claimed', artifact: expect.objectContaining({ id: stored.data?.id }) }),
    ]));
    expect(await charges()).toBe(before + 1);
  });
});
