import 'server-only';
import { supabase } from '../client';
import { agentResourceRefsSchema, type AgentResourceRef, type CompetitionRef } from '@/lib/ai/agent/resource-ref';

type Store = 'phase' | 'tournament';
interface ParentRow { id: string; parentId: string }
interface MatchOwner extends ParentRow { roundId: string }
interface CompetitionOwner { id: string; seasonId: string | null }

export interface AgentOwnershipStore {
  games: Map<string, ParentRow>;
  matches: Map<string, MatchOwner>;
  rounds: Map<string, ParentRow>;
  competitions: Map<string, CompetitionOwner>;
}

export interface AgentOwnershipGraph {
  phase: AgentOwnershipStore;
  tournament: AgentOwnershipStore;
  seasons: Set<string>;
}

async function batches<T>(ids: readonly string[], read: (ids: string[]) => PromiseLike<{
  data: T[] | null; error: unknown;
}>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let start = 0; start < unique.length; start += 50) {
    const { data, error } = await read(unique.slice(start, start + 50));
    if (error) throw error;
    if (data === null) throw new Error('Agent ownership read returned no data');
    rows.push(...data);
  }
  return rows;
}

function index<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

async function readStore(store: Store, refs: readonly AgentResourceRef[]): Promise<AgentOwnershipStore> {
  const childIds = (resource: 'game' | 'match' | 'round') => refs.flatMap((ref) =>
    ref.resource === resource && 'id' in ref ? [ref.id] : []);
  const games = await batches(childIds('game'), (ids) => store === 'phase'
    ? supabase.from('phase_games').select('id, match_id').in('id', ids)
    : supabase.from('games').select('id, match_id').in('id', ids));
  const matchIds = [...childIds('match'), ...games.map((row) => row.match_id)];
  const matches = store === 'phase'
    ? (await batches(matchIds, (ids) => supabase.from('phase_matches')
      .select('id, phase_id, round_id').in('id', ids)))
      .map((row) => ({ id: row.id, parentId: row.phase_id, roundId: row.round_id }))
    : (await batches(matchIds, (ids) => supabase.from('matches')
      .select('id, tournament_id, round_id').in('id', ids)))
      .map((row) => ({ id: row.id, parentId: row.tournament_id, roundId: row.round_id }));
  const roundIds = [...childIds('round'), ...matches.map((row) => row.roundId)];
  const rounds = store === 'phase'
    ? (await batches(roundIds, (ids) => supabase.from('phase_rounds')
      .select('id, phase_id').in('id', ids)))
      .map((row) => ({ id: row.id, parentId: row.phase_id }))
    : (await batches(roundIds, (ids) => supabase.from('rounds')
      .select('id, tournament_id').in('id', ids)))
      .map((row) => ({ id: row.id, parentId: row.tournament_id }));
  const competitionIds = [
    ...refs.flatMap((ref) => ref.resource !== 'competition' ? []
      : ref.owner.kind === 'phase' ? [ref.owner.phaseId] : [ref.owner.tournamentId]),
    ...matches.map((row) => row.parentId),
    ...rounds.map((row) => row.parentId),
  ];
  const competitions = await batches(competitionIds, (ids) => store === 'phase'
    ? supabase.from('league_phases').select('id, season_id').in('id', ids)
    : supabase.from('tournaments').select('id, season_id').in('id', ids));
  return {
    games: index(games.map((row) => ({ id: row.id, parentId: row.match_id }))),
    matches: index(matches),
    rounds: index(rounds),
    competitions: index(competitions.map((row) => ({ id: row.id, seasonId: row.season_id }))),
  };
}

export async function getAgentOwnershipGraph(input: readonly AgentResourceRef[]): Promise<AgentOwnershipGraph> {
  const refs = agentResourceRefsSchema.parse(input);
  const [phase, tournament] = await Promise.all([
    readStore('phase', refs.filter((ref) => ref.owner.kind === 'phase')),
    readStore('tournament', refs.filter((ref) => ref.owner.kind === 'tournament')),
  ]);
  const seasons = await batches([...phase.competitions.values()].flatMap((row) =>
    row.seasonId === null ? [] : [row.seasonId]),
  (ids) => supabase.from('seasons').select('id').in('id', ids));
  return { phase, tournament, seasons: new Set(seasons.map((row) => row.id)) };
}

export function getAgentResourceOwner(ref: AgentResourceRef, graph: AgentOwnershipGraph): CompetitionRef | null {
  const store = graph[ref.owner.kind];
  let competitionId: string;
  if (ref.resource === 'competition') {
    competitionId = ref.owner.kind === 'phase' ? ref.owner.phaseId : ref.owner.tournamentId;
  } else if (ref.resource === 'round') {
    const round = store.rounds.get(ref.id);
    if (!round) return null;
    competitionId = round.parentId;
  } else {
    const matchId = ref.resource === 'game' ? store.games.get(ref.id)?.parentId : ref.id;
    if (!matchId) return null;
    const match = store.matches.get(matchId);
    if (!match) return null;
    const round = store.rounds.get(match.roundId);
    if (!round || round.parentId !== match.parentId) return null;
    competitionId = match.parentId;
  }
  const competition = store.competitions.get(competitionId);
  if (!competition) return null;
  if (ref.owner.kind === 'tournament') {
    return competition.seasonId === null ? { kind: 'tournament', tournamentId: competition.id } : null;
  }
  if (competition.seasonId === null || !graph.seasons.has(competition.seasonId)) return null;
  return { kind: 'phase', seasonId: competition.seasonId, phaseId: competition.id };
}
