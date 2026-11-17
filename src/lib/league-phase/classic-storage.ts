import { createSeason } from '@/lib/supabase/queries/seasons';
import type { Season, SeasonFormData } from '@/types/season';

export interface ClassicLeagueStoragePort {
  create(input: SeasonFormData): Promise<Season>;
}

export const legacyClassicLeagueStorage: ClassicLeagueStoragePort = { create: (input) => createSeason(input) };
export const nativeClassicLeagueStorage: ClassicLeagueStoragePort = { create: (input) => createSeason(input) };

export function createClassicLeague(input: SeasonFormData, storage: ClassicLeagueStoragePort = legacyClassicLeagueStorage): Promise<Season> {
  return storage.create(input);
}
