import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  clearMatchSocialImage,
  getMatchById,
  transitionMatchStatus,
} from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { unpropagateBracketOnMatchReset } from '@/lib/tournament/bracket-propagation';
import { canReopenMatch, validateTransition } from '@/lib/tournament/match-state';
import {
  collectPlayedDownstreamMatches,
  preflightUncompleteRebuild,
  rebuildGamificationAfterUncomplete,
  recheckEvolutions,
  revertRoundIfCompleted,
} from '@/lib/pkmn/game-pipeline';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import type { ReopenMatchResult, ReopenStep } from '@/lib/admin/match-detail';
import type { ParticipantWithSeed } from '@/types/tournament';

/**
 * The match left the status the admin saw (a player, the auto-confirm cron or
 * another admin moved it first), so nothing was written. HTTP 409. `status` is
 * the status the match has now, when it could be read again; the message is
 * the same one the confirm-match route gives.
 */
export class MatchStateChangedError extends UserFacingError {
  constructor(status?: string) {
    super(
      status
        ? `The match changed to ${status} while you were editing it. Review it and try again.`
        : 'The match changed while you were editing it; your change was not applied. Reload and review it.',
      { code: 'match_state_changed', params: status ? { status } : undefined, status: 409 },
    );
    this.name = 'MatchStateChangedError';
  }
}

/**
 * A later bracket match that this match's winner advanced into was already
 * played or is in progress. Reopening would orphan that bracket path, so the
 * admin resets those matches first. `count` = such later matches. HTTP 409.
 */
export class MatchReopenDownstreamPlayedError extends UserFacingError {
  constructor(count: number) {
    super(
      count === 1
        ? 'This match cannot be reopened: 1 later bracket match was already played. Reset that match first.'
        : `This match cannot be reopened: ${count} later bracket matches were already played. Reset those matches first.`,
      { code: 'match_reopen_downstream_played', params: { count }, status: 409 },
    );
    this.name = 'MatchReopenDownstreamPlayedError';
  }
}

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
 *   4. post-commit steps, only for a match that WAS completed (pending and
 *      disputed matches never finalized, so the status write is all they
 *      need). Each step is isolated and logged; a failed one is reported in
 *      `failed_steps` and the others still run. Achievements are permanent and
 *      a Discord / social announcement already sent cannot be retracted.
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
  if (!wasCompleted) return result;

  const runStep = async <T>(step: ReopenStep, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (err) {
      console.error(`[reopenMatch] match ${matchId}: step "${step}" failed after the reopen was saved:`, err);
      result.failed_steps.push(step);
      return undefined;
    }
  };

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

  return result;
}
