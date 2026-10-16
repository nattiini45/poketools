import { computeStandings } from '@/lib/tournament/standings';
import type { MatchRecord } from '@/lib/tournament/types';
import type { StandingsRow } from '@/types/game';

/**
 * Build standings table rows from completed match records and participants.
 */
export function buildStandingsRowsFromMatchRecords(
  participants: {
    id: string;
    name: string;
    avatar_url: string | null;
    gym_type?: string | null;
  }[],
  matchRecords: MatchRecord[],
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

  const standings = computeStandings(
    participantIds,
    names,
    matchRecords,
    avatars,
    {},
    gymTypes,
  );

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
