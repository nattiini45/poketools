import { NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { requirePlayer } from '@/lib/auth/helpers';
import { canAdministerMatchAccess } from '@/lib/auth/match-access';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { expireSeasonReads, revalidateMatchPages, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import type { ApiResult } from '@/types/api';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { MatchWithPlayers } from '@/types/match';

type PhaseOwner = Extract<CompetitionOwner, { kind: 'phase' }>;
type CorrectionTarget =
  | { kind: 'tournament'; id: string; match: MatchWithPlayers }
  | { kind: 'phase'; id: string; match: PhaseMatchWithPlayers; owner: PhaseOwner };

async function resolveCorrectionTarget(id: string): Promise<CorrectionTarget | null> {
  if (await requireOpenPhaseRouteMode() === 'legacy') {
    const match = await getMatchById(id);
    return match ? { kind: 'tournament', id, match } : null;
  }

  const matchId = id.toLowerCase();
  const owner = await findNativePhaseAliasOwner({ matchId });
  if (owner) {
    const match = await getPhaseMatchById(matchId);
    return match?.id === matchId && match.phase_id === owner.phase_id
      ? { kind: 'phase', id: matchId, match, owner }
      : null;
  }
  const match = await getMatchById(matchId);
  if (match?.id !== matchId || !await standaloneMatchAliasExists(matchId, match.tournament_id)) return null;
  return { kind: 'tournament', id: matchId, match };
}

export async function authorizeCorrectionTarget(params: Promise<{ id: string }>) {
  const player = await requirePlayer();
  const { id } = await params;
  const invalidId = rejectInvalidPathId(id, 'INVALID_MATCH_ID');
  if (invalidId) return { ok: false, response: invalidId } as const;

  const target = await resolveCorrectionTarget(id);
  if (!target) {
    return {
      ok: false,
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' }, { status: 404 }
      ),
    } as const;
  }
  const allowed = target.kind === 'phase'
    ? await canAdministerPhaseAccess(player, target.owner.phase_id)
    : await canAdministerMatchAccess(player, target.match.tournament_id);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' }, { status: 403 }
      ),
    } as const;
  }
  return { ok: true, player, target } as const;
}

export async function nativeCorrectionServices(owner: PhaseOwner) {
  const { createNativePhaseServices } = await import('@/lib/league-phase/services');
  return createNativePhaseServices({
    invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match, phase === owner.phase_id ? owner.season_id : undefined),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: phase => revalidatePhaseMatchPages(phase, undefined, phase === owner.phase_id ? owner.season_id : undefined),
  }).matches;
}

export function revalidateCorrectionTarget(target: CorrectionTarget) {
  return target.kind === 'phase'
    ? revalidatePhaseMatchPages(target.owner.phase_id, target.id, target.owner.season_id)
    : revalidateMatchPages(target.match.tournament_id, target.id);
}

export function correctionAuditTarget(target: CorrectionTarget) {
  return target.kind === 'phase'
    ? { resourceType: 'phase_match', metadata: { phase_id: target.owner.phase_id, season_id: target.owner.season_id } }
    : { resourceType: 'match', metadata: { tournament_id: target.match.tournament_id } };
}
