import type { Standing, MatchRecord, ByeRecord } from './types';
import { BYE_PLAYER_ID } from './types';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import { computeEvolutionPointBuyStandings } from './evolution-standings';
import { effectiveMatchPoints } from './standings-rules';

export interface StandingsOptions {
  /** Points awarded per win (Swiss: 1, Round Robin: 3). Ignored for evolution_point_buy: the format pack decides. */
  pointsPerWin?: number;
  /** Points awarded per draw (Swiss: 0.5, Round Robin: 0). Ignored for evolution_point_buy. */
  pointsPerDraw?: number;
  /** Battle stats for computing kill differential and games played */
  battleStats?: TournamentBattleStat[];
  /** Game data: map of match_id → array of game winner IDs */
  gamesByMatch?: Record<string, string[]>;
  /** Only include matches up to this round number */
  maxRound?: number;
  /**
   * Stored Swiss byes (`rounds.bye_player_ids`, gated by `scoringByeRecords`).
   * Each counts as a win worth `pointsPerWin`: one win, no games, no kills and
   * no opponent, so it adds nothing to the player's own or anyone's Buchholz
   * (a bye has no opponent whose points could be summed, and inventing a
   * virtual opponent would shift every existing tiebreak). Omit for round
   * robin and for any caller that does not score byes. Ignored by the
   * evolution_point_buy standings, which keep their own scoring unchanged.
   */
  byes?: ByeRecord[];
}

/**
 * Compute tournament standings from completed match records.
 * Used by Swiss pairing for score-group seeding and by standings display.
 *
 * Points system is configurable:
 * - Swiss: 1pt/win, 0.5pt/draw (default)
 * - Round Robin: 3pt/win, 0pt/draw
 */
export function computeStandings(
  participant_ids: string[],
  participant_names: Record<string, string>,
  matches: MatchRecord[],
  participant_avatars: Record<string, string | null> = {},
  options: StandingsOptions = {},
  participant_gym_types: Record<string, string | null> = {},
): Standing[] {
  const {
    pointsPerWin = 1,
    pointsPerDraw = 0.5,
    battleStats,
    gamesByMatch,
    maxRound,
    byes,
  } = options;

  // Filter by round if requested
  const filteredMatches = maxRound
    ? matches.filter((m) => m.round_number <= maxRound)
    : matches;

  // Filter battle stats by round
  const filteredBattleStats = battleStats
    ? maxRound
      ? battleStats.filter((bs) => bs.round_number <= maxRound)
      : battleStats
    : undefined;

  // Initialize standings for all participants
  const standingMap = new Map<string, Standing>();
  for (const pid of participant_ids) {
    standingMap.set(pid, {
      player_id: pid,
      player_name: participant_names[pid] ?? 'Unknown',
      player_avatar_url: participant_avatars[pid] ?? null,
      gym_type: participant_gym_types[pid] ?? null,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      buchholz: 0,
      games_played: 0,
      kill_differential: 0,
      eliminated: false,
    });
  }

  // Tally wins/losses from completed matches
  for (const match of filteredMatches) {
    const s1 = standingMap.get(match.player_1_id);
    const s2 = standingMap.get(match.player_2_id);
    if (!s1 || !s2) continue;

    if (match.winner_id === match.player_1_id) {
      s1.wins++;
      s1.points += pointsPerWin;
      s2.losses++;
    } else if (match.winner_id === match.player_2_id) {
      s2.wins++;
      s2.points += pointsPerWin;
      s1.losses++;
    } else {
      // Draw (no winner)
      s1.draws++;
      s1.points += pointsPerDraw;
      s2.draws++;
      s2.points += pointsPerDraw;
    }
  }

  // A stored Swiss bye is a win with no opponent: it scores for the player
  // only, and is skipped by the Buchholz pass below (it is not a match).
  if (byes) {
    for (const bye of byes) {
      if (maxRound && bye.round_number > maxRound) continue;
      const standing = standingMap.get(bye.player_id);
      if (!standing) continue;
      standing.wins++;
      standing.points += pointsPerWin;
    }
  }

  // Compute Buchholz tiebreaker: sum of opponents' points
  for (const match of filteredMatches) {
    const s1 = standingMap.get(match.player_1_id);
    const s2 = standingMap.get(match.player_2_id);
    if (!s1 || !s2) continue;

    s1.buchholz += s2.points;
    s2.buchholz += s1.points;
  }

  // Compute games played from game data
  if (gamesByMatch) {
    for (const match of filteredMatches) {
      const matchKey = `${match.player_1_id}::${match.player_2_id}`;
      const games = gamesByMatch[matchKey];
      if (games) {
        const s1 = standingMap.get(match.player_1_id);
        const s2 = standingMap.get(match.player_2_id);
        if (s1) s1.games_played += games.length;
        if (s2) s2.games_played += games.length;
      }
    }
  }

  // Compute kill differential from battle stats
  if (filteredBattleStats) {
    for (const stat of filteredBattleStats) {
      const standing = standingMap.get(stat.player_id);
      if (!standing) continue;
      standing.kill_differential += stat.kos_dealt;
      if (stat.was_koed) standing.kill_differential -= 1;
    }
  }

  // Sort: points desc, kill_differential desc (tiebreaker), buchholz desc, wins desc
  const standings = Array.from(standingMap.values());
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.kill_differential !== a.kill_differential) return b.kill_differential - a.kill_differential;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    return b.wins - a.wins;
  });

  return standings;
}

/**
 * Format-aware standings dispatcher (pure, client-safe).
 *
 * evolution_point_buy seasons rank by the season's stored tiebreaker order
 * (`epb.tiebreakerOrder`, the `format_rules.tiebreaker_order` as read) when it is a usable chain, else by the
 * format pack's chain (`epb.tiebreakerChain`), and score the pack's match points (`epb.matchPoints`) whatever
 * points the caller passes (`effectiveMatchPoints`): a caller's round robin 3/0 never reaches an Evolution Point
 * Buy table. Every other format keeps the generic computeStandings behavior unchanged.
 *
 * `options.byes` (stored Swiss byes) is read by computeStandings only. The EPB
 * branch builds its own options and never forwards it, so EPB standings are
 * unchanged by byes.
 *
 * Server callers should use computeStandingsForSeason (season-standings.ts),
 * which loads the format, the evolution-points map and the stored tiebreaker
 * order; client components pass them down as props.
 */
export function computeStandingsForFormat(
  formatType: string | null | undefined,
  participant_ids: string[],
  participant_names: Record<string, string>,
  matches: MatchRecord[],
  participant_avatars: Record<string, string | null> = {},
  options: StandingsOptions = {},
  participant_gym_types: Record<string, string | null> = {},
  epb?: { evolutionPoints?: Record<string, number>; tiebreakerOrder?: unknown },
): Standing[] {
  if (formatType === 'evolution_point_buy') {
    return computeEvolutionPointBuyStandings(
      participant_ids,
      participant_names,
      matches,
      epb?.evolutionPoints ?? {},
      participant_avatars,
      {
        ...effectiveMatchPoints(formatType),
        battleStats: options.battleStats,
        tiebreakerOrder: epb?.tiebreakerOrder,
      },
    );
  }
  return computeStandings(
    participant_ids,
    participant_names,
    matches,
    participant_avatars,
    options,
    participant_gym_types,
  );
}

/**
 * Build a set of all previous opponent pairings for no-repeat checking.
 * Returns a Set of "playerA::playerB" keys (sorted to be order-independent).
 * A stored bye is recorded as a pairing against BYE_PLAYER_ID, so
 * `havePlayed(history, player, BYE_PLAYER_ID)` says whether the player has
 * already had one (a bye creates no match, so it is not in `matches`).
 */
export function buildPairingHistory(
  matches: MatchRecord[],
  byes: ByeRecord[] = [],
): Set<string> {
  const history = new Set<string>();
  for (const match of matches) {
    const key = [match.player_1_id, match.player_2_id].sort().join('::');
    history.add(key);
  }
  for (const bye of byes) {
    history.add([bye.player_id, BYE_PLAYER_ID].sort().join('::'));
  }
  return history;
}

/**
 * Check if two players have already played each other.
 */
export function havePlayed(
  history: Set<string>,
  player_a: string,
  player_b: string
): boolean {
  const key = [player_a, player_b].sort().join('::');
  return history.has(key);
}
