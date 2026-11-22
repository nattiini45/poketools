import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('next/cache', async () => (await import('./fake-next-cache')).fakeNextCache.module);

const queries = vi.hoisted(() => ({
  getPhaseWithDetails: vi.fn(),
  getPhasesBySeasonIds: vi.fn(),
  getRoundsByPhase: vi.fn(),
  getMatchesByPhase: vi.fn(),
  getPhaseHeadToHead: vi.fn(),
  getPhaseMatchById: vi.fn(),
  getPhaseParticipants: vi.fn(),
  getGroupsByPhase: vi.fn(),
  getPhaseReports: vi.fn(),
  getNativeLeagueStandingsPreview: vi.fn(),
}));

vi.mock('@/lib/stats/standings-preview', () => ({ getNativeLeagueStandingsPreview: queries.getNativeLeagueStandingsPreview }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhaseWithDetails: queries.getPhaseWithDetails,
  getPhasesBySeasonIds: queries.getPhasesBySeasonIds,
  getPhaseParticipants: queries.getPhaseParticipants,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: queries.getRoundsByPhase }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({
  getMatchesByPhase: queries.getMatchesByPhase,
  getPhaseHeadToHead: queries.getPhaseHeadToHead,
  getPhaseMatchById: queries.getPhaseMatchById,
}));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: queries.getGroupsByPhase }));
vi.mock('@/lib/supabase/queries/phase-reports', () => ({ getPhaseReports: queries.getPhaseReports }));

import { expirePhaseReads, expirePublicTags, publicTags } from '@/lib/revalidation';
import { phasePublicReads } from '../phase-public-reads';
import { fakeNextCache } from './fake-next-cache';

const TIME = '2026-10-24T10:00:00Z';
const PHASE = {
  id: 'p1', season_id: 's1', name: 'Finals', description: '', season_name: 'Sample league',
  season_format_type: 'custom', bracket_type: 'swiss', ruleset_id: 'rs1', ruleset_name: 'Sample rules',
  best_of_default: 3, bo_overrides: {}, is_doubles: false, team_visibility: 'hidden_until_match',
  status: 'active', current_round: 1, stage_order: 0, advancement_rule: null, archived: false, legacy: false,
  bracket_reset_enabled: true, third_place_enabled: false, format_stage_key: 'finals', format_group: 0,
  participant_count: 2, created_at: TIME, updated_at: TIME,
  stage_spec: { internal: true }, enrollment_source: { synced_at: TIME }, unexpected_phase_column: true,
};
const ROUND = {
  id: 'r1', phase_id: 'p1', name: 'Round 1', round_number: 1, best_of: 3, status: 'active',
  pairings_generated: true, deadline: null, bracket_side: null, bye_player_ids: ['u3'],
  created_at: TIME, updated_at: TIME,
};
const MATCH = {
  id: 'm1', phase_id: 'p1', round_id: 'r1', player_1_id: 'u1', player_2_id: 'u2', winner_id: 'u1',
  status: 'completed', date_played: TIME, scheduled_at: null, social_image_url: null,
  bracket_side: null, bracket_pos: null, created_at: TIME, updated_at: TIME,
  player_1_name: 'Sample One', player_2_name: 'Sample Two', player_1_avatar_url: null, player_2_avatar_url: null,
  winner_name: 'Sample One', round_status: 'active', round_number: 1,
  games: [{ id: 'g1', game_number: 1, winner_id: 'u1', replay_url: '', source: 'manual', stats_locked: false, raw_log: 'private' }],
  notes: 'private', submitter_id: 'u2', confirmed_at: TIME, auto_confirm_at: TIME, tournament_id: 'not-a-tournament',
};
const PARTICIPANT = {
  id: 'u1', name: 'Sample One', avatar_url: null, seed: 1, starting_bracket: 'winners',
  discord_id: 'private', auth_user_id: 'private', is_admin: true, is_test_account: true, ban_reason: 'private',
};
const GROUP = {
  id: 'g1', season_id: 's1', phase_id: 'p1', name: 'Group 1', group_number: 1, season_group_id: null,
  created_at: TIME, updated_at: TIME,
  members: [{ player_id: 'u1', player_name: 'Sample One', seed: 1, gym_type: null, discord_id: 'private' }],
};
const REPORT = {
  id: 'rp1', phase_id: 'p1', round_id: 'r1', report_type: 'round_recap', content: { headline: 'Final score' },
  status: 'completed', created_at: TIME, updated_at: TIME, error: 'private', model_id: 'private', prompt_tokens: 5,
  completion_tokens: 12, generation_time_ms: 20,
};

beforeEach(() => {
  fakeNextCache.reset();
  vi.resetAllMocks();
  queries.getPhaseWithDetails.mockResolvedValue(PHASE);
  queries.getPhasesBySeasonIds.mockImplementation(async (ids: string[]) =>
    new Map(ids.map(id => [id, id === PHASE.season_id ? [PHASE] : []])),
  );
  queries.getRoundsByPhase.mockResolvedValue([ROUND]);
  queries.getMatchesByPhase.mockResolvedValue([MATCH]);
  queries.getPhaseHeadToHead.mockResolvedValue([MATCH]);
  queries.getPhaseMatchById.mockResolvedValue(MATCH);
  queries.getPhaseParticipants.mockResolvedValue([PARTICIPANT]);
  queries.getGroupsByPhase.mockResolvedValue([GROUP]);
  queries.getPhaseReports.mockResolvedValue([REPORT, { ...REPORT, id: 'failed', status: 'failed' }]);
});

it('shares the pair cache entry across seat order and expires it on a phase write', async () => {
  const expected = [{ id: 'm1', phase_id: 'p1', winner_id: 'u1', games: [{ winner_id: 'u1' }] }];
  await expect(phasePublicReads.headToHead('p1', 'u1', 'u2')).resolves.toEqual(expected);
  await expect(phasePublicReads.headToHead('P1', 'U2', 'U1')).resolves.toEqual(expected);
  expect(queries.getPhaseHeadToHead).toHaveBeenCalledExactlyOnceWith('p1', 'u1', 'u2');
  expect(queries.getMatchesByPhase).not.toHaveBeenCalled();
  expect(fakeNextCache.reads).toMatchObject([{ tags: ['phase:p1'], hit: false }, { tags: ['phase:p1'], hit: true }]);
  expirePhaseReads('p1', 's1');
  await phasePublicReads.headToHead('p1', 'u1', 'u2');
  expect(queries.getPhaseHeadToHead).toHaveBeenCalledTimes(2);
});

it('expires the native league standings preview on a phase write', async () => {
  const rows = [{ rank: 1, player_id: 'u1', player_name: 'Sample One', wins: 1, losses: 0 }];
  queries.getNativeLeagueStandingsPreview.mockResolvedValue(rows);
  await expect(phasePublicReads.seasonStandingsPreview('s1', 1000)).resolves.toEqual(rows);
  await expect(phasePublicReads.seasonStandingsPreview('s1', 1000)).resolves.toEqual(rows);
  expect(queries.getNativeLeagueStandingsPreview).toHaveBeenCalledExactlyOnceWith('s1', 1000);
  expect(fakeNextCache.reads[0].tags).toEqual([publicTags.season('s1'), publicTags.players, publicTags.ratings]);
  expirePhaseReads('p1', 's1');
  await phasePublicReads.seasonStandingsPreview('s1', 1000);
  expect(queries.getNativeLeagueStandingsPreview).toHaveBeenCalledTimes(2);
});

it('caches native phase detail by league and phase and refuses a different league', async () => {
  const first = await phasePublicReads.detail('s1', 'p1');
  expect(first).toMatchObject({ id: 'p1', season_id: 's1', participant_count: 2 });
  expect(first).not.toHaveProperty('stage_spec');
  expect(first).not.toHaveProperty('enrollment_source');
  expect(first).not.toHaveProperty('unexpected_phase_column');
  await expect(phasePublicReads.detail('s1', 'p1')).resolves.toEqual(first);
  expect(queries.getPhaseWithDetails).toHaveBeenCalledExactlyOnceWith('p1', 's1');
  await expect(phasePublicReads.detail('s2', 'p1')).resolves.toBeNull();
  expect(fakeNextCache.reads).toMatchObject([
    { tags: ['phase:p1', 'season:s1'], revalidate: 30, hit: false },
    { tags: ['phase:p1', 'season:s1'], revalidate: 30, hit: true },
    { tags: ['phase:p1', 'season:s2'], revalidate: 30, hit: false },
  ]);
});

it('batches and deduplicates leagues, returning plain objects on both cache misses and hits', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `s${i + 1}`);
  const first = await phasePublicReads.bySeasonIds([...ids, 's1']);
  expect(Object.keys(first)).toHaveLength(51);
  expect(first.s1).toMatchObject([{ id: 'p1', season_id: 's1' }]);
  expect(first.s1[0]).not.toHaveProperty('stage_spec');
  expect(first.s2).toEqual([]);
  expect(queries.getPhasesBySeasonIds.mock.calls.map(([batch]) => batch.length)).toEqual([50, 1]);

  await expect(phasePublicReads.bySeasonIds(ids.toReversed())).resolves.toEqual(first);
  expect(queries.getPhasesBySeasonIds).toHaveBeenCalledTimes(2);
  expect(fakeNextCache.reads.map(({ tags }) => tags.length)).toEqual([50, 1, 50, 1]);
  expirePhaseReads('p1', 's1');
  await phasePublicReads.bySeasonIds(ids);
  expect(queries.getPhasesBySeasonIds).toHaveBeenCalledTimes(3);
  await expect(phasePublicReads.bySeasonIds([])).resolves.toEqual({});
  expect(queries.getPhasesBySeasonIds).toHaveBeenCalledTimes(3);
});

it('stores only public match, enrollment, group and published report fields', async () => {
  const match = await phasePublicReads.match('p1', 'm1');
  expect(match).toMatchObject({ id: 'm1', phase_id: 'p1', round_number: 1, games: [{ id: 'g1' }] });
  await expect(phasePublicReads.match('p2', 'm1')).resolves.toBeNull();
  await expect(phasePublicReads.matches('p1')).resolves.toEqual([match]);
  await expect(phasePublicReads.rounds('p1')).resolves.toEqual([ROUND]);
  await expect(phasePublicReads.participants('p1')).resolves.toEqual([
    { id: 'u1', name: 'Sample One', avatar_url: null, seed: 1, starting_bracket: 'winners' },
  ]);
  await expect(phasePublicReads.groups('p1')).resolves.toMatchObject([
    { phase_id: 'p1', members: [{ player_id: 'u1', player_name: 'Sample One' }] },
  ]);
  await expect(phasePublicReads.reports('p1')).resolves.toEqual([{
    id: 'rp1', phase_id: 'p1', round_id: 'r1', report_type: 'round_recap',
    content: { headline: 'Final score' }, status: 'completed', created_at: TIME, updated_at: TIME,
  }]);

  for (const { body } of fakeNextCache.entries.values()) {
    expect(body).not.toMatch(/"(notes|submitter_id|confirmed_at|auto_confirm_at|tournament_id|raw_log|discord_id|auth_user_id|is_admin|is_test_account|ban_reason|prompt_tokens|error|model_id|generation_time_ms|completion_tokens)":/);
  }
});

it('expires player-bearing reads for an identity change and all phase reads for a phase write', async () => {
  const read = () => Promise.all([
    phasePublicReads.detail('s1', 'p1'), phasePublicReads.rounds('p1'), phasePublicReads.matches('p1'),
    phasePublicReads.match('p1', 'm1'), phasePublicReads.participants('p1'), phasePublicReads.groups('p1'),
    phasePublicReads.reports('p1'),
  ]);
  await read();
  expect(fakeNextCache.entries.size).toBe(7);
  expirePublicTags([publicTags.players]);
  expect(fakeNextCache.entries.size).toBe(3);
  await read();
  expect(queries.getPhaseWithDetails).toHaveBeenCalledTimes(1);
  expect(queries.getMatchesByPhase).toHaveBeenCalledTimes(2);
  expect(queries.getGroupsByPhase).toHaveBeenCalledTimes(2);

  expirePhaseReads('p1', 's1');
  expect(fakeNextCache.entries.size).toBe(0);
  await read();
  expect(queries.getRoundsByPhase).toHaveBeenCalledTimes(2);
  expect(queries.getPhaseReports).toHaveBeenCalledTimes(2);
});
