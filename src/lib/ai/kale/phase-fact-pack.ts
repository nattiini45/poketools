import 'server-only';
import { loadPhaseRoundScope } from '../phase-context';
import { getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPhaseAiParticipants } from '@/lib/supabase/queries/phase-ai-artifacts';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { decideMatchRosterVisibility } from '@/lib/team/visibility';
import { countByesByPlayer, formatRecord } from '@/lib/tournament/byes';
import { buildMatchFact, buildStandingFacts, buildStandingsChanges, buildPokemonUsage, selectBestPerformer,
  detectUnusualPick, buildMatchData, buildPokemonTypesLookup, fetchMatchDetails } from './fact-pack';
import type { Standing, ByeRecord } from '@/lib/tournament/types';
import type { PhaseMatchWithRoundNumber } from '@/types/league-phase-match';
import type { RecapFactPack, ForecastFactPack } from './types';
import type { PhaseReportType } from '@/types/phase-report';

export interface PhaseReportStandingsInput extends Awaited<ReturnType<typeof loadPhaseRoundScope>> {
  matches: PhaseMatchWithRoundNumber[];
  reportType: PhaseReportType;
  participants: Awaited<ReturnType<typeof getPhaseAiParticipants>>;
  leagueParticipants: Awaited<ReturnType<typeof getPublicSeasonParticipants>>;
}

export type PhaseReportStandings = (input: PhaseReportStandingsInput) => Promise<{
  current: Standing[];
  previous: Standing[] | null;
  currentByes: ByeRecord[];
  previousByes: ByeRecord[];
  scoring: string;
}>;

async function load(phaseId: string, roundId: string, reportType: PhaseReportType, standings: PhaseReportStandings) {
  const scope = await loadPhaseRoundScope(phaseId, roundId);
  const [matches, participants, leagueParticipants] = await Promise.all([
    getMatchesByPhase(phaseId), getPhaseAiParticipants(phaseId), getPublicSeasonParticipants(scope.phase.season_id),
  ]);
  if (matches.some(m => m.phase_id !== phaseId)) throw new Error('Match does not belong to phase');
  if (matches.some(m => m.round_number === undefined)) throw new Error('Native match round number missing');
  const table = await standings({ ...scope, matches, reportType, participants, leagueParticipants });
  const gymTypes = Object.fromEntries(leagueParticipants.map(p => [p.id, p.gym_type]));
  const participantNames = Object.fromEntries(participants.map(p => [p.id, p.name]));
  const avatars = Object.fromEntries(participants.map(p => [p.id, p.avatar_url]));
  const currentStandings = buildStandingFacts(table.current, table.previous, countByesByPlayer(table.currentByes));
  const previousStandings = table.previous ? buildStandingFacts(table.previous, null, countByesByPlayer(table.previousByes)) : null;
  const base = {
    leagueName: scope.season.name, tournamentName: scope.phase.name,
    roundName: scope.round.name, roundNumber: scope.round.round_number,
    format: scope.ruleset.base_format, gen: scope.gen, bestOf: scope.round.best_of,
    scoring: table.scoring, gymTypes, currentStandings, validPlayerNames: participants.map(p => p.name),
  };
  return { scope, matches, base, previousStandings, participantNames, avatars };
}

export async function buildPhaseRecapFactPack(phaseId: string, roundId: string, standings: PhaseReportStandings): Promise<RecapFactPack> {
  const { scope, matches, base, previousStandings, participantNames, avatars } = await load(phaseId, roundId, 'round_recap', standings);
  const details = await fetchMatchDetails(matches.filter(m => m.round_id === roundId), getPhaseBattleStatsByMatch);
  const facts = details.map(d => buildMatchFact(d, scope.gen));
  return { ...base, matches: facts, previousStandings,
    standingsChanges: buildStandingsChanges(base.currentStandings, previousStandings),
    pokemonUsage: buildPokemonUsage(details), bestPerformer: selectBestPerformer(facts),
    unusualPick: detectUnusualPick(details, base.gymTypes, participantNames),
    validPokemonNames: [...new Set(details.flatMap(d => [...d.p1Team, ...d.p2Team].map(p => p.pokemonName)))],
    matchData: buildMatchData(details, avatars), pokemonTypes: buildPokemonTypesLookup(details, scope.gen),
  };
}

export async function buildPhaseForecastFactPack(phaseId: string, roundId: string, standings: PhaseReportStandings): Promise<ForecastFactPack> {
  const { matches, base, scope } = await load(phaseId, roundId, 'round_forecast', standings);
  const matchups = await Promise.all(matches.filter(m => m.round_id === roundId && m.status !== 'completed').map(async m => {
    const completed = matches.filter(r => r.status === 'completed' && r.round_number !== undefined && r.round_number < scope.round.round_number &&
      ((r.player_1_id === m.player_1_id && r.player_2_id === m.player_2_id) ||
       (r.player_1_id === m.player_2_id && r.player_2_id === m.player_1_id)));
    const p1 = base.currentStandings.find(s => s.playerId === m.player_1_id);
    const p2 = base.currentStandings.find(s => s.playerId === m.player_2_id);
    const teams = await Promise.all([m.player_1_id, m.player_2_id].map(async playerId => {
      const team = await getPlayerPhaseTeamForMatch(playerId, m);
      return team && decideMatchRosterVisibility(team, { viewerId: null, isAdmin: false }, m, scope.phase.team_visibility)
        ? team.pokemon.map(p => p.species) : [];
    }));
    return { player1Name: m.player_1_name, player2Name: m.player_2_name,
      player1Rank: p1?.rank ?? null, player2Rank: p2?.rank ?? null,
      headToHead: completed.length ? `${m.player_1_name} ${completed.filter(r => r.winner_id === m.player_1_id).length}-${completed.filter(r => r.winner_id === m.player_2_id).length} ${m.player_2_name}` : 'First meeting',
      player1Team: teams[0], player2Team: teams[1],
      player1Record: p1 ? formatRecord(p1.wins, p1.losses, p1.draws) : 'N/A',
      player2Record: p2 ? formatRecord(p2.wins, p2.losses, p2.draws) : 'N/A',
    };
  }));
  return { ...base, matchups, validPokemonNames: [...new Set(matchups.flatMap(m => [...m.player1Team, ...m.player2Team]))] };
}
