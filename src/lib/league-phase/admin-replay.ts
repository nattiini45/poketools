import 'server-only';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import type { ReplayGameInput } from '@/lib/pkmn/game-pipeline';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import type { SessionPlayer } from '@/types/auth';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { MatchWithPlayers } from '@/types/match';
import type { PhaseAggregateOwner } from './phase-aggregate-storage';
import { requireOpenPhaseRouteMode } from './route-mode';

type AdminReplayMatch =
  | { kind: 'legacy' | 'standalone'; match: MatchWithPlayers }
  | { kind: 'phase'; match: PhaseMatchWithPlayers; owner: PhaseAggregateOwner };

export async function resolveAdminReplayMatch(matchId: string): Promise<AdminReplayMatch | null> {
  if (await requireOpenPhaseRouteMode() === 'legacy') {
    const match = await getMatchById(matchId);
    return match ? { kind: 'legacy', match } : null;
  }

  const id = matchId.toLowerCase();
  const owner = await findNativePhaseAliasOwner({ matchId: id });
  if (owner) {
    const match = await getPhaseMatchById(id);
    return match?.phase_id === owner.phase_id ? { kind: 'phase', match, owner } : null;
  }
  if (!await standaloneMatchAliasExists(id)) return null;
  const match = await getMatchById(id);
  return match ? { kind: 'standalone', match } : null;
}

export async function canAdministerReplayMatch(player: SessionPlayer, target: AdminReplayMatch): Promise<boolean> {
  return target.kind === 'phase'
    ? canAdministerPhaseAccess(player, target.owner.phase_id)
    : player.isAdmin || await isResourceAdminFor(player.playerId, 'tournament', target.match.tournament_id);
}

export async function recordAdminPhaseReplay(owner: PhaseAggregateOwner, input: ReplayGameInput) {
  const { createNativePhaseServices } = await import('./services');
  const { emitPhaseResultEffects } = await import('./result-effects');
  const { matches } = createNativePhaseServices({
    invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match, phase === owner.phase_id ? owner.season_id : undefined),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: phase => revalidatePhaseMatchPages(phase),
  });
  const result = await matches.recordGameResult(input);
  await emitPhaseResultEffects(owner, input.match_id, result, { replayUrl: input.replay.url });
  return result;
}
