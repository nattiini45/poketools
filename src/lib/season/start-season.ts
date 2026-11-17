import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { seasonMachine } from './season-state';

export interface SeasonStartStoragePort {
  getSeason: typeof getSeasonById;
  updateSeason: typeof updateSeason;
}

export const legacySeasonStartStorage: SeasonStartStoragePort = {
  getSeason: (id) => getSeasonById(id),
  updateSeason: (id, input, guard) => updateSeason(id, input, guard),
};

/**
 * The league follows its first phase: an upcoming league becomes active when a round or bracket is written (seasonMachine
 * `start`, actor system). The write is a compare-and-set on `upcoming`, so an admin who set another status since the read
 * is not overwritten (the move is then skipped and logged). Returns whether the league moved.
 */
export async function startSeasonIfUpcoming(seasonId: string, storage: SeasonStartStoragePort = legacySeasonStartStorage): Promise<boolean> {
  const season = await storage.getSeason(seasonId);
  if (!season || season.status !== 'upcoming') return false;
  seasonMachine.assertTransition('upcoming', 'active', 'system');
  try {
    await storage.updateSeason(season.id, { status: 'active' }, { from: 'upcoming' });
    return true;
  } catch (err) {
    if (!(err instanceof UserFacingError) || err.code !== 'season_status_changed') throw err;
    logger.warn('season/start', 'the league left upcoming before its first round started it; kept its status', { seasonId });
    return false;
  }
}
