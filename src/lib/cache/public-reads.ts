import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { publicTags } from '@/lib/revalidation';
import { getAggregateForPokemon, getAggregatesSummary, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { listAchievementDefinitions } from '@/lib/supabase/queries/achievements';
import { getSeasonEvolutionPoints, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getBattleStatsForSeason, getBattleStatsForTournament } from '@/lib/supabase/queries/games';
import { getLeagueSchedule, type LeagueSchedulePreload } from '@/lib/supabase/queries/league-standings';
import {
  getCompletedMatchRecords,
  getCompletedMatchRecordsBatch,
  getH2HBetweenPlayers,
  getMatchesByTournament,
} from '@/lib/supabase/queries/matches';
import { getUsageByFormat } from '@/lib/supabase/queries/meta-usage';
import { getPlayersByIds, getPublicPlayers } from '@/lib/supabase/queries/players';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getLeaderboardEntries, getRatingHistory } from '@/lib/supabase/queries/ratings';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import {
  getPublicSeasonParticipants,
  getSeasonById,
  getSeasonParticipantGymTypes,
  getSeasonStageIds,
  getSeasonWithDetails,
  listSeasons,
} from '@/lib/supabase/queries/seasons';
import { getStreakLeaderboard } from '@/lib/supabase/queries/streaks';
import { getActiveRoles } from '@/lib/supabase/queries/team-roles';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getTournamentReports } from '@/lib/supabase/queries/tournament-reports';
import {
  getParticipants,
  getStagesBySeasonId,
  getTournamentWithDetails,
  listTournaments,
} from '@/lib/supabase/queries/tournaments';
import {
  PUBLIC_PLAYER_FIELDS,
  toPublicPlayer,
  toPublicTournamentParticipant,
  type PublicTournamentParticipant,
} from '@/lib/players/public-player';
import { toPublicMatches, type PublicMatch } from '@/lib/match/public-match';
import { composePlayerProfile } from '@/lib/profile/compose';
import { getStandingsPreview } from '@/lib/stats/standings-preview';
import { buildWorldRouteData, type WorldRouteDataPreload } from '@/lib/worlds/route-data';
import type { AggregateScope } from '@/types/game';
import type { StreakLeaderboardEntry } from '@/types/insights';
import type { PublicPlayerProfile } from '@/types/profile';
import type { MatchRecord } from '@/lib/tournament/types';

/**
 * Public read cache (DATA-PLAN fix 5; freshness policy D37).
 *
 * Every function here wraps a public data read in the Next data cache
 * (`unstable_cache`: this app does not enable `cacheComponents`, so
 * `'use cache'` is unavailable). A cached read:
 *
 * - is PUBLIC: it takes no session and returns nothing about the viewer. The
 *   key is the read's name plus the ids and limits it is called with, so one
 *   entry serves every visitor. Pages keep reading the session themselves
 *   (and stay dynamic); they call these getters for everything else.
 * - is TAGGED (`publicTags` in `src/lib/revalidation.ts`). The write paths
 *   expire the tags next to their `revalidatePath` calls, and the tournament,
 *   league and draft write routes expire theirs right after the write
 *   (`expireTournamentReads` / `expireSeasonReads` / `expireDraftReads`), so
 *   a match result, a pairing or a pick shows on the next view. The player,
 *   avatar and catalogue write routes (point-buy entries, team roles,
 *   achievement definitions, usage imports) expire their tags the same way.
 * - has a TTL: 60 s for list data, 30 s for one league's or one tournament's
 *   data. Next revalidates in the background: after the TTL the next read
 *   returns the cached value once more, whatever its age, and refreshes it.
 *   A write that expires no tag (see `docs/public-site.md`) therefore shows
 *   within one TTL on a busy page, but only on the second view after an idle
 *   spell.
 * - returns JSON: a hit is `JSON.parse`d, so values are plain objects and
 *   arrays (no `Map`, `Set`, `Date` or `undefined` array slots). Readers that
 *   wrap a `Map`-returning query flatten it here.
 * - holds public shapes only. A read whose query returns full `players` rows
 *   maps them field by field (the allowlist mappers of
 *   `src/lib/players/public-player.ts`) before the value is cached:
 *   tournament participants to `PublicTournamentParticipant`, the profile's
 *   player to the `PublicPlayer` card, streak rows to a name and an avatar.
 *   No entry holds a moderation, role or identity column (`ban_reason`,
 *   `suspended_until`, `status`, `is_admin`, `is_test_account`,
 *   `avatar_config`, `discord_id`, `auth_user_id`). Match rows are held
 *   the same way: as `PublicMatch` (`src/lib/match/public-match.ts`), never
 *   with the admin-only `notes`, `submitter_id`, `auto_confirm_at` or
 *   `confirmed_at`. The tournament matches and a pair's head-to-head matches
 *   are mapped inside their callbacks; the world payload and the league
 *   schedule are mapped by their builders (`assembleLeagueSchedule`,
 *   `assembleWorldRouteData`). Those four reads carry a `-public` name
 *   suffix: entries cached before matches were narrowed held the notes, and
 *   a new name means none of them is served.
 *
 * Each getter is also wrapped in React `cache()`, so a render that asks twice
 * looks the entry up once. Results are shared: never mutate them.
 */

/** TTL of list data: season/tournament lists, leaderboards, all-time usage (D37). */
export const PUBLIC_LIST_TTL_S = 60;
/** TTL of one league's or one tournament's data (D37). */
export const PUBLIC_DETAIL_TTL_S = 30;

const KEY_PREFIX = 'public-read:v1';

type KeyPart = string | number | null;

interface ReadSpec {
  /** Unique read name; the first part of the cache key. */
  name: string;
  /** Everything besides the name that identifies the result (ids, limits). */
  key: readonly KeyPart[];
  /** At least one tag, so a write path can expire the entry. */
  tags: readonly string[];
  /** Seconds before the entry is refreshed. */
  ttl: typeof PUBLIC_LIST_TTL_S | typeof PUBLIC_DETAIL_TTL_S;
}

/**
 * Run `read` through the data cache under `spec`. The key is spelled out in
 * `spec.key` (not taken from closure arguments), so a read may close over
 * rows the caller already loaded for the same id without splitting the entry.
 */
function cachedRead<T>(spec: ReadSpec, read: () => Promise<T>): Promise<T> {
  if (spec.tags.length === 0) {
    throw new Error(`[public-reads] ${spec.name}: a cached read needs at least one tag`);
  }
  return unstable_cache(read, [KEY_PREFIX, spec.name, JSON.stringify(spec.key)], {
    tags: [...spec.tags],
    revalidate: spec.ttl,
  })();
}

function aggregatesTtl(scopeType: AggregateScope): ReadSpec['ttl'] {
  return scopeType === 'all_time' ? PUBLIC_LIST_TTL_S : PUBLIC_DETAIL_TTL_S;
}

/** The public shapes the cached reads return (defined beside their allowlist mappers). */
export type { PublicMatch, PublicTournamentParticipant, PublicPlayerProfile };

/**
 * The player fields a cached profile keeps: the `PublicPlayer` profile card.
 * The tests assert the cached entry against this list.
 */
export const PUBLIC_PROFILE_PLAYER_FIELDS = PUBLIC_PLAYER_FIELDS;

// ─── Lists (60 s) ─────────────────────────────────────────────────────────

const seasonList = cache(() =>
  cachedRead(
    { name: 'season-list', key: [], tags: [publicTags.seasons], ttl: PUBLIC_LIST_TTL_S },
    // Public list: test leagues stay out (reachable only by their own URL).
    () => listSeasons({ includeTestSeasons: false }),
  ),
);

const tournamentList = cache(() =>
  cachedRead(
    { name: 'tournament-list', key: [], tags: [publicTags.tournaments], ttl: PUBLIC_LIST_TTL_S },
    () => listTournaments(),
  ),
);

/**
 * One page of the public player directory. Searches are not cached: their
 * key space is whatever a visitor types.
 */
const playerDirectory = cache((limit: number, offset: number) =>
  cachedRead(
    {
      name: 'player-directory',
      key: [limit, offset],
      tags: [publicTags.players, publicTags.ratings],
      ttl: PUBLIC_LIST_TTL_S,
    },
    () => getPublicPlayers({ limit, offset }),
  ),
);

const ratingLeaderboard = cache((minGames: number) =>
  cachedRead(
    {
      name: 'rating-leaderboard',
      key: [minGames],
      tags: [publicTags.ratings, publicTags.players],
      ttl: PUBLIC_LIST_TTL_S,
    },
    () => getLeaderboardEntries(minGames),
  ),
);

/** Streak leaderboard rows with the player's name and avatar resolved. */
const streakLeaderboard = cache(() =>
  cachedRead(
    {
      name: 'streak-leaderboard',
      key: [],
      tags: [publicTags.ratings, publicTags.players],
      ttl: PUBLIC_LIST_TTL_S,
    },
    async (): Promise<StreakLeaderboardEntry[]> => {
      const streaks = await getStreakLeaderboard();
      const players = await getPlayersByIds(streaks.map((s) => s.player_id));
      return streaks.map((s) => {
        const player = players.get(s.player_id);
        return {
          ...s,
          player_name: player?.name ?? 'Unknown',
          player_avatar_url: player?.avatar_url ?? null,
        };
      });
    },
  ),
);

const metaUsage = cache((format: string, limit: number) =>
  cachedRead(
    { name: 'meta-usage', key: [format, limit], tags: [publicTags.metaUsage], ttl: PUBLIC_LIST_TTL_S },
    () => getUsageByFormat(format, { limit }),
  ),
);

const achievementDefinitions = cache(() =>
  cachedRead(
    {
      name: 'achievement-definitions',
      key: [],
      tags: [publicTags.achievements],
      ttl: PUBLIC_LIST_TTL_S,
    },
    () => listAchievementDefinitions(),
  ),
);

const teamRoles = cache(() =>
  cachedRead(
    { name: 'team-roles', key: [], tags: [publicTags.teamRoles], ttl: PUBLIC_LIST_TTL_S },
    () => getActiveRoles(),
  ),
);

/** Top-N standings of a league or tournament (home page featured card). */
const standingsPreview = cache((kind: 'league' | 'tournament', id: string, limit: number) =>
  cachedRead(
    {
      name: 'standings-preview',
      key: [kind, id, limit],
      tags: [
        kind === 'league' ? publicTags.season(id) : publicTags.tournament(id),
        publicTags.players,
      ],
      ttl: PUBLIC_LIST_TTL_S,
    },
    () => getStandingsPreview(kind, id, limit),
  ),
);

// ─── Aggregates (60 s all-time, 30 s per league or tournament) ────────────

const aggregatesSummary = cache((scopeType: AggregateScope, scopeId: string | null) =>
  cachedRead(
    {
      name: 'aggregates-summary',
      key: [scopeType, scopeId],
      tags: [publicTags.aggregates(scopeType, scopeId)],
      ttl: aggregatesTtl(scopeType),
    },
    () => getAggregatesSummary(scopeType, scopeId),
  ),
);

const totalGames = cache((scopeType: AggregateScope, scopeId: string | null) =>
  cachedRead(
    {
      name: 'total-games',
      key: [scopeType, scopeId],
      tags: [publicTags.aggregates(scopeType, scopeId)],
      ttl: aggregatesTtl(scopeType),
    },
    () => getTotalGamesInScope(scopeType, scopeId),
  ),
);

/** All-time aggregate row of one species (species page). */
const pokemonAggregate = cache((pokemonName: string) =>
  cachedRead(
    {
      name: 'pokemon-aggregate',
      key: [pokemonName],
      tags: [publicTags.aggregates('all_time', null)],
      ttl: PUBLIC_LIST_TTL_S,
    },
    () => getAggregateForPokemon(pokemonName, 'all_time', null),
  ),
);

// ─── One league (30 s) ────────────────────────────────────────────────────

function seasonSpec(name: string, seasonId: string, extraTags: readonly string[] = []): ReadSpec {
  return {
    name,
    key: [seasonId],
    tags: [publicTags.season(seasonId), ...extraTags],
    ttl: PUBLIC_DETAIL_TTL_S,
  };
}

const season = cache((seasonId: string) =>
  cachedRead(seasonSpec('season', seasonId), () => getSeasonWithDetails(seasonId)),
);

const seasonRow = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-row', seasonId), () => getSeasonById(seasonId)),
);

const seasonStages = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-stages', seasonId), () => getStagesBySeasonId(seasonId)),
);

const seasonParticipants = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-participants', seasonId, [publicTags.players]), () =>
    getPublicSeasonParticipants(seasonId),
  ),
);

const seasonGymTypes = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-gym-types', seasonId), () => getSeasonParticipantGymTypes(seasonId)),
);

const seasonEvolutionPoints = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-evolution-points', seasonId), () => getSeasonEvolutionPoints(seasonId)),
);

const seasonTrackers = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-trackers', seasonId), () => getSeasonTrackers(seasonId)),
);

/** Throws on a failed read (nothing is cached); the caller decides the fallback. */
const seasonFormatRules = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-format-rules', seasonId), () => getFormatRules(seasonId)),
);

/** The narrow battle_stats rows of every stage of a league (kill rankings). */
const seasonBattleStats = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-battle-stats', seasonId), () => getBattleStatsForSeason(seasonId)),
);

/** Completed match records of every stage of a league, flattened. */
const seasonMatchRecords = cache((seasonId: string) =>
  cachedRead(seasonSpec('season-match-records', seasonId), async (): Promise<MatchRecord[]> => {
    const stageIds = await getSeasonStageIds(seasonId);
    const byStage = await getCompletedMatchRecordsBatch(stageIds);
    return [...byStage.values()].flat();
  }),
);

/**
 * The route-world payload of a league (`buildWorldRouteData`). `preload` must
 * be the rows the caller read for the same season; the entry is keyed by the
 * season id alone. It embeds the bound point-buy list's entries (roster
 * lines), so it also carries that version's tag. The `-v2` name retires
 * entries cached before roster lines carried their `line_id` (B-LINE).
 */
function worldRouteData(seasonId: string, preload: WorldRouteDataPreload) {
  const listId = preload.league.point_buy_list_id;
  const extraTags = [publicTags.players, ...(listId ? [publicTags.pointBuyList(listId)] : [])];
  return cachedRead(seasonSpec('world-route-data-public-v2', seasonId, extraTags), () =>
    buildWorldRouteData(seasonId, preload),
  );
}

/**
 * The league schedule (standings and fixtures). `preload` must be the rows the
 * caller read for the same season; the entry is keyed by the season id alone.
 */
function leagueSchedule(seasonId: string, preload: LeagueSchedulePreload) {
  return cachedRead(seasonSpec('league-schedule-public', seasonId, [publicTags.players]), () =>
    getLeagueSchedule(seasonId, preload),
  );
}

// `-v2`: entries now carry `line_id` and the league overrides (draft-backend §2.2); the new name keeps
// Data Cache entries written before that deploy (no line id, no override) from ever being served again.
const pointBuyEntries = cache((versionId: string) =>
  cachedRead(
    {
      name: 'point-buy-entries-v2',
      key: [versionId],
      tags: [publicTags.pointBuyList(versionId)],
      ttl: PUBLIC_DETAIL_TTL_S,
    },
    () => getListEntries(versionId),
  ),
);

// ─── One tournament or league stage (30 s) ───────────────────────────────

function tournamentSpec(name: string, tournamentId: string, extraTags: readonly string[] = []): ReadSpec {
  return {
    name,
    key: [tournamentId],
    tags: [publicTags.tournament(tournamentId), ...extraTags],
    ttl: PUBLIC_DETAIL_TTL_S,
  };
}

const tournament = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament', tournamentId), () => getTournamentWithDetails(tournamentId)),
);

const tournamentRounds = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament-rounds', tournamentId), () => getRoundsByTournament(tournamentId)),
);

/** A tournament's (or league stage's) matches, narrowed to `PublicMatch` before they are cached. */
const tournamentMatches = cache((tournamentId: string) =>
  cachedRead(
    tournamentSpec('tournament-matches-public', tournamentId, [publicTags.players]),
    async (): Promise<PublicMatch[]> => toPublicMatches(await getMatchesByTournament(tournamentId)),
  ),
);

/**
 * The completed matches between two players in one tournament (or league
 * stage), with their games, oldest first (`created_at`, then `id`): the
 * Insights head-to-head card (`GET /api/matches/head-to-head`).
 *
 * Reads only the pair's matches (`getH2HBetweenPlayers`), never the whole
 * tournament, so the card does not depend on the size of the stage. Keyed by
 * the tournament and the pair in sorted order, so A-vs-B and B-vs-A share one
 * entry. The rows are narrowed to `PublicMatch` inside the callback, and the
 * name carries the `-public` suffix like the other reads that hold match rows.
 * Tagged like `tournamentMatches`, so every match write in the tournament
 * (`revalidateMatchPages`, `expireTournamentReads`) and every player write
 * expires it.
 */
const tournamentHeadToHead = cache((tournamentId: string, playerA: string, playerB: string) => {
  const [low, high] = playerA < playerB ? [playerA, playerB] : [playerB, playerA];
  return cachedRead(
    {
      name: 'tournament-h2h-public',
      key: [tournamentId, low, high],
      tags: [publicTags.tournament(tournamentId), publicTags.players],
      ttl: PUBLIC_DETAIL_TTL_S,
    },
    async (): Promise<PublicMatch[]> =>
      toPublicMatches(await getH2HBetweenPlayers(low, high, tournamentId)).sort(
        (x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id),
      ),
  );
});

/** Tournament participants in seed order, narrowed to public fields. */
const tournamentParticipants = cache((tournamentId: string) =>
  cachedRead(
    tournamentSpec('tournament-participants', tournamentId, [publicTags.players]),
    async (): Promise<PublicTournamentParticipant[]> =>
      (await getParticipants(tournamentId)).map(toPublicTournamentParticipant),
  ),
);

const tournamentMatchRecords = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament-match-records', tournamentId), () =>
    getCompletedMatchRecords(tournamentId),
  ),
);

const tournamentBattleStats = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament-battle-stats', tournamentId), () =>
    getBattleStatsForTournament(tournamentId),
  ),
);

const tournamentReports = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament-reports', tournamentId), () => getTournamentReports(tournamentId)),
);

const tournamentGroups = cache((tournamentId: string) =>
  cachedRead(tournamentSpec('tournament-groups', tournamentId), () => getGroupsByTournament(tournamentId)),
);

// ─── One player (30 s) ────────────────────────────────────────────────────

/**
 * A composed player profile whose player is mapped to the `PublicPlayer`
 * card (`toPublicPlayer`, an allowlist: no moderation, role or identity
 * columns). Null when the player does not exist. The login-only sections
 * (matches, streaks) are part of the entry: they are the same for every
 * signed-in viewer, and the page decides whether to render them. Each earned
 * achievement embeds its definition (name, icon, tier), hence the
 * `achievements` tag.
 */
const playerProfile = cache((playerId: string) =>
  cachedRead(
    {
      name: 'player-profile',
      key: [playerId],
      tags: [
        publicTags.player(playerId),
        publicTags.playerProfiles,
        publicTags.players,
        publicTags.ratings,
        publicTags.achievements,
      ],
      ttl: PUBLIC_DETAIL_TTL_S,
    },
    async (): Promise<PublicPlayerProfile | null> => {
      const profile = await composePlayerProfile(playerId);
      return profile ? { ...profile, player: toPublicPlayer(profile.player) } : null;
    },
  ),
);

const playerRatingHistory = cache((playerId: string, limit: number) =>
  cachedRead(
    {
      name: 'player-rating-history',
      key: [playerId, limit],
      tags: [publicTags.player(playerId), publicTags.ratings],
      ttl: PUBLIC_DETAIL_TTL_S,
    },
    () => getRatingHistory(playerId, limit),
  ),
);

/**
 * The cached public reads. Pages import this object; the tests walk it to
 * prove every read is tagged and expired by the write paths.
 */
export const publicReads = {
  seasonList,
  tournamentList,
  playerDirectory,
  ratingLeaderboard,
  streakLeaderboard,
  metaUsage,
  achievementDefinitions,
  teamRoles,
  standingsPreview,
  aggregatesSummary,
  totalGames,
  pokemonAggregate,
  season,
  seasonRow,
  seasonStages,
  seasonParticipants,
  seasonGymTypes,
  seasonEvolutionPoints,
  seasonTrackers,
  seasonFormatRules,
  seasonBattleStats,
  seasonMatchRecords,
  worldRouteData,
  leagueSchedule,
  pointBuyEntries,
  tournament,
  tournamentRounds,
  tournamentMatches,
  tournamentHeadToHead,
  tournamentParticipants,
  tournamentMatchRecords,
  tournamentBattleStats,
  tournamentReports,
  tournamentGroups,
  playerProfile,
  playerRatingHistory,
} as const;
