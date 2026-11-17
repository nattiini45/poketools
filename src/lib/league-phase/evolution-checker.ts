import { createEvolutionChecker } from '@/lib/draft/evolution-engine';
import { getSeasonTrackers, getAllTiers, updateTracker } from '@/lib/supabase/queries/evolutions';
import { getPhaseSeasonKosForLine } from '@/lib/supabase/queries/phase-reconciliation';

export const phaseEvolutionChecker = createEvolutionChecker({
  getSeasonTrackers,
  getAllTiers,
  updateTracker,
  getSeasonKosForLine: getPhaseSeasonKosForLine,
});
