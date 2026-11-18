import 'server-only';

import { cache } from 'react';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { MatchWithPlayers } from '@/types/match';

export type AdminMatchTarget =
  | { kind: 'tournament'; match: MatchWithPlayers }
  | { kind: 'phase'; match: PhaseMatchWithPlayers; owner: Extract<CompetitionOwner, { kind: 'phase' }> };

export const readNativeAdminMatchOwner = cache((matchId: string) => findNativePhaseAliasOwner({ matchId }));

export async function loadAdminMatchTarget(
  id: string,
  mode: 'legacy' | 'phase',
): Promise<AdminMatchTarget | null> {
  if (mode === 'legacy') {
    const match = await getMatchById(id);
    return match ? { kind: 'tournament', match } : null;
  }

  const matchId = id.toLowerCase();
  const owner = await readNativeAdminMatchOwner(matchId);
  if (owner) {
    const match = await getPhaseMatchById(matchId);
    return match?.id === matchId && match.phase_id === owner.phase_id ? { kind: 'phase', match, owner } : null;
  }

  const match = await getMatchById(matchId);
  return match?.id === matchId && await standaloneMatchAliasExists(matchId, match.tournament_id)
    ? { kind: 'tournament', match }
    : null;
}
