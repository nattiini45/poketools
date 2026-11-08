import { UserFacingError } from '@/lib/api/user-facing-error';
import { MatchReopenDownstreamPlayedError, MatchStateChangedError } from '@/lib/match/state-errors';
import {
  clearMatchSocialImage,
  getMatchById,
  transitionMatchStatus,
} from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { deleteMarkedOutcome, readOutcomeMark } from '@/lib/match/outcome-takeback';
import { unpropagateBracketOnMatchReset } from '@/lib/tournament/bracket-propagation';
import { canReopenMatch, validateTransition } from '@/lib/tournament/match-state';
import {
  collectPlayedDownstreamMatches,
  preflightUncompleteRebuild,
  rebuildGamificationAfterUncomplete,
  recheckEvolutions,
  revertRoundIfCompleted,
} from '@/lib/pkmn/game-pipeline';
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { loadStageEndedWarning } from '@/lib/match/stage-ended';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import type { ReopenMatchResult, ReopenStep } from '@/lib/admin/match-detail';
import type { ParticipantWithSeed } from '@/types/tournament';

// Shared with the admin game change (`game-pipeline.ts`, which this module imports), so they live apart from both.
export { MatchReopenDownstreamPlayedError, MatchStateChangedError };

/**
 * Reopen a completed, pending-confirmation or disputed match to in_progress
 * WITHOUT deleting its games (the non-destructive twin of `resetMatch`). The
 * winner and the confirmation timers are cleared; the admin finishes the
 * match again with the Admin Override form or a game edit.
 *
 * Order is load-bearing:
 *   1. validate the transition (admin-only, explicit status check: in_progress
 *      to in_progress is otherwise a valid transition)
 *   2. preflight, before any write and only for a completed match: the rating
 *      rebuild must not be refused halfway (`RatingHistoryIntegrityError`),
 *      and a played later bracket match refuses the reopen outright
 *   3. one compare-and-set status write (`MatchStateChangedError` on a miss)
 *   4. post-commit steps. The outcome row goes for every status (an admin
 *      forfeit, or the unresolved row of a disputed replay tie, must not
 *      outlive the result it described), but only the row that was there
 *      before the flip (`readOutcomeMark`, deleted by its `set_at`): a settle
 *      that staged a new row for the reopened match in between keeps it; the rest only for a match that WAS
 *      completed (pending and disputed matches never finalized), starting
 *      with the format runtime taking back the effects of `match_completed`. Each step is
 *      isolated and logged; a failed one is reported in `failed_steps` and the
 *      others still run. Achievements are permanent and
 *      a Discord / social announcement already sent cannot be retracted.
 *   5. a completed match of a format phase whose stage already ended is still reopened (nothing reopens the phase): the
 *      result carries `stage_already_ended`, the players who advanced on the strength of the old result.
 */
export async function reopenMatch(matchId: string, adminId: string): Promise<ReopenMatchResult> {
  const match = await getMatchById(matchId);
  if (!match) throw new Error('Match not found');
  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) throw new Error('Tournament not found');

  const fromStatus = match.status;
  if (!canReopenMatch(fromStatus)) {
    throw new UserFacingError(`Invalid transition: ${String(fromStatus)} → in_progress`, {
      code: 'match_transition_invalid',
      params: { from: String(fromStatus), to: 'in_progress' },
      status: 400,
    });
  }

  const transition = validateTransition(fromStatus, 'in_progress', {
    actor_id: adminId,
    is_admin: true,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
  });
  if (!transition.valid) {
    throw new UserFacingError(transition.error ?? 'Invalid transition', {
      code: transition.code,
      params: transition.params,
      status: 400,
    });
  }

  const wasCompleted = fromStatus === 'completed';
  let participants: ParticipantWithSeed[] = [];
  if (wasCompleted) {
    participants = await getParticipants(match.tournament_id);
    await preflightUncompleteRebuild(match);
    const playedDownstream = await collectPlayedDownstreamMatches(match, tournament, participants);
    if (playedDownstream.length > 0) {
      throw new MatchReopenDownstreamPlayedError(playedDownstream.length);
    }
  }

  // Read before the flip: the delete below removes this row and nothing staged after the reopen.
  const outcomeMark = await readOutcomeMark(matchId);
  const reopened = await transitionMatchStatus(matchId, {
    expectedStatus: fromStatus,
    status: 'in_progress',
    winnerId: null,
    autoConfirmAt: null,
    confirmedAt: null,
    datePlayed: null,
  });
  if (!reopened) {
    const current = await getMatchById(matchId).catch(() => null);
    throw new MatchStateChangedError(current?.status);
  }

  const result: ReopenMatchResult = {
    from_status: fromStatus,
    ratings_rebuilt_players: 0,
    bracket_matches_removed: 0,
    failed_steps: [],
  };

  const runStep = async <T>(step: ReopenStep, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (err) {
      console.error(`[reopenMatch] match ${matchId}: step "${step}" failed after the reopen was saved:`, err);
      result.failed_steps.push(step);
      return undefined;
    }
  };

  await runStep('outcome', () => deleteMarkedOutcome(matchId, outcomeMark));

  // A custom league's format takes back what the completion applied (`match_completed`), so every caller of the reopen
  // does, not only the admin route. A disputed match never completed, but its dispute (the unresolved replay tie) opened
  // an `unresolved_outcome` check that this reopen ends. The module is loaded on demand: only custom leagues need the
  // format engine.
  if (wasCompleted || fromStatus === 'disputed') {
    await runStep('format', async () => {
      if (!isKitCandidate(tournament)) return;
      const { revertMatchCompletion } = await import('@/lib/format-engine/runtime/hooks');
      if (!(await revertMatchCompletion({ tournamentId: tournament.id, matchId }))) {
        throw new Error('The format runtime could not take back the effects of the completion');
      }
    });
  }
  if (!wasCompleted) return result;

  await runStep('round', () => revertRoundIfCompleted(match.round_id));

  const removed = await runStep('bracket', () =>
    unpropagateBracketOnMatchReset(match, tournament, participants)
  );
  result.bracket_matches_removed = removed?.length ?? 0;

  // The result changes, so the analyses, snapshots and social image of the
  // old result are dropped (a re-completion rebuilds them), as `resetMatch` does.
  await runStep('cleanup', async () => {
    await Promise.all([
      deleteMatchAnalysis(matchId),
      deleteMatchPrepAnalysesByMatch(matchId),
    ]);
    await deleteMatchSnapshots(matchId);
    await clearMatchSocialImage(matchId);
  });

  // The match is in_progress now, so every rebuild below leaves it out.
  const rebuilt = await runStep('ratings', () =>
    rebuildGamificationAfterUncomplete(true, 'in_progress', match.player_1_id, match.player_2_id)
  );
  result.ratings_rebuilt_players = rebuilt?.length ?? 0;

  await runStep('evolution', async () => {
    if (tournament.season_id && isEvolutionPointBuy(tournament.season_format_type ?? '')) {
      await repairSeasonEvolution(tournament.season_id);
      return;
    }
    const recheck = await recheckEvolutions(tournament.season_id, match.player_1_id, match.player_2_id);
    if (recheck.failed) throw new Error('Evolution recheck reported a failure');
  });

  // The stage of an ended format phase is not reopened by this: the admin is told who advanced on the strength of the
  // result that was taken back. Never throws (a failed read is logged and reported as an unreadable advancement).
  const stageEnded = await loadStageEndedWarning(tournament, true);
  if (stageEnded) result.stage_already_ended = stageEnded;

  return result;
}
