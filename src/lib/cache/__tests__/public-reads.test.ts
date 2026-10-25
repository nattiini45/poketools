/**
 * D36 fix 5 / D37 acceptance for the public read cache:
 *   - every cached read is tagged and carries the D37 TTL (60 s lists, 30 s
 *     for one league / tournament / player);
 *   - a second read within the TTL is a hit (no query);
 *   - a match write (`revalidateMatchPages`) expires every read whose data a
 *     match can change, and only the catalogue reads listed below survive it;
 *   - the catalogue and player write routes' tags expire exactly their reads;
 *   - no entry holds session data, a private player column or an admin-only
 *     match column (notes, submitter, confirmation timestamps).
 *
 * `next/cache` is the in-memory fake; every query module is mocked. No
 * network, no Supabase.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldRouteDataPreload } from '@/lib/worlds/route-data';

vi.mock('next/cache', async () => (await import('./fake-next-cache')).fakeNextCache.module);

const S = 'season-1';
const T = 'tournament-1';
const P = 'player-1';

/** A full `players` row, as `select('*')` returns it. Private values are marked `*-secret`. */
const FULL_PLAYER_ROW = {
  id: P,
  name: 'Mara',
  avatar_url: 'https://example.test/a.webp',
  ps_username: 'mara-ps',
  champions_username: 'mara-champs',
  joined_date: '2026-01-01T00:00:00Z',
  is_creator: false,
  is_guest: false,
  discord_id: 'discord-secret',
  auth_user_id: 'auth-secret',
  ban_reason: 'ban-secret',
  suspended_until: '2099-01-01T00:00:00Z',
  status: 'suspended',
  is_admin: false,
  is_test_account: false,
  avatar_config: { preset: 'avatar-config-secret' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** Moderation, role and identity columns: never in a cached entry (D36 PII rule). */
const PRIVATE_PLAYER_KEYS = [
  'ban_reason',
  'suspended_until',
  'status',
  'is_admin',
  'is_test_account',
  'avatar_config',
  'discord_id',
  'auth_user_id',
] as const;

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregatesSummary: vi.fn(async () => [{ pokemon_name: 'Garchomp', total_appearances: 2 }]),
  getTotalGamesInScope: vi.fn(async () => 7),
  getAggregateForPokemon: vi.fn(async () => ({ pokemon_name: 'Garchomp', move_counts: { Earthquake: 3 } })),
}));
vi.mock('@/lib/supabase/queries/achievements', () => ({
  listAchievementDefinitions: vi.fn(async () => [{ id: 'first-win' }]),
}));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonEvolutionPoints: vi.fn(async () => ({ [P]: 4 })),
  getSeasonTrackers: vi.fn(async () => [{ player_id: P, current_form: 'Gible' }]),
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(async () => ({ banned_moves: ['Baton Pass'] })),
}));
vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsForSeason: vi.fn(async () => [{ pokemon_name: 'Garchomp', kos_dealt: 2 }]),
  getBattleStatsForTournament: vi.fn(async () => [{ pokemon_name: 'Garchomp', kos_dealt: 1 }]),
}));
vi.mock('@/lib/supabase/queries/league-standings', () => ({
  getLeagueSchedule: vi.fn(async () => ({ standings: [], fixtures: [] })),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(async () => [{ player_1_id: P, player_2_id: 'p2', winner_id: P, round_number: 1 }]),
  getCompletedMatchRecordsBatch: vi.fn(
    async () =>
      new Map([
        ['stage-a', [{ player_1_id: P, player_2_id: 'p2', winner_id: P, round_number: 1 }]],
        ['stage-b', [{ player_1_id: 'p2', player_2_id: P, winner_id: 'p2', round_number: 2 }]],
      ]),
  ),
  // A full `MatchWithPlayers` row, as `select('*')` returns it: the admin-only
  // columns carry `MATCH-SECRET` sentinels.
  getMatchesByTournament: vi.fn(async () => [
    (await import('@/lib/match/__tests__/private-match-fields')).fullMatchRow({ id: 'm1', player_1_name: 'Mara' }),
  ]),
  // The pair's full rows, newest first (the entry sorts them oldest first).
  getH2HBetweenPlayers: vi.fn(async () => {
    const { fullMatchRow } = await import('@/lib/match/__tests__/private-match-fields');
    return [
      fullMatchRow({ id: 'h2', player_1_id: 'p2', player_2_id: P, created_at: '2026-03-02T00:00:00.000Z' }),
      fullMatchRow({ id: 'h1', player_1_id: P, player_2_id: 'p2', created_at: '2026-03-01T00:00:00.000Z' }),
    ];
  }),
}));
vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  getUsageByFormat: vi.fn(async () => ({ data: [], total: 0 })),
}));
vi.mock('@/lib/supabase/queries/players', () => ({
  getPublicPlayers: vi.fn(async () => ({ data: [{ id: P, name: 'Mara' }], total: 1 })),
  getPlayersByIds: vi.fn(async () => new Map([[P, FULL_PLAYER_ROW]])),
}));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(async () => [{ base_pokemon: 'Gible', price: 3 }]),
}));
vi.mock('@/lib/supabase/queries/ratings', () => ({
  getLeaderboardEntries: vi.fn(async () => [{ player_id: P, rating: 1600 }]),
  getRatingHistory: vi.fn(async () => [{ rating_after: 1600 }]),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(async () => [{ id: 'r1', round_number: 1 }]),
  getSwissByeRoundsBySeason: vi.fn(async () => [
    { id: 'r1', tournament_id: 'tournament-1', round_number: 1, bye_player_ids: ['player-1'] },
  ]),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: vi.fn(async () => [{ id: S, name: 'Liga' }]),
  getSeasonWithDetails: vi.fn(async (id: string) => ({ id, name: `Liga ${id}` })),
  getSeasonById: vi.fn(async (id: string) => ({ id, format_type: 'singles' })),
  getSeasonStageIds: vi.fn(async () => ['stage-a', 'stage-b']),
  getPublicSeasonParticipants: vi.fn(async () => [{ id: P, name: 'Mara', gym_type: 'fire', avatar_url: null, core_types: null }]),
  getSeasonParticipantGymTypes: vi.fn(async () => ({ [P]: 'fire' })),
}));
vi.mock('@/lib/supabase/queries/streaks', () => ({
  getStreakLeaderboard: vi.fn(async () => [{ player_id: P, best_win_streak: 5 }]),
}));
vi.mock('@/lib/supabase/queries/team-roles', () => ({
  getActiveRoles: vi.fn(async () => [{ id: 'role-1' }]),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getItemUsageForPokemon: vi.fn(async () => [{ name: 'Choice Scarf', count: 3, usage_percent: 75 }]),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/tournament-reports', () => ({
  getTournamentReports: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournaments: vi.fn(async () => [{ id: T, name: 'Cup' }]),
  getTournamentWithDetails: vi.fn(async (id: string) => ({ id, season_id: S })),
  getStagesBySeasonId: vi.fn(async () => [{ id: T }]),
  getParticipants: vi.fn(async () => [{ ...FULL_PLAYER_ROW, seed: 1, starting_bracket: 'winners' }]),
  getTournamentById: vi.fn(async (id: string) => ({ id, season_id: S })),
}));
vi.mock('@/lib/profile/compose', () => ({
  composePlayerProfile: vi.fn(async () => ({ player: FULL_PLAYER_ROW, headline: { wins: 3 }, recent_form: ['W'] })),
}));
vi.mock('@/lib/stats/standings-preview', () => ({
  getStandingsPreview: vi.fn(async () => [{ rank: 1, player_name: 'Mara', wins: 3, losses: 0 }]),
}));
vi.mock('@/lib/worlds/route-data', () => ({
  buildWorldRouteData: vi.fn(async () => ({ participants: [{ id: P, name: 'Mara', gym_type: 'fire' }] })),
}));

import { fakeNextCache } from './fake-next-cache';
import {
  PUBLIC_DETAIL_TTL_S,
  PUBLIC_LIST_TTL_S,
  PUBLIC_PROFILE_PLAYER_FIELDS,
  publicReads,
} from '../public-reads';
import {
  expireDraftReads,
  expirePublicTags,
  expireSeasonReads,
  expireTournamentReads,
  publicTags,
  revalidateMatchPages,
} from '@/lib/revalidation';
import { listSeasons, getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { buildWorldRouteData } from '@/lib/worlds/route-data';
import { getLeagueSchedule } from '@/lib/supabase/queries/league-standings';
import { getH2HBetweenPlayers } from '@/lib/supabase/queries/matches';
import { getSwissByeRoundsBySeason } from '@/lib/supabase/queries/rounds';
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';
import { PRIVATE_MATCH_FIELDS, PUBLIC_MATCH_FIELDS } from '@/lib/match/public-match';
import { expectNoPrivateMatchData } from '@/lib/match/__tests__/private-match-fields';

type ReaderName = keyof typeof publicReads;

/** League S is bound to point-buy list version `list-v1` (the sampled `pointBuyEntries` version). */
const PRELOAD = {
  league: { id: S, point_buy_list_id: 'list-v1' },
  stages: [],
  participants: [],
} as unknown as WorldRouteDataPreload;

/** One sample call per cached read (the tests below walk this table). */
const CALLS = {
  seasonList: () => publicReads.seasonList(),
  tournamentList: () => publicReads.tournamentList(),
  playerDirectory: () => publicReads.playerDirectory(48, 0),
  ratingLeaderboard: () => publicReads.ratingLeaderboard(5),
  streakLeaderboard: () => publicReads.streakLeaderboard(),
  metaUsage: () => publicReads.metaUsage('gen9ou', 100),
  achievementDefinitions: () => publicReads.achievementDefinitions(),
  teamRoles: () => publicReads.teamRoles(),
  standingsPreview: () => publicReads.standingsPreview('league', S, 3),
  aggregatesSummary: () => publicReads.aggregatesSummary('league', S),
  totalGames: () => publicReads.totalGames('tournament', T),
  pokemonAggregate: () => publicReads.pokemonAggregate('Garchomp'),
  itemUsage: () => publicReads.itemUsage('Garchomp', 'tournament', T, null),
  season: () => publicReads.season(S),
  seasonRow: () => publicReads.seasonRow(S),
  seasonStages: () => publicReads.seasonStages(S),
  seasonParticipants: () => publicReads.seasonParticipants(S),
  seasonGymTypes: () => publicReads.seasonGymTypes(S),
  seasonEvolutionPoints: () => publicReads.seasonEvolutionPoints(S),
  seasonTrackers: () => publicReads.seasonTrackers(S),
  seasonFormatRules: () => publicReads.seasonFormatRules(S),
  seasonBattleStats: () => publicReads.seasonBattleStats(S),
  seasonByeRounds: () => publicReads.seasonByeRounds(S),
  seasonMatchRecords: () => publicReads.seasonMatchRecords(S),
  worldRouteData: () => publicReads.worldRouteData(S, PRELOAD),
  leagueSchedule: () => publicReads.leagueSchedule(S, {}),
  pointBuyEntries: () => publicReads.pointBuyEntries('list-v1'),
  tournament: () => publicReads.tournament(T),
  tournamentRounds: () => publicReads.tournamentRounds(T),
  tournamentMatches: () => publicReads.tournamentMatches(T),
  tournamentHeadToHead: () => publicReads.tournamentHeadToHead(T, P, 'p2'),
  tournamentParticipants: () => publicReads.tournamentParticipants(T),
  tournamentMatchRecords: () => publicReads.tournamentMatchRecords(T),
  tournamentBattleStats: () => publicReads.tournamentBattleStats(T),
  tournamentReports: () => publicReads.tournamentReports(T),
  tournamentGroups: () => publicReads.tournamentGroups(T),
  playerProfile: () => publicReads.playerProfile(P),
  playerRatingHistory: () => publicReads.playerRatingHistory(P, 60),
} satisfies Record<ReaderName, () => Promise<unknown>>;

/** Reads served for 60 s (lists, leaderboards, catalogues, all-time data). */
const LIST_READS = new Set<ReaderName>([
  'seasonList',
  'tournamentList',
  'playerDirectory',
  'ratingLeaderboard',
  'streakLeaderboard',
  'metaUsage',
  'achievementDefinitions',
  'teamRoles',
  'standingsPreview',
  'pokemonAggregate',
]);

/**
 * Reads no match write can change, so a match write leaves them cached. Their
 * own write routes expire them (see the catalogue describe below).
 */
const TTL_ONLY_READS: Partial<Record<ReaderName, string>> = {
  metaUsage: 'imported Smogon usage; the usage import routes and the monthly cron expire it',
  achievementDefinitions: 'achievement catalogue; the admin achievement routes expire it',
  teamRoles: 'team-role catalogue; the team-role import routes expire it',
  pointBuyEntries: 'point-buy list entries; the entry import routes expire their version',
};

const READER_NAMES = Object.keys(CALLS) as ReaderName[];

/** The last cached read's record (each sample call makes exactly one). */
async function readOnce(name: ReaderName) {
  const before = fakeNextCache.reads.length;
  const value = await CALLS[name]();
  expect(fakeNextCache.reads.length - before, `${name} makes exactly one cached read`).toBe(1);
  return { value, record: fakeNextCache.reads[fakeNextCache.reads.length - 1] };
}

beforeEach(() => {
  fakeNextCache.reset();
  vi.clearAllMocks();
});

describe('public read cache — every read is tagged and has the D37 TTL', () => {
  it('the sample table covers every exported read', () => {
    expect(READER_NAMES.sort()).toEqual((Object.keys(publicReads) as ReaderName[]).sort());
  });

  it.each(READER_NAMES)('%s: at least one tag, a public-read key and the right TTL', async (name) => {
    const { record } = await readOnce(name);

    expect(record.tags.length).toBeGreaterThan(0);
    for (const tag of record.tags) {
      expect(tag).toMatch(/^[a-z-]+(:[\w-]+)*$/);
      expect(tag.length).toBeLessThanOrEqual(256);
    }
    expect(record.keyParts[0]).toBe('public-read:v1');
    expect(record.revalidate).toBe(LIST_READS.has(name) ? PUBLIC_LIST_TTL_S : PUBLIC_DETAIL_TTL_S);
  });

  it('item usage (H9) is keyed by species, scope and player, tagged with the scope aggregate tag', async () => {
    await publicReads.itemUsage('Garchomp', 'all_time', null, null);
    await publicReads.itemUsage('Garchomp', 'league', S, P);
    await publicReads.itemUsage('Garchomp', 'league', S, null);
    await publicReads.itemUsage('Garchomp', 'league', S, P);

    expect(fakeNextCache.reads.map((r) => [r.tags, r.revalidate, r.hit])).toEqual([
      [['aggregates:all_time'], 60, false],
      [[`aggregates:league:${S}`], 30, false],
      [[`aggregates:league:${S}`], 30, false],
      [[`aggregates:league:${S}`], 30, true],
    ]);
    expect(getItemUsageForPokemon).toHaveBeenCalledTimes(3);
    expect(getItemUsageForPokemon).toHaveBeenCalledWith('Garchomp', 'league', S, P);
    expect(getItemUsageForPokemon).toHaveBeenCalledWith('Garchomp', 'all_time', null, undefined);
  });

  it('all-time aggregates are list data (60 s); league and tournament aggregates are detail data (30 s)', async () => {
    await publicReads.aggregatesSummary('all_time', null);
    await publicReads.totalGames('all_time', null);
    await publicReads.aggregatesSummary('tournament', T);
    expect(fakeNextCache.reads.map((r) => [r.tags, r.revalidate])).toEqual([
      [['aggregates:all_time'], 60],
      [['aggregates:all_time'], 60],
      [[`aggregates:tournament:${T}`], 30],
    ]);
  });
});

describe('public read cache — hits', () => {
  it('a second read within the TTL issues no query and returns equal data', async () => {
    const first = await publicReads.seasonList();
    const second = await publicReads.seasonList();

    expect(listSeasons).toHaveBeenCalledTimes(1);
    expect(fakeNextCache.reads.map((r) => r.hit)).toEqual([false, true]);
    expect(second).toEqual(first);
  });

  it('the public season list includes test leagues (the default list)', async () => {
    await publicReads.seasonList();

    expect(listSeasons).toHaveBeenCalledWith();
  });

  it('entries are keyed by their arguments', async () => {
    await publicReads.season('a');
    await publicReads.season('b');
    await publicReads.season('a');

    expect(getSeasonWithDetails).toHaveBeenCalledTimes(2);
    expect(fakeNextCache.reads.map((r) => r.hit)).toEqual([false, false, true]);
  });

  it('the world payload and the schedule are keyed by the season id alone, not by the preloaded rows', async () => {
    await publicReads.worldRouteData(S, PRELOAD);
    await publicReads.worldRouteData(S, { ...PRELOAD, stages: [] });
    await publicReads.leagueSchedule(S, {});
    await publicReads.leagueSchedule(S, { stages: [] });

    expect(buildWorldRouteData).toHaveBeenCalledTimes(1);
    expect(buildWorldRouteData).toHaveBeenCalledWith(S, PRELOAD);
    expect(getLeagueSchedule).toHaveBeenCalledTimes(1);
  });

  it('a Map-returning query is flattened into JSON-safe data', async () => {
    const cold = await publicReads.seasonMatchRecords(S);
    const warm = await publicReads.seasonMatchRecords(S);

    expect(Array.isArray(cold)).toBe(true);
    expect(cold).toHaveLength(2);
    expect(warm).toEqual(cold);
  });
});

describe('public read cache — write paths expire the entries (revalidateMatchPages)', () => {
  it(`a match write in tournament ${T} (season ${S}) expires every match-dependent read; only the catalogues survive`, async () => {
    for (const name of READER_NAMES) await CALLS[name]();
    expect(fakeNextCache.reads.every((r) => !r.hit)).toBe(true);

    await revalidateMatchPages(T, 'match-1');

    for (const name of READER_NAMES) {
      const { record } = await readOnce(name);
      const survives = name in TTL_ONLY_READS;
      expect({ name, hit: record.hit }).toEqual({ name, hit: survives });
    }
  });

  it('every expiry is immediate ({ expire: 0 }), not stale-while-revalidate', async () => {
    await revalidateMatchPages(T);

    expect(fakeNextCache.expiredTags.length).toBeGreaterThan(0);
    for (const { profile } of fakeNextCache.expiredTags) {
      expect(profile).toEqual({ expire: 0 });
    }
  });
});

describe('public read cache — the write-route helpers expire exactly the reads they change', () => {
  /** Reads about league S (the home standings preview samples league S). */
  const SEASON_READS: ReaderName[] = [
    'season',
    'seasonRow',
    'seasonStages',
    'seasonParticipants',
    'seasonGymTypes',
    'seasonEvolutionPoints',
    'seasonTrackers',
    'seasonFormatRules',
    'seasonBattleStats',
    'seasonByeRounds',
    'seasonMatchRecords',
    'worldRouteData',
    'leagueSchedule',
    'standingsPreview',
  ];
  /** Reads about tournament (league stage) T. */
  const TOURNAMENT_READS: ReaderName[] = [
    'tournament',
    'tournamentRounds',
    'tournamentMatches',
    'tournamentHeadToHead',
    'tournamentParticipants',
    'tournamentMatchRecords',
    'tournamentBattleStats',
    'tournamentReports',
    'tournamentGroups',
  ];
  const LISTS: ReaderName[] = ['seasonList', 'tournamentList'];

  /** Warm every read, run the write-side expiry, and return the reads that missed. */
  async function missedAfter(expire: () => void): Promise<ReaderName[]> {
    for (const name of READER_NAMES) await CALLS[name]();
    expire();
    const missed: ReaderName[] = [];
    for (const name of READER_NAMES) {
      const { record } = await readOnce(name);
      if (!record.hit) missed.push(name);
    }
    return missed.sort();
  }

  it(`a league-stage write (expireTournamentReads): stage ${T}, league ${S}, both lists and the profiles`, async () => {
    const missed = await missedAfter(() => expireTournamentReads(T, S));
    expect(missed).toEqual([...SEASON_READS, ...TOURNAMENT_READS, ...LISTS, 'playerProfile'].sort());
  });

  it('a league write (expireSeasonReads): the league, both lists and the profiles; a named phase too', async () => {
    expect(await missedAfter(() => expireSeasonReads(S))).toEqual(
      [...SEASON_READS, ...LISTS, 'playerProfile'].sort(),
    );
    fakeNextCache.reset();
    expect(await missedAfter(() => expireSeasonReads(S, [T]))).toEqual(
      [...SEASON_READS, ...TOURNAMENT_READS, ...LISTS, 'playerProfile'].sort(),
    );
  });

  it('a draft write (expireDraftReads): the league reads only', async () => {
    expect(await missedAfter(() => expireDraftReads(S))).toEqual([...SEASON_READS].sort());
  });

  it('the helpers expire immediately ({ expire: 0 })', () => {
    expireTournamentReads(T, S);
    expireSeasonReads(S, [T]);
    expireDraftReads(S);

    expect(fakeNextCache.expiredTags.length).toBeGreaterThan(0);
    for (const { profile } of fakeNextCache.expiredTags) expect(profile).toEqual({ expire: 0 });
  });
});

describe('public read cache — the batched bye rounds follow the rounds they batch', () => {
  it('seasonByeRounds is one season-tagged entry per league and a second read is a hit', async () => {
    await publicReads.seasonByeRounds(S);
    await publicReads.seasonByeRounds(S);
    await publicReads.seasonByeRounds('season-2');

    expect(getSwissByeRoundsBySeason).toHaveBeenCalledTimes(2);
    expect(fakeNextCache.reads.map((r) => [r.tags, r.revalidate, r.hit])).toEqual([
      [[publicTags.season(S)], PUBLIC_DETAIL_TTL_S, false],
      [[publicTags.season(S)], PUBLIC_DETAIL_TTL_S, true],
      [[publicTags.season('season-2')], PUBLIC_DETAIL_TTL_S, false],
    ]);
  });

  it('a new round (expireTournamentReads of the stage and its league) expires the stage rounds and the batched read', async () => {
    await publicReads.tournamentRounds(T);
    await publicReads.seasonByeRounds(S);

    expireTournamentReads(T, S);

    await publicReads.tournamentRounds(T);
    await publicReads.seasonByeRounds(S);
    expect(fakeNextCache.reads.map((r) => r.hit)).toEqual([false, false, false, false]);
  });
});

describe('public read cache — the catalogue and player write routes expire exactly their reads', () => {
  /** Warm every read, expire `tags` as the write route does, and return the reads that missed. */
  async function missedAfterTags(tags: string[]): Promise<ReaderName[]> {
    for (const name of READER_NAMES) await CALLS[name]();
    expirePublicTags(tags);
    const missed: ReaderName[] = [];
    for (const name of READER_NAMES) {
      const { record } = await readOnce(name);
      if (!record.hit) missed.push(name);
    }
    return missed.sort();
  }

  // The tags each route passes to `expirePublicTags`
  // (`catalogue-write-routes.test.ts` walks the routes).
  it.each([
    ['team roles', [publicTags.teamRoles], ['teamRoles']],
    // The profile embeds each earned achievement's definition (name, icon, tier).
    ['achievement definitions', [publicTags.achievements], ['achievementDefinitions', 'playerProfile']],
    ['a usage import', [publicTags.metaUsage], ['metaUsage']],
    // League S is bound to list-v1, and its world payload embeds the entries as roster lines.
    ['point-buy entries of the sampled version', [publicTags.pointBuyList('list-v1')], ['pointBuyEntries', 'worldRouteData']],
  ] as const)('a write to %s expires the reads that embed that catalogue and nothing else', async (_label, tags, reads) => {
    expect(await missedAfterTags([...tags])).toEqual([...reads].sort());
  });

  it('point-buy entries of another version stay cached', async () => {
    expect(await missedAfterTags([publicTags.pointBuyList('list-v2')])).toEqual([]);
  });

  it("a league's world payload carries no point-buy tag when no list is bound", async () => {
    await publicReads.worldRouteData('season-unbound', {
      ...PRELOAD,
      league: { ...PRELOAD.league, id: 'season-unbound', point_buy_list_id: null },
    });

    expect(fakeNextCache.reads[0].tags).toEqual([publicTags.season('season-unbound'), publicTags.players]);
  });

  it(`a player write (PATCH/DELETE /api/players/${P}, avatar) expires every read that embeds a player, and ${P}'s own`, async () => {
    expect(await missedAfterTags([publicTags.players, publicTags.player(P)])).toEqual(
      [
        'playerDirectory',
        'ratingLeaderboard',
        'streakLeaderboard',
        'standingsPreview',
        'seasonParticipants',
        'worldRouteData',
        'leagueSchedule',
        'tournamentMatches',
        'tournamentHeadToHead',
        'tournamentParticipants',
        'playerProfile',
        'playerRatingHistory',
      ].sort(),
    );
  });
});

describe('public read cache — no session data and no private player columns', () => {
  const PRIVATE = ['discord-secret', 'auth-secret', 'ban-secret', 'avatar-config-secret'];

  it('the module reads no session, cookie or header', () => {
    const source = readFileSync(path.resolve(__dirname, '../public-reads.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

    for (const banned of ['@/lib/auth/helpers', '@/auth', 'next-auth', 'next-auth/react', 'next/headers']) {
      expect(imports).not.toContain(banned);
    }
    expect(source).not.toMatch(/\b(getSession|getSessionPlayer|auth|cookies|headers)\(/);
  });

  it('tournament participants are narrowed to public fields before they are cached', async () => {
    const participants = await publicReads.tournamentParticipants(T);

    expect(Object.keys(participants[0]).sort()).toEqual(['avatar_url', 'id', 'name', 'seed', 'starting_bracket']);
    const [entry] = fakeNextCache.entries.values();
    for (const secret of PRIVATE) expect(entry.body).not.toContain(secret);
    for (const key of PRIVATE_PLAYER_KEYS) expect(entry.body).not.toContain(`"${key}"`);
  });

  it('the cached profile player is the PublicPlayer card: no moderation, role or identity column', async () => {
    const profile = await publicReads.playerProfile(P);

    expect(Object.keys(profile?.player ?? {}).sort()).toEqual([...PUBLIC_PROFILE_PLAYER_FIELDS].sort());
    for (const key of PRIVATE_PLAYER_KEYS) expect(profile?.player).not.toHaveProperty(key);

    // The stored entry (what every later viewer is served), not only the cold return value.
    const [entry] = fakeNextCache.entries.values();
    const stored = JSON.parse(entry.body) as { player: Record<string, unknown> };
    for (const key of PRIVATE_PLAYER_KEYS) expect(stored.player).not.toHaveProperty(key);
    expect(stored.player).toEqual({
      id: P,
      name: 'Mara',
      avatar_url: FULL_PLAYER_ROW.avatar_url,
      ps_username: 'mara-ps',
      champions_username: 'mara-champs',
      joined_date: FULL_PLAYER_ROW.joined_date,
      is_creator: false,
      is_guest: false,
    });
    for (const secret of PRIVATE) expect(entry.body).not.toContain(secret);

    // A warm hit serves the same narrowed player.
    const warm = await publicReads.playerProfile(P);
    expect(warm?.player).toEqual(stored.player);
  });

  it('tournament matches are narrowed to PublicMatch before they are cached', async () => {
    const matches = await publicReads.tournamentMatches(T);

    expect(matches).toHaveLength(1);
    expect(Object.keys(matches[0])).toEqual([...PUBLIC_MATCH_FIELDS]);
    for (const key of PRIVATE_MATCH_FIELDS) expect(matches[0]).not.toHaveProperty(key);

    // The stored entry (what every later viewer is served), not only the cold return value.
    const [entry] = fakeNextCache.entries.values();
    const stored = JSON.parse(entry.body) as Record<string, unknown>[];
    expect(Object.keys(stored[0])).toEqual([...PUBLIC_MATCH_FIELDS]);
    expect(stored[0]).toMatchObject({ id: 'm1', player_1_name: 'Mara' });
    expectNoPrivateMatchData(stored);
    for (const key of PRIVATE_MATCH_FIELDS) expect(entry.body).not.toContain(`"${key}"`);

    // A warm hit serves the same narrowed rows.
    const warm = await publicReads.tournamentMatches(T);
    expect(warm).toEqual(stored);
  });

  it("a pair's head-to-head matches are narrowed to PublicMatch before they are cached, oldest first", async () => {
    const matches = await publicReads.tournamentHeadToHead(T, P, 'p2');

    expect(getH2HBetweenPlayers).toHaveBeenCalledWith('p2', P, T);
    expect(matches.map((m) => m.id)).toEqual(['h1', 'h2']);
    for (const match of matches) expect(Object.keys(match)).toEqual([...PUBLIC_MATCH_FIELDS]);

    // The stored entry (what every later viewer is served), not only the cold return value.
    const [entry] = fakeNextCache.entries.values();
    const stored = JSON.parse(entry.body) as Record<string, unknown>[];
    expect(stored.map((m) => m.id)).toEqual(['h1', 'h2']);
    for (const row of stored) expect(Object.keys(row)).toEqual([...PUBLIC_MATCH_FIELDS]);
    expectNoPrivateMatchData(stored);
    for (const key of PRIVATE_MATCH_FIELDS) expect(entry.body).not.toContain(`"${key}"`);
  });

  it('a head-to-head entry is keyed by the tournament and the sorted pair: A-vs-B and B-vs-A share it', async () => {
    await publicReads.tournamentHeadToHead(T, P, 'p2');
    await publicReads.tournamentHeadToHead(T, 'p2', P);
    await publicReads.tournamentHeadToHead('tournament-2', P, 'p2');

    expect(getH2HBetweenPlayers).toHaveBeenCalledTimes(2);
    expect(fakeNextCache.reads.map((r) => [r.keyParts, r.tags, r.hit])).toEqual([
      [['public-read:v1', 'tournament-h2h-public', JSON.stringify([T, 'p2', P])], [publicTags.tournament(T), publicTags.players], false],
      [['public-read:v1', 'tournament-h2h-public', JSON.stringify([T, 'p2', P])], [publicTags.tournament(T), publicTags.players], true],
      [
        ['public-read:v1', 'tournament-h2h-public', JSON.stringify(['tournament-2', 'p2', P])],
        [publicTags.tournament('tournament-2'), publicTags.players],
        false,
      ],
    ]);
  });

  it('the reads that hold match rows carry the -public name, so entries cached before narrowing are never served', async () => {
    const names: Partial<Record<ReaderName, string>> = {};
    for (const reader of ['tournamentMatches', 'tournamentHeadToHead', 'worldRouteData', 'leagueSchedule'] as const) {
      const { record } = await readOnce(reader);
      names[reader] = record.keyParts[1];
    }

    expect(names).toEqual({
      tournamentMatches: 'tournament-matches-public',
      tournamentHeadToHead: 'tournament-h2h-public',
      worldRouteData: 'world-route-data-public-v5',
      leagueSchedule: 'league-schedule-public-v4',
    });
  });

  it('streak rows carry only the player name and avatar', async () => {
    const [row] = await publicReads.streakLeaderboard();

    expect(row).toMatchObject({ player_name: 'Mara', player_avatar_url: FULL_PLAYER_ROW.avatar_url });
    const [entry] = fakeNextCache.entries.values();
    for (const secret of PRIVATE) expect(entry.body).not.toContain(secret);
    for (const key of PRIVATE_PLAYER_KEYS) expect(entry.body).not.toContain(`"${key}"`);
  });
});
