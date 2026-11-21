import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import type { Phase } from '@/types/league-phase';
import type { Database } from '@/types/database';
import { insertAsSchemaOwner } from '@/test/local-schema-owner';

const optedIn = localStackOptIn('LOCAL_LEAGUE_PHASE');

describe.skipIf(!optedIn)('native phase lifecycle on the disposable local stack', () => {
  const seasonId = randomUUID();
  const rulesetId = randomUUID();
  const playerIds = Array.from({ length: 5 }, () => randomUUID());
  const leagueGroupIds = [randomUUID(), randomUUID()];
  let admin: SupabaseClient<Database>;
  let phases: typeof import('@/lib/supabase/queries/league-phases');
  let rounds: typeof import('@/lib/supabase/queries/phase-rounds');
  let groups: typeof import('@/lib/supabase/queries/phase-groups');

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const mode = await admin.from('phase_storage_state').select('mode').single();
    expect(mode.error).toBeNull();
    expect(mode.data?.mode).toBe('phase');
    expect((await admin.from('players').insert(playerIds.map((id, i) => ({ id, name: `Phase fixture ${seasonId}-${i}`, is_guest: true })))).error).toBeNull();
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: `Phase fixture ${seasonId}` })).error).toBeNull();
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Native lifecycle fixture', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('season_participants').insert(playerIds.slice(0, 4).map((player_id) => ({ season_id: seasonId, player_id })))).error).toBeNull();
    expect((await admin.from('season_groups').insert(leagueGroupIds.map((id, i) => ({ id, season_id: seasonId, name: `Fixture ${i}`, sort_order: i + 1 })))).error).toBeNull();
    expect((await admin.from('season_group_members').insert(playerIds.slice(0, 4).map((player_id, i) => ({ season_id: seasonId, group_id: leagueGroupIds[i % 2], player_id })))).error).toBeNull();
    [phases, rounds, groups] = await Promise.all([
      import('@/lib/supabase/queries/league-phases'), import('@/lib/supabase/queries/phase-rounds'), import('@/lib/supabase/queries/phase-groups'),
    ]);
  });

  afterAll(async () => {
    if (!admin) return;
    const trash = await admin.rpc('league_trash_delete', { p_season_id: seasonId, p_actor: playerIds[0], p_retention_days: 90 });
    if (trash.error) throw trash.error;
    if (!trash.data || typeof trash.data !== 'object' || Array.isArray(trash.data) || typeof trash.data.trash_id !== 'string') {
      throw new Error('League trash returned no trash id');
    }
    const id = trash.data.trash_id;
    expect((await admin.rpc('league_trash_rebuild_done', { p_trash_id: id })).error).toBeNull();
    expect((await admin.from('league_trash').update({
      deleted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      purge_after: new Date(Date.now() - 60_000).toISOString(),
    }).eq('id', id)).error).toBeNull();
    expect((await admin.rpc('league_trash_expire', { p_now: new Date().toISOString(), p_limit: 20 })).error).toBeNull();
    expect((await admin.from('players').delete().in('id', playerIds)).error).toBeNull();
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  });

  async function create(bracketType: Phase['bracket_type'] = 'single_elim'): Promise<Phase> {
    return phases.createPhase({
      season_id: seasonId, name: `Native fixture ${randomUUID()}`, bracket_type: bracketType,
      ruleset_id: rulesetId, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match',
    });
  }

  async function enroll(phaseId: string): Promise<void> {
    expect(await phases.replacePhaseEnrollment(phaseId, playerIds.slice(0, 4).map((player_id, i) => ({ player_id, seed: i + 1 })), {
      type: 'roster', source_phase_id: null, synced_at: '2026-11-17T00:00:00Z', frozen: false,
    }, null)).toBe(true);
  }

  it('reads dashboard matches, slots and rankings from the live owner without retired league rows', async () => {
    const { listDashboardPhaseMatches, listPlayerPhaseTeamSlots, listStandaloneDashboardMatches } = await import('@/lib/supabase/queries/dashboard-now');
    const { getMatchesByPlayer } = await import('@/lib/supabase/queries/matches');
    const { getTournamentsByPlayer } = await import('@/lib/supabase/queries/tournaments');
    const { getSeasonWithDetails } = await import('@/lib/supabase/queries/seasons');
    const { getNativeLeagueStandingsPreview } = await import('@/lib/stats/standings-preview');
    const { getPublicMatchesByPhaseIds } = await import('@/lib/supabase/queries/phase-matches');
    const { listSeasonPhaseRostersWithFacts, listSeasonPhaseTeamLeadsWithFacts } = await import('@/lib/supabase/queries/phase-teams');
    const { getPhaseSeasonBattleStats, getPhaseSeasonGameTotal } = await import('@/lib/supabase/queries/phase-games');
    const { decideTeamPokemonVisibility, selectAnonymousVisibleLeads } = await import('@/lib/team/visibility');
    const [player, opponent, otherPlayer, byePlayer] = playerIds;
    expect(await getSeasonWithDetails(seasonId, true)).toMatchObject({ id: seasonId, hasDraftPool: false });
    const phase = await create('swiss');
    const other = await create('swiss');
    expect((await admin.from('league_phases').update({ team_visibility: 'always_public' }).eq('id', other.id)).error).toBeNull();
    for (const id of [phase.id, other.id]) await enroll(id);
    const nativeRound = randomUUID();
    const nativeMatch = randomUUID();
    const queueMatch = randomUUID();
    const foreignMatch = randomUUID();
    const phaseGame = randomUUID();
    const standaloneId = randomUUID();
    const retiredId = randomUUID();
    const replayUrl = (id: string) => `https://replay.pokemonshowdown.com/gen9ou-${id}`;
    try {
      expect((await admin.from('phase_rounds').insert({ id: nativeRound, phase_id: phase.id,
        name: 'Dashboard fixture', round_number: 1, best_of: 1, status: 'active', bye_player_ids: [byePlayer] })).error).toBeNull();
      expect((await admin.from('phase_matches').insert([
        { id: nativeMatch, phase_id: phase.id, round_id: nativeRound, player_1_id: player, player_2_id: opponent,
          status: 'completed', winner_id: player, date_played: '2026-11-18T00:00:00Z', notes: 'private fixture note' },
        { id: queueMatch, phase_id: phase.id, round_id: nativeRound, player_1_id: player, player_2_id: otherPlayer },
        { id: foreignMatch, phase_id: phase.id, round_id: nativeRound, player_1_id: opponent, player_2_id: otherPlayer },
      ], { defaultToNull: false })).error).toBeNull();
      expect((await admin.from('phase_teams').insert([
        { phase_id: phase.id, season_id: seasonId, player_id: player, match_id: queueMatch, name: 'Exact fixture team', pokemon: [{ species: 'Ditto' }] },
        { phase_id: other.id, player_id: player, name: 'Other phase fixture team', pokemon: [{ species: 'Pikachu' }, { species: 'Eevee' }] },
        { phase_id: phase.id, season_id: seasonId, player_id: opponent, name: 'Other player fixture team' },
      ], { defaultToNull: false })).error).toBeNull();
      expect((await admin.from('phase_games').insert({
        id: phaseGame, match_id: nativeMatch, game_number: 1, winner_id: player,
        replay_url: replayUrl(phaseGame), source: 'ps_replay', parsed: true,
      })).error).toBeNull();
      expect((await admin.from('phase_battle_stats').insert({
        game_id: phaseGame, player_id: player, pokemon_name: 'Pikachu', kos_dealt: 2,
      })).error).toBeNull();
      const legacyMatchIds = [];
      for (const [id, season_id] of [[standaloneId, null], [retiredId, seasonId]] as const) {
        const round_id = randomUUID();
        const match_id = randomUUID();
        legacyMatchIds.push(match_id);
        await insertAsSchemaOwner('tournaments', [{ id, season_id, ruleset_id: rulesetId, name: 'Legacy fixture', bracket_type: 'swiss' }]);
        expect((await admin.from('tournament_participants').insert({ tournament_id: id, player_id: player })).error).toBeNull();
        expect((await admin.from('rounds').insert({ id: round_id, tournament_id: id,
          name: 'Legacy fixture round', round_number: 1, best_of: 1 })).error).toBeNull();
        expect((await admin.from('matches').insert({ id: match_id, round_id, tournament_id: id,
          player_1_id: player, player_2_id: opponent })).error).toBeNull();
        const game_id = randomUUID();
        expect((await admin.from('games').insert({
          id: game_id, match_id, game_number: 1, winner_id: player,
          replay_url: replayUrl(id), source: 'ps_replay', parsed: true,
        })).error).toBeNull();
        expect((await admin.from('battle_stats').insert({
          game_id, player_id: player, pokemon_name: season_id ? 'Ditto' : 'Pikachu', kos_dealt: 1,
        })).error).toBeNull();
      }
      const matches = await listDashboardPhaseMatches(player);
      expect(matches.map(({ id }) => id)).toEqual([nativeMatch, queueMatch]);
      expect(matches[0]).toMatchObject({ phase_id: phase.id, season_id: seasonId,
        season_name: 'Native lifecycle fixture', round_status: 'active' });
      expect(matches[0]).not.toHaveProperty('notes');
      expect(await listPlayerPhaseTeamSlots(player, [phase.id])).toEqual([{ phase_id: phase.id, match_id: queueMatch }]);
      const [standaloneMatchId, retiredMatchId] = legacyMatchIds;
      expect((await getMatchesByPlayer(player)).map(({ id }) => id)).toEqual(expect.arrayContaining([standaloneMatchId, retiredMatchId]));
      expect((await listStandaloneDashboardMatches(player)).map(({ id }) => id)).toEqual([standaloneMatchId]);
      expect((await getTournamentsByPlayer(player, { standaloneOnly: true })).map(({ id }) => id)).toEqual([standaloneId]);
      const standings = await getNativeLeagueStandingsPreview(seasonId, 1000);
      expect(standings.find(({ player_id }) => player_id === player)).toMatchObject({ wins: 1, losses: 0 });
      expect(standings.find(({ player_id }) => player_id === opponent)).toMatchObject({ wins: 0, losses: 1 });
      expect(standings.find(({ player_id }) => player_id === byePlayer)).toMatchObject({ wins: 1, losses: 0 });

      const publicMatches = await getPublicMatchesByPhaseIds([phase.id, other.id, phase.id]);
      expect(publicMatches.get(other.id)).toEqual([]);
      expect(publicMatches.get(phase.id)?.map(({ id }) => id).sort()).toEqual([nativeMatch, queueMatch, foreignMatch].sort());
      const publicResult = publicMatches.get(phase.id)?.find(({ id }) => id === nativeMatch);
      expect(publicResult).toMatchObject({ phase_id: phase.id, round_number: 1, round_status: 'active', games: [{ id: phaseGame }] });
      expect(publicResult).not.toHaveProperty('tournament_id');
      expect(publicResult).not.toHaveProperty('notes');
      const leads = await listSeasonPhaseTeamLeadsWithFacts(seasonId);
      expect(leads).toContainEqual(expect.objectContaining({ lead_species: 'Ditto', facts: {
        match_status: 'scheduled', tournament_visibility: 'hidden_until_match',
      } }));
      expect(selectAnonymousVisibleLeads(leads).map(({ lead_species }) => lead_species)).toEqual(['Pikachu']);
      expect(JSON.stringify(leads)).not.toContain('Eevee');
      const rosters = await listSeasonPhaseRostersWithFacts(seasonId, player);
      expect(rosters.map(({ pokemon }) => pokemon[0]?.species).sort()).toEqual(['Ditto', 'Pikachu']);
      expect(await listSeasonPhaseRostersWithFacts(randomUUID(), player)).toEqual([]);
      const visible = rosters.filter((team) => decideTeamPokemonVisibility(team, { viewerId: null, isAdmin: false }, team.facts));
      expect(visible.map(({ pokemon }) => pokemon[0]?.species)).toEqual(['Pikachu']);
      expect(await getPhaseSeasonBattleStats(seasonId)).toEqual([expect.objectContaining({
        pokemon_name: 'Pikachu', kos_dealt: 2, round_number: 1,
      })]);
      expect(await getPhaseSeasonBattleStats(randomUUID())).toEqual([]);

      const { getMixedProfileMatches, getMixedProfileBattleStats, getProfilePhases, getProfilePhaseParticipants } =
        await import('@/lib/supabase/queries/profile');
      const profileMatches = await getMixedProfileMatches(player);
      expect(profileMatches.map(({ id }) => id).sort()).toEqual([nativeMatch, queueMatch, standaloneMatchId].sort());
      const result = profileMatches.find(({ id }) => id === nativeMatch);
      expect(result).toMatchObject({ phase_id: phase.id, season_id: seasonId, games: [{ winner_id: player }] });
      expect(result).not.toHaveProperty('notes');
      expect(result).not.toHaveProperty('tournament_id');
      expect(await getMixedProfileBattleStats(player)).toEqual([
        { pokemon_name: 'Pikachu', kos_dealt: 1, tournament_id: standaloneId },
        { pokemon_name: 'Pikachu', kos_dealt: 2, phase_id: phase.id },
      ]);
      expect((await getProfilePhases(player)).map(({ id }) => id).sort()).toEqual([phase.id, other.id].sort());
      expect((await getProfilePhaseParticipants([phase.id])).get(phase.id)?.map(({ id }) => id).sort()).toEqual(playerIds.slice(0, 4).sort());

      const ignored = [randomUUID(), randomUUID(), randomUUID()];
      expect((await admin.from('phase_games').insert([
        { id: ignored[0], match_id: foreignMatch, game_number: 1, replay_url: replayUrl(ignored[0]), source: 'ps_replay', parsed: false },
        { id: ignored[1], match_id: foreignMatch, game_number: 2, replay_url: replayUrl(ignored[1]), source: 'manual', parsed: true },
        { id: ignored[2], match_id: foreignMatch, game_number: 3, replay_url: '', source: 'ps_replay', parsed: true },
      ])).error).toBeNull();
      expect(await getPhaseSeasonGameTotal(seasonId)).toBe(1);
      expect(await getPhaseSeasonGameTotal(randomUUID())).toBe(0);
      const { listReplayLibraryRows, listReplayLibraryPage, listReplayLibraryFacetRows } =
        await import('@/lib/supabase/queries/replay-library');
      const legacyReplays = await listReplayLibraryRows();
      expect(legacyReplays.map(({ replayUrl: url }) => url)).toEqual(expect.arrayContaining([replayUrl(standaloneId), replayUrl(retiredId)]));
      expect(legacyReplays.map(({ replayUrl: url }) => url)).not.toContain(replayUrl(phaseGame));
      const mixedReplays = await listReplayLibraryRows(undefined, 'phase');
      expect(mixedReplays.find(({ replayUrl: url }) => url === replayUrl(phaseGame))).toMatchObject({
        matchUrl: `/leagues/${seasonId}/phases/${phase.id}/matches/${nativeMatch}`,
        competitionUrl: `/leagues/${seasonId}`, tournamentName: phase.name, round: 'Dashboard fixture',
      });
      expect(mixedReplays.find(({ replayUrl: url }) => url === replayUrl(standaloneId))).toMatchObject({
        matchUrl: `/tournaments/${standaloneId}/matches/${standaloneMatchId}`,
      });
      expect(mixedReplays.some(({ replayUrl: url }) => [retiredId, ...ignored].some((id) => url === replayUrl(id)))).toBe(false);
      expect(mixedReplays.some(({ matchUrl }) => matchUrl.endsWith(foreignMatch))).toBe(false);
      const facets = await listReplayLibraryFacetRows('phase');
      expect(facets).toContainEqual({ league: 'Native lifecycle fixture', tournamentName: phase.name, round: 'Dashboard fixture' });
      const page = await listReplayLibraryPage({ page: 1_000_000, perPage: 1, ascending: false }, 'phase');
      expect(page).toMatchObject({ total: mixedReplays.length, page: mixedReplays.length });
      expect(page.rows).toHaveLength(1);
    } finally {
      expect((await admin.from('tournaments').delete().in('id', [standaloneId, retiredId])).error).toBeNull();
      expect((await admin.from('phase_teams').delete().in('phase_id', [phase.id, other.id])).error).toBeNull();
      expect((await admin.from('phase_games').delete().in('match_id', [nativeMatch, foreignMatch])).error).toBeNull();
      expect((await admin.from('phase_matches').delete().in('id', [nativeMatch, queueMatch, foreignMatch])).error).toBeNull();
      expect((await admin.from('phase_rounds').delete().eq('id', nativeRound)).error).toBeNull();
    }
  });

  it('checks native starts and cascades archive and restore only to the owning phases', async () => {
    const { isNativeSeasonStarted } = await import('@/lib/supabase/queries/season-start');
    const { updateSeason } = await import('@/lib/supabase/queries/seasons');
    const first = await create('swiss');
    const second = await create('swiss');
    const standalone = randomUUID();
    expect((await admin.from('tournaments').insert({
      id: standalone, name: 'Fixture standalone', bracket_type: 'round_robin', ruleset_id: rulesetId,
    })).error).toBeNull();
    try {
      await expect(isNativeSeasonStarted(seasonId)).resolves.toBe(false);
      expect((await admin.from('phase_rounds').insert({
        phase_id: first.id, name: 'Fixture start signal', round_number: 1, best_of: 3,
      })).error).toBeNull();
      expect((await admin.from('seasons').select('status').eq('id', seasonId).single()).data?.status).toBe('upcoming');
      await expect(isNativeSeasonStarted(seasonId)).resolves.toBe(true);

      await expect(updateSeason(seasonId, { archived: true })).resolves.toMatchObject({ archived: true });
      for (const phase of [first, second]) {
        expect(await phases.getPhaseById(phase.id)).toMatchObject({ archived: true, status: 'upcoming' });
      }
      expect((await admin.from('tournaments').select('archived').eq('id', standalone).single()).data).toEqual({ archived: false });

      await expect(updateSeason(seasonId, { archived: false })).resolves.toMatchObject({ archived: false });
      for (const phase of [first, second]) {
        expect(await phases.getPhaseById(phase.id)).toMatchObject({ archived: false, status: 'upcoming' });
      }
      expect((await admin.from('phase_rounds').select('id').eq('phase_id', first.id)).data).toHaveLength(1);
    } finally {
      expect((await admin.from('tournaments').delete().eq('id', standalone)).error).toBeNull();
    }
  });

  it('atomically deletes only the latest confirmed unplayed round and rewinds its current-round pointer', async () => {
    const phase = await create('swiss');
    const previous = await rounds.createPhaseRound({ phase_id: phase.id, name: 'Previous fixture round', round_number: 1, best_of: 1 });
    const target = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Latest fixture round', round_number: 2, best_of: 1,
      bye_player_ids: [playerIds[2]], matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const args = {
      p_season_id: seasonId, p_phase_id: phase.id, p_round_id: target.id,
      p_expected_updated_at: target.updated_at, p_confirm: true,
    };
    const other = await create('swiss');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_phase_id: other.id })).error?.message).toBe('round_not_found');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_confirm: false })).error?.message).toBe('phase_round_delete_confirm_required');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_expected_updated_at: '2020-01-01T00:00:00Z' })).error?.message).toBe('phase_round_delete_changed');
    await expect(rounds.deleteAdminPhaseRound(seasonId, phase.id, previous.id, previous.updated_at, true))
      .rejects.toMatchObject({ code: 'phase_round_delete_dependent' });
    expect((await phases.getPhaseById(phase.id))?.current_round).toBe(2);

    const deletions = await Promise.all([
      admin.rpc('phase_admin_round_delete', args),
      admin.rpc('phase_admin_round_delete', args),
    ]);
    expect(deletions.filter(result => result.error === null).map(result => result.data))
      .toEqual([{ name: target.name, round_number: 2, matches: 1 }]);
    expect(deletions.filter(result => result.error !== null).map(result => result.error?.message)).toEqual(['round_not_found']);
    expect((await rounds.getRoundsByPhase(phase.id)).map(round => round.id)).toEqual([previous.id]);
    expect((await admin.from('phase_matches').select('id').eq('round_id', target.id)).data).toEqual([]);
    expect(await phases.getPhaseById(phase.id)).toMatchObject({ current_round: 1, status: 'active' });
  });

  it('preserves game, prep, report and round rows on guarded deletion refusals', async () => {
    const phase = await create('swiss');
    const round = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Protected fixture round', round_number: 1, best_of: 1,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const match = await admin.from('phase_matches').select('id').eq('round_id', round.id).single();
    expect(match.error).toBeNull();
    if (!match.data) throw new Error('Fixture match missing');
    const matchId = match.data.id;
    const remove = () => rounds.deleteAdminPhaseRound(seasonId, phase.id, round.id, round.updated_at, true);

    expect((await admin.from('phase_games').insert({ match_id: matchId, game_number: 1 })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_results' });
    expect((await admin.from('phase_games').select('id').eq('match_id', matchId)).data).toHaveLength(1);
    expect((await admin.from('phase_games').delete().eq('match_id', matchId)).error).toBeNull();

    expect((await admin.from('phase_match_prep_teams').insert({ match_id: matchId, player_id: playerIds[0] })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_teams' });
    expect((await admin.from('phase_match_prep_teams').select('id').eq('match_id', matchId)).data).toHaveLength(1);
    expect((await admin.from('phase_match_prep_teams').delete().eq('match_id', matchId)).error).toBeNull();

    expect((await admin.from('phase_reports').insert({
      phase_id: phase.id, round_id: round.id, report_type: 'round_forecast', model_id: 'fixture',
    })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_linked' });
    expect((await admin.from('phase_reports').select('id').eq('round_id', round.id)).data).toHaveLength(1);
    expect((await admin.from('phase_matches').select('id').eq('round_id', round.id)).data).toEqual([{ id: matchId }]);
    expect(await rounds.getPhaseRoundById(round.id, phase.id)).not.toBeNull();
    expect((await phases.getPhaseById(phase.id))?.current_round).toBe(1);

    const completed = await rounds.completePhaseRound(round.id, { force: true });
    expect(completed.outcome).toBe('completed');
    if (completed.outcome !== 'completed') throw new Error('Fixture round was not completed');
    await expect(rounds.deleteAdminPhaseRound(seasonId, phase.id, round.id, completed.round.updated_at, true))
      .rejects.toMatchObject({ code: 'phase_round_delete_locked' });
  });

  async function firstGeneratedRoundPlan() {
    const phase = await create('round_robin');
    await enroll(phase.id);
    const { getSeasonGroups } = await import('@/lib/supabase/queries/season-groups');
    const [live, participants, leagueGroups] = await Promise.all([
      phases.getPhaseById(phase.id), phases.getPhaseParticipants(phase.id), getSeasonGroups(seasonId),
    ]);
    if (!live) throw new Error('Native pairing phase missing after enrollment');
    const input: Parameters<typeof rounds.writeGeneratedPhaseRound>[0] = {
      phase_id: live.id, season_id: seasonId, phase_status: live.status,
      round_id: null, name: 'Round 1', round_number: 1, best_of: 3, bye_player_ids: [],
      matches: leagueGroups.map(group => ({ player_1_id: group.player_ids[0], player_2_id: group.player_ids[1] })),
      deadline: '2030-01-01T00:00:00.000Z', expected_updated_at: live.updated_at,
      replacement_groups: leagueGroups.map((group, index) => ({
        season_group_id: group.id, name: group.name, group_number: index + 1,
        members: participants.filter(player => group.player_ids.includes(player.id))
          .map((player, seed) => ({ player_id: player.id, seed: seed + 1 })),
      })),
      inputs: {
        phase: {
          status: live.status, current_round: live.current_round, bracket_type: live.bracket_type,
          stage_spec: live.stage_spec, name: live.name, bo_overrides: live.bo_overrides, best_of_default: live.best_of_default,
        },
        season: { start_date: null, format_type: 'singles' }, rounds: [], matches: [], groups: [],
        participants: participants.map(({ id, name, seed }) => ({ id, name, seed })).sort((a, b) => a.id.localeCompare(b.id)),
        league_groups: leagueGroups.map(({ id, name, sort_order, player_ids }) => ({ id, name, sort_order, player_ids: [...player_ids].sort() })),
      },
    };

    return { input, live, leagueGroups };
  }

  it('commits a generated round and its first group mirror together, once per snapshot', async () => {
    const { input, live, leagueGroups } = await firstGeneratedRoundPlan();
    await expect(rounds.writeGeneratedPhaseRound({
      ...input, matches: [...input.matches, { player_1_id: playerIds[0], player_2_id: randomUUID() }],
    })).rejects.toMatchObject({ code: '23503' });
    expect(await groups.getGroupsByPhase(live.id)).toEqual([]);
    expect(await rounds.getRoundsByPhase(live.id)).toEqual([]);
    expect((await phases.getPhaseById(live.id))?.status).toBe('upcoming');

    const attempts = await Promise.allSettled([rounds.writeGeneratedPhaseRound(input), rounds.writeGeneratedPhaseRound(input)]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected']);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ code: 'round_status_changed', statusCode: 409 });
    }
    const saved = await rounds.getRoundsByPhase(live.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ round_number: 1, pairings_generated: true });
    expect(Date.parse(saved[0].deadline ?? '')).toBe(Date.parse(input.deadline ?? ''));
    expect((await groups.getGroupsByPhase(live.id)).map(group => group.season_group_id)).toEqual(leagueGroups.map(group => group.id));
    expect((await admin.from('phase_matches').select('id', { head: true, count: 'exact' }).eq('phase_id', live.id)).count)
      .toBe(input.matches.length);
    expect((await phases.getPhaseById(live.id))?.status).toBe('active');
  });

  it('continues a flat elimination only from settled native history and matching seeds', async () => {
    const phase = await create('single_elim');
    await enroll(phase.id);
    const earlier = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Quarterfinals', round_number: 1, best_of: 3,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const previous = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Semifinals', round_number: 2, best_of: 3,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] },
        { player_1_id: playerIds[2], player_2_id: playerIds[3] }],
    });
    expect(await rounds.completePhaseRound(previous.id, { force: true })).toMatchObject({ outcome: 'completed' });
    const { getSeasonGroups } = await import('@/lib/supabase/queries/season-groups');
    const { getNativeKitMatchFacts } = await import('@/lib/supabase/queries/phase-format-runtime');
    const [live, roster, leagueGroups, history] = await Promise.all([
      phases.getPhaseById(phase.id), phases.getPhaseParticipants(phase.id), getSeasonGroups(seasonId), rounds.getRoundsByPhase(phase.id),
    ]);
    if (!live) throw new Error('Flat elimination fixture missing');
    const input: Parameters<typeof rounds.writeGeneratedPhaseRound>[0] = {
      phase_id: live.id, season_id: seasonId, phase_status: live.status, expected_updated_at: live.updated_at,
      round_id: null, name: 'Finals', round_number: 3, best_of: 5, bye_player_ids: [], deadline: null,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[2] }],
      inputs: {
        phase: {
          status: live.status, current_round: live.current_round, bracket_type: live.bracket_type,
          stage_spec: live.stage_spec, name: live.name, bo_overrides: live.bo_overrides, best_of_default: live.best_of_default,
        },
        season: { start_date: null, format_type: 'singles' },
        rounds: history.map(({ id, round_number, status, bye_player_ids, pairings_generated, bracket_side }) =>
          ({ id, round_number, status, bye_player_ids, pairings_generated, bracket_side })).sort((a, b) => a.id.localeCompare(b.id)),
        matches: await getNativeKitMatchFacts(live.id),
        participants: roster.map(({ id, name, seed, starting_bracket }) => ({ id, name, seed, starting_bracket }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        groups: [],
        league_groups: leagueGroups.map(({ id, name, sort_order, player_ids }) => ({ id, name, sort_order, player_ids: [...player_ids].sort() })),
      },
    };
    const assertRefused = (plan = input) => expect(rounds.writeGeneratedPhaseRound(plan))
      .rejects.toMatchObject({ code: 'round_status_changed', statusCode: 409 });
    await assertRefused();
    const settle = async (roundId: string) => {
      for (const match of input.inputs.matches.filter(match => match.round_id === roundId)) {
        expect((await admin.from('phase_matches').update({ status: 'completed', winner_id: match.player_1_id })
          .eq('id', match.id)).error).toBeNull();
      }
    };
    await settle(previous.id);
    await assertRefused();
    input.inputs.matches = await getNativeKitMatchFacts(live.id);
    await assertRefused();
    await settle(earlier.id);
    input.inputs.matches = await getNativeKitMatchFacts(live.id);
    await assertRefused({ ...input, inputs: { ...input.inputs, participants: input.inputs.participants
      .map((participant, index) => index === 0 ? { ...participant, starting_bracket: 'losers' } : participant) } });
    expect((await rounds.getRoundsByPhase(phase.id)).map(round => round.id)).toEqual([earlier.id, previous.id]);
    const final = await rounds.writeGeneratedPhaseRound(input);
    expect(final).toMatchObject({ round_number: 3, name: 'Finals', best_of: 5, status: 'pending', bracket_side: null, bye_player_ids: [] });
    expect((await getNativeKitMatchFacts(live.id)).filter(match => match.round_id === final.id))
      .toEqual([expect.objectContaining({ status: 'scheduled', ...input.matches[0] })]);
    expect((await phases.getPhaseById(live.id))?.current_round).toBe(3);
  });

  it('rolls the entire batch back if its second write fails and commits only one concurrent batch', async () => {
    const { input, live, leagueGroups } = await firstGeneratedRoundPlan();
    const second = {
      ...input, round_number: 2, name: 'Round 2', deadline: '2030-01-08T00:00:00.000Z',
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    };
    await expect(rounds.writeGeneratedPhaseRoundBatch(input, [
      input, { ...second, matches: [{ player_1_id: playerIds[0], player_2_id: randomUUID() }] },
    ])).rejects.toMatchObject({ code: '23503' });
    expect(await groups.getGroupsByPhase(live.id)).toEqual([]);
    expect(await rounds.getRoundsByPhase(live.id)).toEqual([]);
    expect(await phases.getPhaseById(live.id)).toMatchObject({ status: 'upcoming', current_round: 0 });

    const attempts = await Promise.allSettled([
      rounds.writeGeneratedPhaseRoundBatch(input, [input, second]),
      rounds.writeGeneratedPhaseRoundBatch(input, [input, second]),
    ]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(attempts.find(attempt => attempt.status === 'rejected')).toMatchObject({
      reason: { code: 'round_status_changed', statusCode: 409 },
    });
    const saved = await rounds.getRoundsByPhase(live.id);
    expect(saved.map(row => [row.round_number, row.pairings_generated, Date.parse(row.deadline ?? '')])).toEqual([
      [1, true, Date.parse(input.deadline ?? '')], [2, true, Date.parse(second.deadline)],
    ]);
    expect((await groups.getGroupsByPhase(live.id)).map(group => group.season_group_id)).toEqual(leagueGroups.map(group => group.id));
    const fixtures = await admin.from('phase_matches').select('id', { head: true, count: 'exact' }).eq('phase_id', live.id);
    expect(fixtures.error).toBeNull();
    expect(fixtures.count).toBe(input.matches.length + second.matches.length);
    expect(await phases.getPhaseById(live.id)).toMatchObject({ status: 'active', current_round: 2 });
  });

  it('repairs a missing native bracket slot once and refuses to rewrite a scheduled slot with linked data', async () => {
    const phase = await create('single_elim');
    await enroll(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }, { planPhaseBracketRepair }, matchQueries] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('@/lib/league-phase/bracket-persistence'),
      import('@/lib/league-phase/bracket-repair'), import('@/lib/supabase/queries/phase-matches'),
    ]);
    const participants = await phases.getPhaseParticipants(phase.id);
    await generateEliminationBracket(phase, participants, {}, createNativeBracketPersistence());
    const original = (await matchQueries.getMatchesByPhase(phase.id)).sort((a, b) => (a.bracket_pos ?? 0) - (b.bracket_pos ?? 0));
    expect(original).toHaveLength(2);
    const [existing, missing] = original;
    expect((await admin.from('phase_matches').delete().eq('id', missing.id)).error).toBeNull();
    expect((await admin.from('phase_matches').update({
      player_1_id: existing.player_2_id, player_2_id: existing.player_1_id, notes: 'Fixture linked note',
    }).eq('id', existing.id)).error).toBeNull();
    const loadPlan = async () => {
      const [live, ownedRounds, ownedMatches] = await Promise.all([
        phases.getPhaseById(phase.id), rounds.getRoundsByPhase(phase.id), matchQueries.getMatchesByPhase(phase.id),
      ]);
      if (!live) throw new Error('Fixture phase disappeared');
      return {
        seasonId, phaseId: live.id, updatedAt: live.updated_at,
        seeds: participants.map(({ id: player_id, name, seed, starting_bracket }) => ({ player_id, name, seed, starting_bracket })),
        rounds: ownedRounds.map(({ id, round_number, bracket_side, status }) => ({ id, round_number, bracket_side, status })),
        matches: ownedMatches.map(({ id, updated_at, games }) => ({ id, updated_at, has_games: games.length > 0 })),
        slots: planPhaseBracketRepair(live, participants, ownedRounds, ownedMatches),
      };
    };
    const refused = await loadPlan();
    expect(refused.slots).toHaveLength(2);
    await expect(rounds.writePhaseBracketRepair(refused)).rejects.toMatchObject({ code: 'phase_bracket_repair_linked' });
    expect(await matchQueries.getMatchesByPhase(phase.id)).toEqual([
      expect.objectContaining({ id: existing.id, player_1_id: existing.player_2_id, notes: 'Fixture linked note' }),
    ]);
    expect((await admin.from('phase_matches').update({ notes: '' }).eq('id', existing.id)).error).toBeNull();
    await expect(rounds.writePhaseBracketRepair(refused)).rejects.toMatchObject({ code: 'phase_bracket_repair_changed' });
    const ready = await loadPlan();
    const attempts = await Promise.allSettled([rounds.writePhaseBracketRepair(ready), rounds.writePhaseBracketRepair(ready)]);
    expect(attempts).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: { slots_materialized: 1, slots_updated: 1 } },
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'phase_bracket_repair_changed' }) }),
    ]));
    const saved = await matchQueries.getMatchesByPhase(phase.id);
    expect(saved).toHaveLength(2);
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: existing.id, player_1_id: existing.player_1_id, player_2_id: existing.player_2_id }),
      expect.objectContaining({ bracket_pos: missing.bracket_pos, player_1_id: missing.player_1_id, player_2_id: missing.player_2_id }),
    ]));
  });

  it('does not mark a reset round pending when a game or a downstream result remains', async () => {
    const phase = await create('round_robin');
    await enroll(phase.id);
    const writeRound = (number: number) => rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: `Round ${number}`, round_number: number, best_of: 3,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const first = await writeRound(1);
    const second = await writeRound(2);
    const active = await rounds.updatePhaseRoundStatus(first.id, 'active', 'pending');
    const { data: matches, error } = await admin.from('phase_matches').select('id,round_id').eq('phase_id', phase.id);
    expect(error).toBeNull();
    const own = matches?.find(match => match.round_id === first.id)?.id;
    const next = matches?.find(match => match.round_id === second.id)?.id;
    if (!own || !next) throw new Error('Missing reset fixtures');
    const gameId = randomUUID();
    expect((await admin.from('phase_games').insert({
      id: gameId, match_id: own, game_number: 1, source: 'manual', winner_id: playerIds[0],
    })).error).toBeNull();
    await expect(rounds.finishPhaseRoundReset(seasonId, phase.id, active, []))
      .rejects.toMatchObject({ code: 'phase_round_reset_games_remaining', statusCode: 409 });
    expect((await rounds.getPhaseRoundById(first.id))?.status).toBe('active');
    expect((await admin.from('phase_games').delete().eq('id', gameId)).error).toBeNull();

    expect((await admin.from('phase_matches').update({ status: 'in_progress' }).eq('id', next)).error).toBeNull();
    await expect(rounds.finishPhaseRoundReset(seasonId, phase.id, active, [next]))
      .rejects.toMatchObject({ code: 'phase_round_reset_games_remaining', statusCode: 409 });
    expect((await admin.from('phase_matches').update({ status: 'scheduled' }).eq('id', next)).error).toBeNull();
    const changed = await rounds.updatePhaseRoundDeadline(first.id, '2030-01-08T00:00:00.000Z');
    await expect(rounds.finishPhaseRoundReset(seasonId, phase.id, active, [next]))
      .rejects.toMatchObject({ code: 'round_status_changed', statusCode: 409 });
    const reset = await rounds.finishPhaseRoundReset(seasonId, phase.id, changed, [next]);
    expect(reset).toMatchObject({ id: first.id, status: 'pending', best_of: 3 });
    expect(reset.deadline).toBe(changed.deadline);
    expect((await rounds.getPhaseRoundById(second.id))?.status).toBe('pending');
  });

  it('serializes manual appends and inserts without shifting an already started phase', async () => {
    const prefix = `Placement ${randomUUID()}`;
    const input = {
      season_id: seasonId, ruleset_id: rulesetId, bracket_type: 'single_elim' as const,
      best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' as const,
    };
    const [a, b] = await Promise.all([
      phases.insertAdminPhase({ ...input, name: `${prefix} A` }),
      phases.insertAdminPhase({ ...input, name: `${prefix} B` }),
    ]);
    const later = a.phase.stage_order > b.phase.stage_order ? a.phase : b.phase;
    expect(Math.abs(a.phase.stage_order - b.phase.stage_order)).toBe(1);
    expect(a.shiftedIds).toEqual([]);
    expect(b.shiftedIds).toEqual([]);
    await expect(phases.insertAdminPhase({ ...input, name: later.name.toUpperCase() }))
      .rejects.toMatchObject({ code: 'PHASE_NAME_TAKEN', statusCode: 409 });

    const beforeIds = (await phases.getPhasesBySeasonId(seasonId)).map(phase => phase.id);
    const inserted = await phases.insertAdminPhase({ ...input, name: `${prefix} Inserted` }, later.stage_order);
    expect(inserted.shiftedIds).toEqual([later.id]);
    expect(inserted.phase.stage_order).toBe(later.stage_order);
    expect((await phases.getPhaseById(later.id))?.stage_order).toBe(later.stage_order + 1);
    await expect(phases.reorderPhases(seasonId, beforeIds)).rejects.toMatchObject({ code: 'PHASE_REORDER_INCOMPLETE' });
    await phases.updatePhase(later.id, { status: 'active' }, { from: 'upcoming' });
    await expect(phases.reorderPhases(seasonId, [...beforeIds.filter(id => id !== later.id), inserted.phase.id, later.id]))
      .rejects.toMatchObject({ code: 'PHASE_REORDER_LOCKED' });
    await expect(phases.insertAdminPhase({ ...input, name: `${prefix} Refused` }, inserted.phase.stage_order))
      .rejects.toMatchObject({ code: 'PHASE_INSERT_LOCKED' });
    expect((await phases.getPhaseById(inserted.phase.id))?.stage_order).toBe(inserted.phase.stage_order);
    expect((await phases.getPhaseById(later.id))?.stage_order).toBe(later.stage_order + 1);
  });

  it('confirms rounds under the delete lock, protects dependent enrollment and keeps independent cast sessions', async () => {
    const source = await create();
    const dependent = await create();
    await enroll(source.id);
    expect(await phases.replacePhaseEnrollment(dependent.id, [{ player_id: playerIds[0], seed: 1 }], {
      type: 'standings', source_phase_id: source.id, synced_at: '2026-11-17T01:00:00Z', frozen: true,
    }, null)).toBe(true);
    await expect(phases.deleteAdminPhase(randomUUID(), source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_NOT_FOUND', statusCode: 404 });
    await expect(phases.deleteAdminPhase(seasonId, source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_DELETE_ENROLLMENT_SOURCE', statusCode: 409 });
    await phases.deleteAdminPhase(seasonId, dependent.id, false);

    const teamId = randomUUID();
    expect((await admin.from('phase_teams').insert({ id: teamId, phase_id: source.id, season_id: seasonId, player_id: playerIds[0] })).error).toBeNull();
    await expect(phases.deleteAdminPhase(seasonId, source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_DELETE_TEAMS_LINKED', statusCode: 409 });
    expect((await admin.from('phase_teams').delete().eq('id', teamId)).error).toBeNull();

    const externalSession = randomUUID();
    const ownedSession = randomUUID();
    const cast = { owner_id: playerIds[0], phase_id: source.id, season_id: seasonId };
    expect((await admin.from('cast_sessions').insert({ ...cast, id: externalSession })).error).toBeNull();
    expect((await admin.from('phase_cast_sessions').insert({ ...cast, id: ownedSession })).error).toBeNull();
    try {
      await rounds.createPhaseRound({ phase_id: source.id, name: 'Native delete round', round_number: 1, best_of: 3 });
      await expect(phases.deleteAdminPhase(seasonId, source.id, false))
        .rejects.toMatchObject({ code: 'PHASE_DELETE_CONFIRM_REQUIRED', statusCode: 400 });
      expect((await admin.from('phase_cast_sessions').select('id').eq('id', ownedSession).single()).data).toEqual({ id: ownedSession });
      await expect(phases.deleteAdminPhase(seasonId, source.id, true))
        .resolves.toEqual({ name: source.name, playerIds: [...playerIds.slice(0, 4)].sort() });
      expect(await phases.getPhaseById(source.id)).toBeNull();
      expect((await admin.from('phase_cast_sessions').select('id').eq('id', ownedSession).maybeSingle()).data).toBeNull();
      expect((await admin.from('cast_sessions').select('phase_id,phase_match_id').eq('id', externalSession).single()).data)
        .toEqual({ phase_id: null, phase_match_id: null });
    } finally {
      expect((await admin.from('cast_sessions').delete().eq('id', externalSession)).error).toBeNull();
    }
  });

  it('replaces native groups atomically and freezes them once the first round exists', async () => {
    const ungrouped = randomUUID();
    expect((await admin.from('seasons').insert({
      id: ungrouped, name: 'Ungrouped fixture', format_type: 'singles', ruleset_id: rulesetId,
    })).error).toBeNull();
    let phaseId: string | undefined;
    try {
      const phase = await phases.createPhase({
        season_id: ungrouped, name: 'Native group fixture', bracket_type: 'round_robin',
        ruleset_id: rulesetId, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match',
      });
      phaseId = phase.id;
      await enroll(phaseId);
      const snapshot = playerIds.slice(0, 4).map((player_id, i) => ({ player_id, seed: i + 1 }));
      const plan = [
        { name: 'Group A', members: [playerIds[0], playerIds[3]] },
        { name: 'Group B', members: [playerIds[1], playerIds[2]] },
      ];
      await groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, snapshot);
      const saved = await groups.getGroupsByPhase(phaseId);
      expect(saved.map(({ name, members }) => ({ name, members: members.map(m => m.player_id) }))).toEqual(plan);
      await phases.updatePhaseParticipantSeeds(phaseId, [{ player_id: playerIds[0], seed: 5 }]);
      await expect(groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, snapshot))
        .rejects.toMatchObject({ code: 'GROUP_SLOT_CHANGED', statusCode: 409 });
      expect((await groups.getGroupsByPhase(phaseId)).map(group => group.id)).toEqual(saved.map(group => group.id));
      await groups.replaceAdminPhaseGroups(ungrouped, phaseId, [], []);
      expect(await groups.getGroupsByPhase(phaseId)).toEqual([]);
      const current = snapshot.map(row => row.player_id === playerIds[0] ? { ...row, seed: 5 } : row);
      await groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, current);
      const before = await groups.getGroupsByPhase(phaseId);
      await rounds.createPhaseRound({ phase_id: phaseId, name: 'Round 1', round_number: 1, best_of: 3 });
      await expect(groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, current))
        .rejects.toMatchObject({ code: 'PHASE_GROUPS_ROUNDS_EXIST', statusCode: 409 });
      await expect(groups.replaceAdminPhaseGroups(ungrouped, phaseId, [], []))
        .rejects.toMatchObject({ code: 'PHASE_GROUPS_ROUNDS_EXIST', statusCode: 409 });
      await expect(groups.movePhaseGroupMember(phaseId, before[0].id, before[1].id, playerIds[0], 3))
        .rejects.toMatchObject({ code: 'PHASE_GROUPS_ROUNDS_EXIST', statusCode: 409 });
      expect(await groups.getGroupsByPhase(phaseId)).toEqual(before);
    } finally {
      if (phaseId) await phases.deleteAdminPhase(ungrouped, phaseId, true);
      expect((await admin.from('seasons').delete().eq('id', ungrouped)).error).toBeNull();
    }
  });

  it('refuses changes to generated elimination seats, keeps same-roster sync and allows substitution', async () => {
    const phase = await create('single_elim');
    await enroll(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('../bracket-persistence'),
    ]);
    const current = (await phases.getPhaseById(phase.id))!;
    const roster = await phases.getPhaseParticipants(phase.id);
    await generateEliminationBracket(current, roster, {}, createNativeBracketPersistence(undefined, {
      updatedAt: current.updated_at,
      seeds: roster.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
    }));
    const before = (await phases.getPhaseById(phase.id))!.enrollment_source!;
    const source = { ...before, synced_at: '2026-11-17T00:01:00Z' };
    const same = playerIds.slice(0, 4).reverse().map((player_id, i) => ({ player_id, seed: i + 1 }));
    const changed = same.map((row, i) => i === 0 ? { ...row, player_id: playerIds[4] } : row);
    const locked = { code: 'PHASE_ELIMINATION_ROSTER_LOCKED', statusCode: 409 };
    await expect(phases.addPhaseParticipant(phase.id, playerIds[4])).rejects.toMatchObject(locked);
    await expect(phases.removePhaseParticipant(phase.id, playerIds[0])).rejects.toMatchObject(locked);
    await expect(phases.replacePhaseEnrollment(phase.id, changed, source, before.synced_at, true)).rejects.toMatchObject(locked);
    expect((await phases.getPhaseById(phase.id))?.enrollment_source).toEqual(before);
    expect(await phases.getPhaseParticipants(phase.id)).toEqual(roster);
    expect(await phases.replacePhaseEnrollment(phase.id, same, source, before.synced_at, true)).toBe(true);
    expect((await phases.getPhaseParticipants(phase.id)).map(({ id, seed }) => ({ player_id: id, seed }))).toEqual(same);
    await expect(phases.swapPhaseParticipant(phase.id, playerIds[0], playerIds[4])).resolves.toMatchObject({ swapped: true });
  });

  it('serializes enrollment CAS and changes seeds atomically without tournament rows', async () => {
    const phase = await create();
    const attempts = await Promise.all([0, 1].map((i) => phases.replacePhaseEnrollment(phase.id,
      [{ player_id: playerIds[i], seed: 1 }], {
        type: 'roster', source_phase_id: null, synced_at: `2026-11-17T00:00:0${i}Z`, frozen: false,
      }, null)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(await phases.getPhaseParticipants(phase.id)).toHaveLength(1);
    const untouched = await admin.from('tournaments').select('id').eq('id', phase.id);
    expect(untouched.error).toBeNull();
    expect(untouched.data).toEqual([]);

    const seeded = await create();
    await enroll(seeded.id);
    await phases.updatePhaseParticipantSeeds(seeded.id, [
      { player_id: playerIds[0], seed: 2 }, { player_id: playerIds[1], seed: 1 },
    ]);
    const participants = await phases.getPhaseParticipants(seeded.id);
    expect(participants.find((p) => p.id === playerIds[0])?.seed).toBe(2);
    expect(participants.find((p) => p.id === playerIds[1])?.seed).toBe(1);
  });

  it('keeps retained group slots across enrollment sync and refuses removal after scheduling', async () => {
    const phase = await create('double_elim');
    await enroll(phase.id);
    const [group] = await groups.createPhaseGroupBatch([{
      phase_id: phase.id, season_id: seasonId, season_group_id: null, name: 'Example group', group_number: 1,
    }]);
    await groups.addPhaseGroupMembersBatch(playerIds.slice(0, 3).map((player_id, index) => ({
      phase_id: phase.id, group_id: group.id, player_id, seed: index + 10,
    })));
    const nextSync = '2026-11-17T00:01:00Z';
    const entries = [
      { player_id: playerIds[0], seed: 2 },
      { player_id: playerIds[1], seed: 1 },
    ];
    const slots = () => groups.getGroupMembershipsInPhase(phase.id, playerIds);
    expect(await phases.replacePhaseEnrollment(phase.id, entries, {
      type: 'roster', source_phase_id: null, synced_at: nextSync, frozen: false,
    }, '2026-11-17T00:00:00Z')).toBe(true);
    expect(await slots()).toEqual(expect.arrayContaining([
      expect.objectContaining({ player_id: playerIds[0], group_id: group.id, seed: 10 }),
      expect.objectContaining({ player_id: playerIds[1], group_id: group.id, seed: 11 }),
    ]));
    expect(await slots()).toHaveLength(2);
    expect((await phases.getPhaseParticipants(phase.id)).map(player => [player.id, player.seed]))
      .toEqual([[playerIds[1], 1], [playerIds[0], 2]]);

    await rounds.createPhaseRound({ phase_id: phase.id, name: 'Finals', round_number: 1, best_of: 3 });
    const scheduledSlots = await slots();
    const scheduled = await phases.getPhaseById(phase.id);
    await phases.updatePhaseParticipantSeeds(phase.id, [{ player_id: playerIds[0], seed: 2, starting_bracket: 'losers' }]);
    const forcedSync = '2026-11-17T00:02:00Z';
    expect(await phases.replacePhaseEnrollment(phase.id, entries, {
      type: 'roster', source_phase_id: null, synced_at: forcedSync, frozen: false,
    }, nextSync, true)).toBe(true);
    expect((await phases.getPhaseParticipants(phase.id)).find(player => player.id === playerIds[0]))
      .toMatchObject({ seed: 2, starting_bracket: 'losers' });
    await expect(phases.removePhaseParticipant(phase.id, playerIds[0])).rejects.toMatchObject({
      code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409,
    });
    await expect(phases.replacePhaseEnrollment(phase.id, entries.slice(1), {
      type: 'roster', source_phase_id: null, synced_at: '2026-11-17T00:03:00Z', frozen: false,
    }, forcedSync, true)).rejects.toMatchObject({ code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409 });
    expect(await slots()).toEqual(scheduledSlots);
    expect((await phases.getPhaseById(phase.id))?.enrollment_source)
      .toMatchObject({ ...scheduled?.enrollment_source, synced_at: forcedSync, frozen: true });
    expect(await phases.getPhaseParticipants(phase.id)).toHaveLength(2);
  });

  it('admits one competing first round and one competing status move', async () => {
    const phase = await create();
    await enroll(phase.id);
    const writes = await Promise.allSettled([0, 1].map(() => rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Round 1', round_number: 1, best_of: 3,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    })));
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = writes.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason instanceof rounds.RoundAlreadyWrittenError).toBe(true);
    expect(await rounds.getRoundsByPhase(phase.id)).toHaveLength(1);
    expect((await phases.getPhaseById(phase.id))?.status).toBe('active');

    const racing = await create();
    const changes = await Promise.allSettled([
      phases.updatePhase(racing.id, { status: 'active' }, { from: 'upcoming' }),
      phases.updatePhase(racing.id, { status: 'completed' }, { from: 'upcoming' }),
    ]);
    expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(changes.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'tournament_status_changed' } });
  });

  it('creates an empty round without starting the phase or advancing its counter', async () => {
    const phase = await create();
    await enroll(phase.id);
    const round = await rounds.createPhaseRound({ phase_id: phase.id, name: 'Finals', round_number: 1, best_of: 3 });
    expect(round.status).toBe('pending');
    expect((await phases.getPhaseById(phase.id))).toMatchObject({
      status: 'upcoming', current_round: 0, enrollment_source: { frozen: false },
    });
  });

  it('rejects a stale league-group mirror before the first round and cascades a substitute slot', async () => {
    const phase = await create('round_robin');
    await enroll(phase.id);
    const created = await groups.createPhaseGroupBatch(leagueGroupIds.map((season_group_id, i) => ({
      phase_id: phase.id, season_id: seasonId, season_group_id, name: `Native ${i}`, group_number: i + 1,
    })));
    await groups.addPhaseGroupMembersBatch(playerIds.slice(0, 3).map((player_id, i) => ({
      phase_id: phase.id, group_id: created[i % 2].id, player_id, seed: i + 1,
    })));
    const write = () => rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Round 1', round_number: 1, best_of: 3, matches: [],
    });
    await expect(write()).rejects.toMatchObject({ code: 'PHASE_GROUPS_STALE' });
    await groups.addPhaseGroupMember(phase.id, created[1].id, playerIds[3], 4);
    await write();
    await phases.swapPhaseParticipant(phase.id, playerIds[0], playerIds[4]);
    const moved = await groups.getGroupMembershipsInPhase(phase.id, [playerIds[0], playerIds[4]]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ player_id: playerIds[4], group_id: created[0].id });
  });

  it('refuses a bracket planned from stale settings or seeds before creating rounds', async () => {
    const phase = await create();
    await enroll(phase.id);
    const snapshot = (await phases.getPhaseById(phase.id))!;
    const participants = await phases.getPhaseParticipants(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('../bracket-persistence'),
    ]);
    const planned = (updatedAt: string, roster = participants) => createNativeBracketPersistence(undefined, {
      updatedAt, seeds: roster.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
    });
    await phases.updatePhase(phase.id, { best_of_default: 5 }, { from: 'upcoming' });
    await expect(generateEliminationBracket(snapshot, participants, {}, planned(snapshot.updated_at)))
      .rejects.toMatchObject({ code: 'phase_bracket_inputs_changed', statusCode: 409 });

    await phases.updatePhaseParticipantSeeds(phase.id, [{ player_id: playerIds[0], seed: 5 }]);
    const current = (await phases.getPhaseById(phase.id))!;
    await expect(generateEliminationBracket(current, participants, {}, planned(current.updated_at)))
      .rejects.toMatchObject({ code: 'phase_bracket_inputs_changed', statusCode: 409 });
    expect(await rounds.getRoundsByPhase(phase.id)).toEqual([]);
    const roster = await phases.getPhaseParticipants(phase.id);
    await expect(generateEliminationBracket(current, roster, {}, planned(current.updated_at, roster)))
      .resolves.toMatchObject({ rounds_created: 2, matches_materialized: 2 });
    expect((await rounds.getRoundsByPhase(phase.id)).every(round => round.best_of === 5)).toBe(true);
  });

  it('commits either the whole native bracket or the competing completion', async () => {
    const phase = await create();
    await enroll(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('../bracket-persistence'),
    ]);
    const storage = createNativeBracketPersistence({
      getMatches: async () => { throw new Error('Fresh bracket must not load results'); },
      getMatch: async () => { throw new Error('Fresh bracket must not load results'); },
      resetMatch: async () => { throw new Error('Fresh bracket must not reset results'); },
    });
    const participants = await phases.getPhaseParticipants(phase.id);
    const attempts = await Promise.allSettled([
      generateEliminationBracket(phase, participants, {}, storage),
      phases.updatePhase(phase.id, { status: 'completed' }, { from: 'upcoming' }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const finalPhase = await phases.getPhaseById(phase.id);
    const writtenRounds = await rounds.getRoundsByPhase(phase.id);
    const matches = await admin.from('phase_matches').select('id').eq('phase_id', phase.id);
    expect(matches.error).toBeNull();
    expect(writtenRounds).toHaveLength(finalPhase?.status === 'active' ? 2 : 0);
    expect(matches.data).toHaveLength(finalPhase?.status === 'active' ? 2 : 0);
  });
});
