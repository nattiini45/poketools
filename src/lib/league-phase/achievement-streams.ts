import { supabase } from '@/lib/supabase/client';
import { readAllPages } from '@/lib/supabase/read-all-pages';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchesByRound, getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { checkAchievementsWithStats, computeMatchStats, didPlayerWinTournamentFinal, type MatchContext } from '@/lib/gamification/achievements';
import { isThirdPlaceMatch } from '@/lib/tournament/bracket-structure';
import type { BracketType } from '@/types/tournament';

export interface PhaseAchievementContext {
  match_id: string;
  phase_id: string;
  season_id: string;
  winner_id: string;
  loser_id: string;
  is_draw: boolean;
}

async function phaseFinalWin(playerId: string, phaseId: string, bracketType: BracketType): Promise<boolean> {
  const rounds = await readAllPages<{ id: string; round_number: number }>((from, to) =>
    supabase.from('phase_rounds').select('id, round_number').eq('phase_id', phaseId).order('id').range(from, to));
  if (rounds.length === 0) return false;
  const last = Math.max(...rounds.map((round) => round.round_number));
  for (const round of rounds.filter((row) => row.round_number === last)) {
    const matches = await getPhaseMatchesByRound(round.id);
    if (matches.some((match) => match.status === 'completed' && match.winner_id === playerId && !isThirdPlaceMatch(match, last, last, bracketType))) return true;
  }
  return false;
}

export function checkPhaseAchievements(playerId: string, context: PhaseAchievementContext) {
  return checkCompetitionAchievements(playerId, context);
}

export function checkMixedTournamentAchievements(playerId: string, context: MatchContext) {
  return checkCompetitionAchievements(playerId, context);
}

function checkCompetitionAchievements(playerId: string, context: PhaseAchievementContext | MatchContext) {
  const native = 'phase_id' in context;
  const competitionId = native ? context.phase_id : context.tournament_id;
  const earnedContext = native
    ? { phase_match_id: context.match_id, phase_id: context.phase_id, season_id: context.season_id }
    : { match_id: context.match_id, tournament_id: context.tournament_id, season_id: context.season_id ?? undefined };
  return checkAchievementsWithStats(playerId, earnedContext, async () => {
    const [aggregates, streaks, rating, stats, signatures, match, participants, phases, tournaments] = await Promise.all([
      getAllTimePlayerAggregates(playerId),
      getPlayerStreaks(playerId),
      getPlayerRating(playerId),
      native ? getPhaseBattleStatsByMatch(context.match_id) : getBattleStatsByMatch(context.match_id),
      getPlayerSignatures(playerId),
      native ? getPhaseMatchById(context.match_id) : getMatchById(context.match_id),
      readAllPages<{ player_id: string; seed: number | null }>((from, to) => (native
        ? supabase.from('phase_participants').select('player_id, seed').eq('phase_id', competitionId)
        : supabase.from('tournament_participants').select('player_id, seed').eq('tournament_id', competitionId)).order('player_id').range(from, to)),
      readAllPages<{ phase_id: string; league_phases: { id: string; status: string; created_at: string; bracket_type: string } }>((from, to) => supabase.from('phase_participants').select('phase_id, league_phases!inner(id, status, created_at, bracket_type)').eq('player_id', playerId).order('phase_id').range(from, to)),
      readAllPages<{ tournament_id: string; tournaments: { id: string; status: string; created_at: string; bracket_type: string } }>((from, to) => supabase.from('tournament_participants').select('tournament_id, tournaments!inner(id, status, created_at, bracket_type)').eq('player_id', playerId).is('tournaments.season_id', null).order('tournament_id').range(from, to)),
    ]);
    if (!match || ('phase_id' in match ? match.phase_id : match.tournament_id) !== competitionId) throw new Error('Achievement match owner changed');
    const currentCompetition = native
      ? phases.find((row) => row.phase_id === competitionId)?.league_phases
      : tournaments.find((row) => row.tournament_id === competitionId)?.tournaments;
    const ownSeed = participants.find((row) => row.player_id === playerId)?.seed;
    const otherId = playerId === context.winner_id ? context.loser_id : context.winner_id;
    const otherSeed = participants.find((row) => row.player_id === otherId)?.seed;
    const rounds = await readAllPages<{ id: string; round_number: number }>((from, to) => (native
      ? supabase.from('phase_rounds').select('id, round_number').eq('phase_id', competitionId)
      : supabase.from('rounds').select('id, round_number').eq('tournament_id', competitionId)).order('id').range(from, to));
    const maxRound = rounds.length ? Math.max(...rounds.map((round) => round.round_number)) : -1;
    const tournamentFinalWin = !context.is_draw && playerId === context.winner_id && currentCompetition !== undefined
      && rounds.find((round) => round.id === match.round_id)?.round_number === maxRound
      && !isThirdPlaceMatch(match, maxRound, maxRound, currentCompetition.bracket_type as BracketType);
    const completed = [
      ...phases.map((row) => ({ kind: 'phase' as const, ...row.league_phases })),
      ...tournaments.map((row) => ({ kind: 'tournament' as const, ...row.tournaments })),
    ].filter((row) => row.status === 'completed').sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const index = completed.findIndex((row) => row.kind === (native ? 'phase' : 'tournament') && row.id === competitionId);
    const previous = index < 0 ? undefined : completed[index + 1];
    const backToBackFinalWins = tournamentFinalWin && previous !== undefined && (previous.kind === 'phase'
      ? await phaseFinalWin(playerId, previous.id, previous.bracket_type as BracketType)
      : await didPlayerWinTournamentFinal(playerId, previous.id, previous.bracket_type as BracketType));
    return {
      matchStats: computeMatchStats(stats, playerId),
      cumulativeStats: {
        total_wins: rating?.wins ?? 0,
        total_games: rating ? rating.wins + rating.losses + rating.draws : 0,
        total_kos_dealt: aggregates.reduce((sum, row) => sum + row.total_kos_dealt, 0),
        total_tournaments: phases.length + tournaments.length,
      },
      streaks: { win_streak: streaks?.current_win_streak ?? 0, ko_streak: streaks?.current_ko_streak ?? 0, flawless_streak: streaks?.current_flawless_streak ?? 0 },
      metaStats: { used_unique_pokemon: aggregates.filter((row) => row.total_brought > 0).length, won_with_all_types: 0, won_all_bracket_types: 0, signature_slots: signatures?.signatures.length ?? 0 },
      seedDiff: ownSeed !== undefined && ownSeed !== null && otherSeed !== undefined && otherSeed !== null ? ownSeed - otherSeed : 0,
      rating: { rating: rating?.rating ?? 0, peak_rating: rating?.peak_rating ?? 0 },
      custom: { tournamentFinalWin, backToBackFinalWins },
    };
  });
}
