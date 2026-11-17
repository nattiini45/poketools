import type { MatchStatus } from '@/types/match';
import type { EvolutionEvent } from '@/types/evolution';
import type { EpbGameEditRecheck, EvolutionRecheckResult } from './game-pipeline-types';
import type {
  creditMatchRealKills, uncreditGameRealKills, recheckEpbStages,
} from '@/lib/match/evolution-match-evaluator';

export interface EpbGameEditStorage {
  getMatchById(id: string): Promise<{ status: MatchStatus } | null>;
  uncreditGameRealKills: typeof uncreditGameRealKills;
  creditMatchRealKills: typeof creditMatchRealKills;
  recheckEpbStages: typeof recheckEpbStages;
}

export type EpbGameEditRechecker = (input: EpbGameEditRecheck) => Promise<EvolutionRecheckResult>;

export function createNativeEpbGameEditRechecker(): EpbGameEditRechecker {
  const kills = async () => {
    const [storage, evaluator] = await Promise.all([
      import('./epb-storage'),
      import('@/lib/match/evolution-match-evaluator'),
    ]);
    return evaluator.createEpbKillEvaluator(storage.createPhaseEpbStorage());
  };
  return createEpbGameEditRechecker({
    getMatchById: async (id) => (await import('@/lib/supabase/queries/phase-matches')).getPhaseMatchById(id),
    uncreditGameRealKills: async (...args) => (await kills()).uncreditGameRealKills(...args),
    creditMatchRealKills: async (...args) => (await kills()).creditMatchRealKills(...args),
    recheckEpbStages: async (...args) => (await import('@/lib/match/evolution-match-evaluator')).recheckEpbStages(...args),
  });
}

export function createEpbGameEditRechecker(storage: EpbGameEditStorage): EpbGameEditRechecker {
  const { getMatchById, uncreditGameRealKills, creditMatchRealKills, recheckEpbStages } = storage;
  return async (input) => {
    const { seasonId, game } = input;
    const events: EvolutionEvent[] = [];
    let failed = false;
    try {
      const debit = await uncreditGameRealKills(seasonId, game, input.oldStats);
      if (debit === 'marker_changed' || debit === 'game_missing') {
        console.error(
          `[game-pipeline] EPB real kills of game ${game.id} were not debited after its edit (${debit}); ` +
            'reported to the admin as evolution_recheck_failed (season reconcile repairs it)'
        );
        failed = true;
      } else {
        // The marker is NULL now. Re-read the status AFTER the debit: a confirm
        // that landed before it saw the old marker and credited nothing.
        const latest = await getMatchById(input.matchId);
        if (latest?.status === 'completed') {
          const credit = await creditMatchRealKills({
            seasonId,
            matchday: input.matchday,
            playerIds: input.playerIds,
            gameIds: [game.id],
            statsByGame: { [game.id]: input.newStats },
          });
          events.push(...credit.events);
          const concurrentCreditHoldsEditedStats =
            !input.statusConflict && (debit === 'rolled_back' || !input.wasCompleted);
          // 'match_not_completed': the match left `completed` again after the
          // re-read; the marker is NULL, so its next completion credits the game.
          const settled =
            credit.applied.length > 0 ||
            credit.notCompleted.length > 0 ||
            (credit.alreadyApplied.length > 0 && concurrentCreditHoldsEditedStats);
          if (!settled) {
            console.error(
              `[game-pipeline] EPB real kills of game ${game.id} could not be credited with the edited stats ` +
                `(already: ${credit.alreadyApplied.length}, not completed: ${credit.notCompleted.length}, ` +
                `missing: ${credit.missing.length}); reported as evolution_recheck_failed (season reconcile repairs it)`
            );
            failed = true;
          }
        }
      }

      // Re-resolve stages (covers devolutions after the debit).
      events.push(...await recheckEpbStages(seasonId, [...input.playerIds]));
      return { events, failed };
    } catch (err) {
      console.error(
        `[game-pipeline] EPB evolution recheck failed for season ${seasonId} after the game change was saved; ` +
          'reported to the admin as evolution_recheck_failed (season reconcile repairs it)',
        err
      );
      return { events, failed: true };
    }
  };
}
