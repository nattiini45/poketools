import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { propagateBracketOnMatchComplete } from '@/lib/tournament/bracket-propagation';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchById, markMatchFinalized } from '@/lib/supabase/queries/matches';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import {
  deleteMatchOutcome,
  getMatchOutcome,
  recordMatchOutcome,
} from '@/lib/supabase/queries/match-outcomes';
import { getRatingHistoryByMatch, getRatingHistoryByMatches, loadRatingScope } from '@/lib/supabase/queries/ratings';
import { matchCountsForRatings } from '@/lib/rating/rating-scope';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runEpbMatchdayHooks } from '@/lib/match/epb-matchday';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { creditMatchRealKills } from '@/lib/match/evolution-match-evaluator';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { buildFinalizationNotifications } from './finalization-notifications';
import { checkAchievements } from '@/lib/gamification/achievements';
import { updateSignatures } from '@/lib/gamification/signatures';
import { recomputeStreaks, recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { updateRatings, updateRatingsWithStorage } from '@/lib/rating/updateRatings';
import type { MatchWithPlayers } from '@/types/match';
import type { BattleStat } from '@/types/game';
import type { Tournament } from '@/types/tournament';

import { createMatchFinalizer, type FinalizationAchievementContext, type FinalizationAnnouncements, type MatchFinalizationStorage } from './finalization-core';
import type { AdminMatchOutcome, StagedAdminOutcome, FinalizeMatchCompletionInput, FinalizeMatchCompletionResult, HealMatchFinalizationResult, NeedsAdminReason } from './finalization-core';
export { FINALIZE_STEPS, FINALIZE_HEAL_POLICY } from './finalization-core';
export type { AdminMatchOutcome, StagedAdminOutcome, FinalizeStep, FinalizeMatchCompletionResult, HealMatchFinalizationResult, NeedsAdminReason } from './finalization-core';

/**
 * The format runtime of a custom league (`match_completed`, track progress, assisted checks). A finalize step, so a
 * failure is visible and retried: the hook is idempotent per completion (its event key), logs its own failure with
 * the original error and reports it; the step then fails, `finalized_at` stays unset and the heal calls it again. It
 * needs the match's outcome row (faints, forfeit), so it never runs when the `outcome` step failed.
 */
async function runFormatHook(match: MatchWithPlayers, winnerId: string, tournament: Tournament, confirmedAt: string | null): Promise<void> {
  const { onMatchCompleted } = await import('@/lib/format-engine/runtime/hooks');
  const applied = await onMatchCompleted({
    tournament,
    matchId: match.id,
    roundId: match.round_id,
    player1Id: match.player_1_id,
    player2Id: match.player_2_id,
    winnerId,
    ...(confirmedAt !== null ? { confirmedAt } : {}),
  });
  if (!applied) throw new Error(`format runtime hook failed for match ${match.id}`);
}

async function loadTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  return tournament;
}

function isEpbTournament(tournament: Tournament): tournament is Tournament & { season_id: string } {
  return Boolean(tournament.season_id) && isEvolutionPointBuy(tournament.season_format_type ?? '');
}

function isElimTournament(tournament: Tournament): boolean {
  return tournament.bracket_type === 'single_elim' || tournament.bracket_type === 'double_elim';
}

/**
 * EPB real kills: evolution
 * progress waits for the confirmed result, so the real kills of the match's
 * games are credited here, at completion, never at submission. Each game is
 * credited at most once (`games.evolution_applied_at`, set in the credit's own
 * transaction), so a finalize re-run or a heal credits nothing twice, and a
 * game credited at submission before 2026-10-20 carries the backfilled marker.
 * Runs before the matchday hooks: the hooks' Participation Token rule reads
 * the stage the kills reached, as the season rebuild does. A missing round is a
 * failure (the matchday is unknown). Returns the matchday for the hooks.
 */
async function runEpbRealKillsStep(
  match: MatchWithPlayers,
  seasonId: string,
  statsByGame: Record<string, BattleStat[]>
): Promise<number> {
  const round = await getRoundById(match.round_id);
  if (!round) throw new Error(`Round ${match.round_id} not found; EPB matchday unknown`);
  await creditMatchRealKills({
    seasonId,
    matchday: round.round_number,
    playerIds: [match.player_1_id, match.player_2_id],
    // Every game of the match (a game without stats is marked with no credit).
    gameIds: [...new Set([...match.games.map((game) => game.id), ...Object.keys(statsByGame)])],
    statsByGame,
  });
  return round.round_number;
}

/**
 * EPB matchday hooks (cosmo, stage recheck, lock, EP, snapshots). The
 * orchestrator rolls its own writes back and rethrows on failure. Runs after
 * `runEpbRealKillsStep`, which resolved the matchday.
 */
async function runEpbStep(
  match: MatchWithPlayers,
  seasonId: string,
  matchday: number,
  battleStats: BattleStat[]
): Promise<void> {
  await runEpbMatchdayHooks({
    match,
    seasonId,
    matchday,
    battleStats,
  });
}

async function runBracketStep(
  match: MatchWithPlayers,
  winnerId: string,
  tournament: Tournament
): Promise<void> {
  const participants = await getParticipants(match.tournament_id);
  await propagateBracketOnMatchComplete(
    { ...match, winner_id: winnerId, status: 'completed' },
    tournament,
    participants
  );
}

function emitAnnouncements(input: Omit<FinalizationAnnouncements<MatchWithPlayers, Tournament>, 'competition'> & { tournament: Tournament }): void {
  const { tournament, ...facts } = input;
  for (const event of buildFinalizationNotifications(facts)) {
    const payload = {
      event_type: event.event_type,
      tournament_id: facts.match.tournament_id,
      season_id: tournament.season_id,
      data: { ...event.data, tournament_name: tournament.name },
    };
    void emitDiscordEvent(payload);
    void emitSocialEvent({ ...payload, ...('imageUrl' in event ? { imageUrl: event.imageUrl } : {}) });
  }
}

function achievementContext({ match, competition, winnerId, loserId }: FinalizationAchievementContext<MatchWithPlayers, Tournament>) {
  return {
    match_id: match.id,
    tournament_id: match.tournament_id,
    season_id: competition.season_id ?? null,
    winner_id: winnerId,
    loser_id: loserId,
    is_draw: false,
  };
}

const legacyStorage: MatchFinalizationStorage<MatchWithPlayers, Tournament> = {
  competitionId: (match) => match.tournament_id,
  auditOwner: (match) => ({ tournament_id: match.tournament_id }),
  resourceType: 'match',
  loadCompetition: (...args) => loadTournament(...args),
  isEpbCompetition: (...args) => isEpbTournament(...args),
  isElimCompetition: (...args) => isElimTournament(...args),
  isKitCandidate: (...args) => isKitCandidate(...args),
  getMatchById: (...args) => getMatchById(...args),
  markMatchFinalized: (...args) => markMatchFinalized(...args),
  getBattleStatsByMatch: (...args) => getBattleStatsByMatch(...args),
  getMatchOutcome: (...args) => getMatchOutcome(...args),
  recordMatchOutcome: (...args) => recordMatchOutcome(...args),
  deleteMatchOutcome: (...args) => deleteMatchOutcome(...args),
  updateRatings: (...args) => updateRatings(...args),
  recomputeStreaks: (...args) => recomputeStreaks(...args),
  updateSignatures: (...args) => updateSignatures(...args),
  getMatchSnapshots: (...args) => getMatchSnapshots(...args),
  runEpbRealKillsStep: (...args) => runEpbRealKillsStep(...args),
  runEpbStep: (...args) => runEpbStep(...args),
  runBracketStep: (...args) => runBracketStep(...args),
  runFormatHook: (...args) => runFormatHook(...args),
  revalidateMatchPages: (...args) => revalidateMatchPages(...args),
  loadRatingScope: (...args) => loadRatingScope(...args),
  matchCountsForRatings: (...args) => matchCountsForRatings(...args),
  getRatingHistoryByMatch: (...args) => getRatingHistoryByMatch(...args),
  getRatingHistoryByMatches: (...args) => getRatingHistoryByMatches(...args),
  checkAchievements: (id, input) => checkAchievements(id, achievementContext(input)),
  emitAnnouncements: ({ competition, ...input }) => emitAnnouncements({ ...input, tournament: competition }),
};
const finalizer = createMatchFinalizer(legacyStorage);

async function standaloneFinalizer(tournamentId: string) {
  const tournament = await loadTournament(tournamentId);
  if (tournament.season_id !== null) throw new Error('Active phase storage only accepts standalone tournament finalization here');
  const [streams, achievements] = await Promise.all([
    import('@/lib/league-phase/rating-streak-streams'),
    import('@/lib/league-phase/achievement-streams'),
  ]);
  const ratings = streams.createMixedRatingStorage('tournament');
  return createMatchFinalizer<MatchWithPlayers, Tournament>({
    ...legacyStorage,
    loadCompetition: async () => tournament,
    updateRatings: (...args) => updateRatingsWithStorage(...args, ratings),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, streams.mixedStreakStorage),
    checkAchievements: (id, input) => achievements.checkMixedTournamentAchievements(id, achievementContext(input)),
  });
}

export async function finalizeMatchCompletion(input: FinalizeMatchCompletionInput): Promise<FinalizeMatchCompletionResult> {
  return await requireOpenPhaseRouteMode() === 'phase'
    ? finalizeStandaloneMatchCompletion(input)
    : finalizer.finalizeMatchCompletion(input);
}

export async function healMatchFinalization(match: MatchWithPlayers): Promise<HealMatchFinalizationResult> {
  return await requireOpenPhaseRouteMode() === 'phase'
    ? healStandaloneMatchFinalization(match)
    : finalizer.healMatchFinalization(match);
}

export async function finalizeStandaloneMatchCompletion(input: FinalizeMatchCompletionInput): Promise<FinalizeMatchCompletionResult> {
  return (await standaloneFinalizer(input.match.tournament_id)).finalizeMatchCompletion(input);
}

export async function healStandaloneMatchFinalization(match: MatchWithPlayers): Promise<HealMatchFinalizationResult> {
  return (await standaloneFinalizer(match.tournament_id)).healMatchFinalization(match);
}

export async function stageAdminOutcome(matchId: string, outcome: AdminMatchOutcome): Promise<StagedAdminOutcome | null> {
  return finalizer.stageAdminOutcome(matchId, outcome);
}

export async function discardStagedAdminOutcome(matchId: string, staged?: StagedAdminOutcome | null): Promise<void> {
  return finalizer.discardStagedAdminOutcome(matchId, staged);
}

export async function findMatchesNeedingAdmin(matches: readonly MatchWithPlayers[]): Promise<Map<string, NeedsAdminReason>> {
  return finalizer.findMatchesNeedingAdmin(matches);
}
