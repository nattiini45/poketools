import { computeStandings, computeStandingsForFormat } from '@/lib/tournament/standings';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { ByeRecord, MatchRecord } from '@/lib/tournament/types';
import type { StandingsRow } from '@/types/game';

/**
 * Build standings table rows from completed match records and participants.
 * `byes` are a Swiss stage's scoring byes (`scoringByeRecords`); each counts as a win.
 *
 * `ranking` is the season's standings context. An Evolution Point Buy season ranks by its own chain (the stored
 * tiebreaker order, match points, evolution points), as its tables do; this list carries no battle stats, so a
 * kill difference step ties here, as in the season-wide table. Without a context, or for any other format, the
 * generic Swiss scoring ranks the rows exactly as it always did.
 */
export function buildStandingsRowsFromMatchRecords(
  participants: {
    id: string;
    name: string;
    avatar_url: string | null;
    gym_type?: string | null;
  }[],
  matchRecords: MatchRecord[],
  byes: readonly ByeRecord[] = [],
  ranking?: SeasonStandingsContext,
): StandingsRow[] {
  const participantIds = participants.map((p) => p.id);
  const names: Record<string, string> = {};
  const avatars: Record<string, string | null> = {};
  const gymTypes: Record<string, string | null> = {};

  for (const p of participants) {
    names[p.id] = p.name;
    avatars[p.id] = p.avatar_url;
    gymTypes[p.id] = p.gym_type ?? null;
  }

  const standings =
    ranking?.formatType && isEvolutionPointBuy(ranking.formatType)
      ? computeStandingsForFormat(
          ranking.formatType,
          participantIds,
          names,
          matchRecords,
          avatars,
          { byes: [...byes] },
          gymTypes,
          { evolutionPoints: ranking.evolutionPoints, tiebreakerOrder: ranking.tiebreakerOrder },
        )
      : computeStandings(participantIds, names, matchRecords, avatars, { byes: [...byes] }, gymTypes);

  return standings.map((s) => ({
    player_id: s.player_id,
    player_name: s.player_name,
    player_avatar_url: s.player_avatar_url,
    gym_type: s.gym_type,
    wins: s.wins,
    losses: s.losses,
    game_wins: s.games_played,
    game_losses: 0,
  }));
}
