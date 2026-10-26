import { revalidatePath, revalidateTag } from 'next/cache';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import type { AggregateScope } from '@/types/game';

// ─── Public read-cache tags (D36 fix 5, D37) ─────────────────────────────
//
// The cached public reads (`src/lib/cache/public-reads.ts`) carry these tags.
// They live here, beside the write-side helpers, so that the API routes that
// import this module do not pull in every query module the read cache wraps.

/** Tag builders. One vocabulary for the read cache and the write paths. */
export const publicTags = {
  /** The season (league) list: `listSeasons`. */
  seasons: 'seasons',
  /** The tournament list: `listTournaments`. */
  tournaments: 'tournaments',
  /** Rating and streak leaderboards, rating badges, rating history. */
  ratings: 'ratings',
  /** Public player identity (names, avatars) wherever a read embeds it. */
  players: 'players',
  /** Every composed player profile (match results change them all). */
  playerProfiles: 'player-profiles',
  /** Achievement definitions (seeded catalogue). */
  achievements: 'achievements',
  /** Team-role catalogue (matchup analysis). */
  teamRoles: 'team-roles',
  /** Imported meta usage (insights fallback when no games exist). */
  metaUsage: 'meta-usage',
  /** The format gallery shelf (`src/lib/cache/format-reads.ts`). */
  formatLibrary: 'format-library',
  /** Everything read for one league: row, stages, participants, world, schedule. */
  season: (seasonId: string) => `season:${seasonId}`,
  /** Everything read for one tournament (or league stage). */
  tournament: (tournamentId: string) => `tournament:${tournamentId}`,
  /** One player's profile and rating history. */
  player: (playerId: string) => `player:${playerId}`,
  /** One point-buy list version's entries. */
  pointBuyList: (versionId: string) => `point-buy-list:${versionId}`,
  /** Aggregate counters and game totals of one scope. */
  aggregates: (scopeType: AggregateScope, scopeId: string | null) =>
    scopeType === 'all_time' ? 'aggregates:all_time' : `aggregates:${scopeType}:${scopeId ?? ''}`,
} as const;

/**
 * Expire, not just mark stale. With `{ expire: 0 }` the next read of a tagged
 * entry is a blocking miss, so a write shows on the very next view. (`'max'`
 * would serve the old entry once more while refreshing in the background;
 * `updateTag` is Server-Action-only and these callers are route handlers.)
 */
export const EXPIRE_NOW = { expire: 0 } as const;

const LEAGUE_PATH = /^\/leagues\/([^/]+)(?:\/(stats|teams|matchup))?$/;
const TOURNAMENT_PATH = /^\/tournaments\/([^/]+)(\/stats)?$/;
const PLAYER_PATH = /^\/players\/([^/]+)$/;

/**
 * The cache tags behind a public path: what `revalidateTag` must expire so
 * that the cached reads the path renders from are fresh too. `revalidatePath`
 * alone only reaches the page and the reads made from that page; the same
 * read made from another page (the season list on `/` and on `/leagues`)
 * would keep its old entry.
 *
 * An empty list means no cached public read backs the path (admin pages,
 * `/teams`). `src/lib/__tests__/revalidation-tags.test.ts` pins every path
 * this module revalidates to either a mapping here or that explicit list.
 */
export function tagsForPath(path: string): string[] {
  switch (path) {
    case '/':
      return [publicTags.seasons, publicTags.tournaments];
    case '/leagues':
      return [publicTags.seasons];
    case '/tournaments':
      return [publicTags.tournaments];
    case '/insights':
    case '/leaderboard':
      return [publicTags.ratings, publicTags.aggregates('all_time', null)];
    case '/pokemon':
      return [publicTags.aggregates('all_time', null)];
    case '/players':
      return [publicTags.players];
    default:
      break;
  }

  const league = LEAGUE_PATH.exec(path);
  if (league) {
    const [, seasonId, sub] = league;
    return sub === 'stats'
      ? [publicTags.season(seasonId), publicTags.aggregates('league', seasonId)]
      : [publicTags.season(seasonId)];
  }

  const tournament = TOURNAMENT_PATH.exec(path);
  if (tournament) {
    const [, tournamentId, stats] = tournament;
    return stats
      ? [publicTags.tournament(tournamentId), publicTags.aggregates('tournament', tournamentId)]
      : [publicTags.tournament(tournamentId)];
  }

  const player = PLAYER_PATH.exec(path);
  if (player) return [publicTags.player(player[1])];

  return [];
}

/** Expire public read-cache tags now (see `EXPIRE_NOW`). */
export function expirePublicTags(tags: Iterable<string>): void {
  for (const tag of new Set(tags)) {
    revalidateTag(tag, EXPIRE_NOW);
  }
}

// ─── Write routes that revalidate no path ────────────────────────────────
//
// `unstable_cache` serves an entry past its TTL once more, whatever its age,
// and refreshes it in the background. A write that expires no tag would
// therefore reach the first viewer after an idle spell only on their second
// view. Pairings, brackets, rounds, participants, status, phases, format
// rules and draft picks must show on the next view, so their routes call one
// of the helpers below right after the write commits.
// `src/lib/__tests__/write-route-tags.test.ts` walks those routes.

/**
 * Tags a tournament (or league stage) write changes: its bracket, rounds,
 * pairings, participants, seeds or status. That is the tournament's own
 * reads, the tournament list, every player profile (participations and
 * upcoming matches) and, for a league stage, the league's reads and the
 * season list.
 */
export function tournamentWriteTags(tournamentId: string, seasonId?: string | null): string[] {
  const tags = [publicTags.tournament(tournamentId), publicTags.tournaments, publicTags.playerProfiles];
  if (seasonId) tags.push(publicTags.season(seasonId), publicTags.seasons);
  return tags;
}

/**
 * Tags a league write changes: its settings, status, phases, participants,
 * cores, tokens, format rules, progress, redraft or evolution points. That is
 * the league's reads, the season list, the tournament list (a league's phases
 * are tournaments), every player profile and the reads of each phase in
 * `stageIds` (the phases the write touched, when the route knows them).
 */
export function seasonWriteTags(seasonId: string, stageIds: readonly string[] = []): string[] {
  return [
    publicTags.season(seasonId),
    publicTags.seasons,
    publicTags.tournaments,
    publicTags.playerProfiles,
    ...stageIds.map((stageId) => publicTags.tournament(stageId)),
  ];
}

/**
 * Tags a draft write changes (a pick, an undo, the pool status): its league's
 * reads only. Kept narrow on purpose: a live draft writes every few seconds.
 */
export function draftWriteTags(seasonId: string): string[] {
  return [publicTags.season(seasonId)];
}

/** Expire the public reads a tournament (or league stage) write changed. */
export function expireTournamentReads(tournamentId: string, seasonId?: string | null): void {
  expirePublicTags(tournamentWriteTags(tournamentId, seasonId));
}

/** Expire the public reads a league write changed (see `seasonWriteTags`). */
export function expireSeasonReads(seasonId: string, stageIds: readonly string[] = []): void {
  expirePublicTags(seasonWriteTags(seasonId, stageIds));
}

/**
 * Tags a rating rebuild outside a match write changes (the rebuild after a
 * test-league flag change): the leaderboard, rating badges and histories
 * (`ratings`), every player profile, and each rebuilt player's own reads.
 */
export function ratingRebuildTags(playerIds: readonly string[]): string[] {
  return [publicTags.ratings, publicTags.playerProfiles, ...playerIds.map((playerId) => publicTags.player(playerId))];
}

/** Expire the public reads a rating rebuild changed (see `ratingRebuildTags`). */
export function expireRatingReads(playerIds: readonly string[]): void {
  expirePublicTags(ratingRebuildTags(playerIds));
}

/** Expire the public reads a draft write changed (see `draftWriteTags`). */
export function expireDraftReads(seasonId: string): void {
  expirePublicTags(draftWriteTags(seasonId));
}

/**
 * Expire the cached format gallery (`publicTags.formatLibrary`). Every format library write route (create, fork,
 * publish, visibility, delete) calls this right after the write commits.
 */
export function expireFormatLibraryReads(): void {
  expirePublicTags([publicTags.formatLibrary]);
}

/**
 * `revalidatePath` plus the matching `revalidateTag`s. Every path this module
 * and `aggregate-rebuild.ts` revalidate goes through here, so a page and the
 * cached reads it renders from are invalidated together.
 */
export function revalidatePublicPath(path: string, type?: 'layout' | 'page'): void {
  if (type) {
    revalidatePath(path, type);
  } else {
    revalidatePath(path);
  }
  expirePublicTags(tagsForPath(path));
}

/**
 * One invalidation pass: like `revalidatePublicPath`, but each tag is expired
 * once however many of the pass's paths map to it.
 */
function publicRevalidationPass() {
  const expired = new Set<string>();
  const expire = (tags: readonly string[]) => {
    const fresh = tags.filter((tag) => !expired.has(tag));
    for (const tag of fresh) expired.add(tag);
    expirePublicTags(fresh);
  };
  return {
    path(path: string, type?: 'layout' | 'page') {
      if (type) {
        revalidatePath(path, type);
      } else {
        revalidatePath(path);
      }
      expire(tagsForPath(path));
    },
    tags: expire,
  };
}

/**
 * Revalidate all ISR-cached pages affected by a match mutation, and expire the
 * public read-cache tags behind them. Call this from API routes after writes
 * to games, matches, or aggregates.
 */
export async function revalidateMatchPages(tournamentId: string, matchId?: string): Promise<void> {
  const pass = publicRevalidationPass();

  // Tournament detail + stats pages
  pass.path(`/tournaments/${tournamentId}`);
  pass.path(`/tournaments/${tournamentId}/stats`);

  // Tournament list pages
  pass.path('/tournaments');

  // Public teams directory (rosters/team listings change on match reset;
  // teams.match_id is cleared by cleanMatchChildren, see spec §25)
  pass.path('/teams');
  pass.path('/teams/library');

  // If this tournament belongs to a season/league, revalidate those too
  const tournament = await getTournamentById(tournamentId);
  if (tournament?.season_id) {
    pass.path(`/leagues/${tournament.season_id}`);
    pass.path(`/leagues/${tournament.season_id}/stats`);
    // League team pages + Matchup Analysis depend on current rosters and
    // evolution stages, which change after a match-derived rebuild (spec §25)
    pass.path(`/leagues/${tournament.season_id}/teams`);
    pass.path(`/leagues/${tournament.season_id}/matchup`);
    pass.path('/leagues');
  }

  // Admin pages
  pass.path(`/admin/matches`);
  if (matchId) {
    pass.path(`/admin/matches/${matchId}`);
    // NOTE: the per-match social image lives at /api/matches/[id]/social-image,
    // but that route only exposes admin POST/DELETE (upload to Supabase Storage)
    // with no GET/ISR config, so it is not a cached path and is intentionally
    // NOT revalidated here. matches.social_image_url is a plain column cleared
    // by cleanMatchChildren. Each upload writes a NEW object under a new UUID
    // name (one-year cache, never overwritten in place) and moves the column
    // to its URL, so a CDN-cached URL never serves a replaced image.
  }

  // Insights / leaderboard (ratings change on match completion)
  pass.path('/insights');
  pass.path('/leaderboard');

  // Species detail pages (wiki usage blocks read aggregates)
  pass.path('/pokemon', 'layout');

  // Home page (may show recent results)
  pass.path('/');

  // No path names them, but every involved player's profile (record, form,
  // spotlight, trophies) is derived from match results.
  pass.tags([publicTags.playerProfiles]);
}
