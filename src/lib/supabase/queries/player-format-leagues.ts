/**
 * Where a player is enrolled in a league that runs a format, for the player delete route. Server only.
 *
 * The format's rows (relation links, items, submissions, track progress) and the player's phase enrollments cascade away
 * with the player, which would tear a hole in a draw or a table that is still running. So a player who is enrolled in an
 * unfinished league with an attached format (status not `completed`, not archived) cannot be deleted: an admin
 * substitutes or removes them first. A finished league keeps its history and does not block.
 */
import 'server-only';

import { supabase } from '../client';

export interface PlayerFormatLeague {
  id: string;
  name: string;
}

interface SeasonEmbed {
  id: string;
  name: string;
  status: string;
  archived: boolean;
}

const SEASON_COLUMNS = 'id, name, status, archived';

const isUnfinished = (season: SeasonEmbed): boolean => season.status !== 'completed' && !season.archived;

/**
 * The unfinished leagues with an attached format (`season_formats`, any engine) that `playerId` is enrolled in, as a member
 * of the league roster or of one of its phases, sorted by name. Empty for a player in no such league.
 */
export async function listUnfinishedFormatLeaguesOfPlayer(playerId: string): Promise<PlayerFormatLeague[]> {
  const [onRoster, inPhases] = await Promise.all([
    supabase.from('season_participants').select(`seasons!inner ( ${SEASON_COLUMNS} )`).eq('player_id', playerId),
    supabase
      .from('tournament_participants')
      .select(`tournaments!inner ( seasons!inner ( ${SEASON_COLUMNS} ) )`)
      .eq('player_id', playerId)
      .not('tournaments.season_id', 'is', null),
  ]);
  if (onRoster.error) throw onRoster.error;
  if (inPhases.error) throw inPhases.error;

  const seasons = new Map<string, SeasonEmbed>();
  for (const row of onRoster.data as unknown as { seasons: SeasonEmbed }[]) seasons.set(row.seasons.id, row.seasons);
  for (const row of inPhases.data as unknown as { tournaments: { seasons: SeasonEmbed } }[]) {
    seasons.set(row.tournaments.seasons.id, row.tournaments.seasons);
  }

  const unfinished = [...seasons.values()].filter(isUnfinished);
  if (unfinished.length === 0) return [];

  const { data, error } = await supabase
    .from('season_formats')
    .select('season_id')
    .in('season_id', unfinished.map((season) => season.id));
  if (error) throw error;
  const withFormat = new Set(data.map((row) => row.season_id));

  return unfinished
    .filter((season) => withFormat.has(season.id))
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
