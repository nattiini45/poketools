import 'server-only';
import { phaseStorageEnvSchema, readEnv } from '@/lib/env';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getMatchById, getH2HBetweenPlayers } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById, getPhaseHeadToHead, getPhaseMatchesByIds } from '@/lib/supabase/queries/phase-matches';
import { standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { MatchWithPlayers } from '@/types/match';

export type BroadcastMatchRead =
  | { kind: 'phase'; match: PhaseMatchWithPlayers; sharedCache: false }
  | { kind: 'legacy'; match: MatchWithPlayers; sharedCache: boolean };

export async function readBroadcastMatch(matchId: string): Promise<BroadcastMatchRead | null> {
  const mode = await getPhaseRouteMode();
  const phaseStorage = mode === 'phase' || mode === 'frozen_phase';
  if (phaseStorage) {
    const match = await getPhaseMatchById(matchId);
    if (match) return { kind: 'phase', match, sharedCache: false };
    if (!await standaloneMatchAliasExists(matchId)) return null;
  }

  const match = await getMatchById(matchId);
  if (!match) return null;

  const sharedCache = mode === 'legacy' && readEnv(phaseStorageEnvSchema).READ_PHASE_STORAGE_STATE !== 'true';
  return { kind: 'legacy', match, sharedCache };
}

export async function readBroadcastMatchMetadata(read: BroadcastMatchRead) {
  const [competition, round] = await (read.kind === 'phase'
    ? Promise.all([getPhaseById(read.match.phase_id), getPhaseRoundById(read.match.round_id, read.match.phase_id)])
    : Promise.all([getTournamentById(read.match.tournament_id), getRoundById(read.match.round_id)]));
  const season = competition?.season_id ? await getSeasonById(competition.season_id) : null;
  return { competition, round, seasonName: season?.name ?? '' };
}

export function readBroadcastHeadToHead(read: BroadcastMatchRead) {
  return read.kind === 'phase'
    ? getPhaseHeadToHead(read.match.phase_id, read.match.player_1_id, read.match.player_2_id)
    : getH2HBetweenPlayers(read.match.player_1_id, read.match.player_2_id, read.match.tournament_id);
}

export async function readBroadcastMatchHistory(read: BroadcastMatchRead) {
  if (read.kind === 'legacy') {
    return getH2HBetweenPlayers(read.match.player_1_id, read.match.player_2_id, read.match.tournament_id);
  }
  const { phase_id, player_1_id, player_2_id } = read.match;
  const meetings = await getPhaseHeadToHead(phase_id, player_1_id, player_2_id);
  if (!meetings.length) return [];
  const matches = await getPhaseMatchesByIds(meetings.map(({ id }) => id));
  return matches.filter((match) => match.phase_id === phase_id && match.status === 'completed' && (
    (match.player_1_id === player_1_id && match.player_2_id === player_2_id) ||
    (match.player_1_id === player_2_id && match.player_2_id === player_1_id)
  ));
}
