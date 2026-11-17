import type { EpbKillStorage } from '@/lib/match/evolution-match-evaluator';
import type { EpbMatchdayStorage } from '@/lib/match/epb-matchday';
import {
  loadLegacyEpbSeasonMatches,
  StaleKillCreditError,
  type EpbRebuildStorage,
} from '@/lib/reconcile/evolution-rebuild';
import { creditPhaseGameKills, uncreditPhaseGameKills } from '@/lib/supabase/queries/evolutions';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import {
  getPhaseMatchSnapshots, insertPhaseMatchSnapshots, deletePhaseMatchSnapshots,
} from '@/lib/supabase/queries/phase-match-snapshots';
import {
  getPhaseRegisteredSpeciesByMatch, loadPhaseEpbSeasonMatches, syncMixedEpbGameKillCredit,
} from '@/lib/supabase/queries/phase-epb';

export function createPhaseEpbStorage(): EpbKillStorage & EpbMatchdayStorage {
  return {
    creditGameKills: creditPhaseGameKills,
    uncreditGameKills: uncreditPhaseGameKills,
    getRegisteredSpeciesByMatch: getPhaseRegisteredSpeciesByMatch,
    insertMatchSnapshots: insertPhaseMatchSnapshots,
    deleteMatchSnapshots: deletePhaseMatchSnapshots,
  };
}

export function createMixedEpbRebuildStorage(): EpbRebuildStorage {
  return {
    loadMatches: async (seasonId) => {
      const [legacy, phases] = await Promise.all([
        loadLegacyEpbSeasonMatches(seasonId), loadPhaseEpbSeasonMatches(seasonId),
      ]);
      return [...legacy, ...phases];
    },
    getSnapshots: (entry) => entry.source === 'phase'
      ? getPhaseMatchSnapshots(entry.match.id) : getMatchSnapshots(entry.match.id),
    syncCredits: async (seasonId, epoch, computed) => {
      const outcome = await syncMixedEpbGameKillCredit(
        seasonId, epoch, computed.creditedMatchIds ?? [], computed.creditsByGame ?? {},
        computed.phaseCreditedMatchIds ?? [], computed.phaseCreditsByGame ?? {},
      );
      if (outcome.status === 'stale') throw new StaleKillCreditError(outcome.reason);
    },
  };
}
