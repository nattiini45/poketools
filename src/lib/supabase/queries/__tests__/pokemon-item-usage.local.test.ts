import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import type { Database } from '@/types/database';
import { insertAsSchemaOwner } from '@/test/local-schema-owner';

const optIn = localStackOptIn('LOCAL_LEAGUE_PHASE');

describe.skipIf(!optIn)('species item usage on the disposable phase stack', () => {
  const [player, opponent, testPlayer] = Array.from({ length: 3 }, randomUUID);
  const [league, testLeague] = Array.from({ length: 2 }, randomUUID);
  const [phase, testPhase] = Array.from({ length: 2 }, randomUUID);
  const [round, testRound] = Array.from({ length: 2 }, randomUUID);
  const [completed, scheduled, testOpponentMatch, testLeagueMatch] = Array.from({ length: 4 }, randomUUID);
  const [standalone, retired] = Array.from({ length: 2 }, randomUUID);
  const [standaloneMatch, legacyTestMatch, retiredMatch] = Array.from({ length: 3 }, randomUUID);
  const ruleset = randomUUID();
  const species = `Synthetic item usage ${randomUUID()}`;
  const pokemon = (...items: string[]) => items.map(item => ({ species, item }));
  let admin: SupabaseClient<Database> | undefined;

  async function run<T>(operation: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    const { data, error } = await operation;
    if (error) throw error;
    return data;
  }

  afterAll(async () => {
    if (!admin) return;
    await run(admin.from('matches').delete().in('id', [standaloneMatch, legacyTestMatch, retiredMatch]));
    await run(admin.from('teams').delete().eq('player_id', player));
    await run(admin.from('phase_matches').delete().in('id', [completed, scheduled, testOpponentMatch, testLeagueMatch]));
    await run(admin.from('phase_teams').delete().in('phase_id', [phase, testPhase]));
    await run(admin.from('phase_rounds').delete().in('id', [round, testRound]));
    await run(admin.from('league_phases').delete().in('id', [phase, testPhase]));
    await run(admin.from('tournaments').delete().in('id', [standalone, retired]));
    await run(admin.from('seasons').delete().in('id', [league, testLeague]));
    await run(admin.from('players').delete().in('id', [player, opponent, testPlayer]));
    expect((await deleteLocalRuleset(admin, ruleset)).error).toBeNull();
  });

  it('counts completed public rosters from the current owner before limiting rows', async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(await run(client.from('phase_storage_state').select('mode').single())).toEqual({ mode: 'phase' });
    admin = client;

    expect((await insertLocalRuleset(client, { id: ruleset, name: species })).error).toBeNull();
    await run(client.from('players').insert([player, opponent, testPlayer].map((id, i) => ({
      id, name: `Item usage fixture ${league}-${i}`, is_guest: true, is_test_account: id === testPlayer,
    }))));
    await run(client.from('seasons').insert([league, testLeague].map(id => ({
      id, name: species, format_type: 'singles' as const, ruleset_id: ruleset, is_test_season: id === testLeague,
    }))));
    await run(client.from('league_phases').insert([
      { id: phase, season_id: league, name: 'Public fixture phase', bracket_type: 'swiss', ruleset_id: ruleset },
      { id: testPhase, season_id: testLeague, name: 'Test fixture phase', bracket_type: 'swiss', ruleset_id: ruleset },
    ]));
    await run(client.from('phase_rounds').insert([
      { id: round, phase_id: phase, name: 'Round 1', round_number: 1, best_of: 1 },
      { id: testRound, phase_id: testPhase, name: 'Round 1', round_number: 1, best_of: 1 },
    ]));
    await run(client.from('phase_matches').insert([
      { id: completed, phase_id: phase, round_id: round, player_1_id: player, player_2_id: opponent, status: 'completed' },
      { id: scheduled, phase_id: phase, round_id: round, player_1_id: player, player_2_id: opponent, status: 'scheduled' },
      { id: testOpponentMatch, phase_id: phase, round_id: round, player_1_id: player, player_2_id: testPlayer, status: 'completed' },
      { id: testLeagueMatch, phase_id: testPhase, round_id: testRound, player_1_id: player, player_2_id: opponent, status: 'completed' },
    ]));
    await run(client.from('phase_teams').insert([
      { phase_id: phase, player_id: player, match_id: completed, pokemon: [
        ...pokemon('Sitrus Berry', 'Sitrus Berry', 'Leftovers', ''),
        { species }, { species, item: null }, { species: 'Other species', item: 'Ignored' }, null,
      ] },
      { phase_id: phase, player_id: opponent, match_id: completed, pokemon: pokemon('Air Balloon') },
      { phase_id: phase, player_id: player, match_id: scheduled, pokemon: pokemon('Scheduled') },
      { phase_id: phase, player_id: player, match_id: null, pokemon: pokemon('Unlinked') },
      { phase_id: phase, player_id: player, match_id: testOpponentMatch, pokemon: pokemon('Test opponent') },
      { phase_id: testPhase, player_id: player, match_id: testLeagueMatch, pokemon: pokemon('Test league') },
    ]));
    await insertAsSchemaOwner('tournaments', [
      { id: standalone, season_id: null, name: species, bracket_type: 'swiss', ruleset_id: ruleset },
      { id: retired, season_id: league, name: species, bracket_type: 'swiss', ruleset_id: ruleset },
    ]);
    for (const [tournament_id, matches] of [
      [standalone, [{ id: standaloneMatch, player_2_id: opponent }, { id: legacyTestMatch, player_2_id: testPlayer }]],
      [retired, [{ id: retiredMatch, player_2_id: opponent }]],
    ] as const) {
      const round_id = randomUUID();
      await run(client.from('rounds').insert({ id: round_id, tournament_id, name: 'Round 1', round_number: 1, best_of: 1 }));
      await run(client.from('matches').insert(matches.map(match => ({
        ...match, tournament_id, round_id, player_1_id: player, winner_id: player, status: 'completed' as const,
      }))));
    }
    await run(client.from('teams').insert([
      { player_id: player, match_id: standaloneMatch, pokemon: pokemon('Leftovers') },
      { player_id: player, match_id: legacyTestMatch, pokemon: pokemon('Legacy test opponent') },
      { player_id: player, match_id: retiredMatch, pokemon: pokemon('Retired legacy stage') },
    ]));

    const usage = (args: Omit<Database['public']['Functions']['get_item_usage_for_pokemon_phase_storage']['Args'], 'p_species'>) =>
      run(client.rpc('get_item_usage_for_pokemon_phase_storage', { ...args, p_species: species }));

    expect(await usage({ p_scope_type: 'league', p_scope_id: league, p_limit: 3 })).toEqual([
      { item: 'Sitrus Berry', uses: 2, total_sets: 5 },
      { item: 'Air Balloon', uses: 1, total_sets: 5 },
      { item: 'Leftovers', uses: 1, total_sets: 5 },
    ]);
    expect(await usage({ p_scope_type: 'league', p_scope_id: testLeague })).toEqual([
      { item: 'Test league', uses: 1, total_sets: 1 },
    ]);
    expect(await usage({ p_scope_type: 'all_time' })).toEqual([
      { item: 'Leftovers', uses: 2, total_sets: 5 },
      { item: 'Sitrus Berry', uses: 2, total_sets: 5 },
      { item: 'Air Balloon', uses: 1, total_sets: 5 },
    ]);
    expect(await usage({ p_scope_type: 'all_time', p_player_id: player })).toEqual([
      { item: 'Leftovers', uses: 2, total_sets: 4 },
      { item: 'Sitrus Berry', uses: 2, total_sets: 4 },
    ]);
  }, 30_000);
});
