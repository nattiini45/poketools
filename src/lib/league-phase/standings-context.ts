import 'server-only';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { loadKitStandingsData } from '@/lib/format-engine/load';
import { getNativeKitOutcomes, getNativeKitMatchIds, getNativeKitGameCounts, getNativeKitKills } from '@/lib/supabase/queries/phase-format-runtime';
import { loadEpbStandingsContext, type SeasonStandingsContext } from '@/lib/tournament/season-standings';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { nativeKitReadStorage } from './kit-storage';

export async function loadNativeSeasonStandingsContext(seasonId: string): Promise<SeasonStandingsContext> {
  const season = await getSeasonById(seasonId);
  if (!season) throw new Error('Native standings league not found');
  if (isEvolutionPointBuy(season.format_type)) return loadEpbStandingsContext(seasonId, season.format_type);
  if (season.format_type !== 'custom') return { formatType: season.format_type };
  const storage = nativeKitReadStorage({
    outcomes: (...args) => getNativeKitOutcomes(...args),
    matchIds: (...args) => getNativeKitMatchIds(...args),
    gameCounts: (...args) => getNativeKitGameCounts(...args),
    kills: (...args) => getNativeKitKills(...args),
  });
  const kit = await loadKitStandingsData(seasonId, { storage });
  return kit ? { formatType: season.format_type, kit } : { formatType: season.format_type };
}
