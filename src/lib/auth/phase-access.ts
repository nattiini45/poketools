import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { AuthError, getLiveAccess, requirePlayer } from './helpers';
import { MatchSubmitForbiddenError } from './match-access';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseAdminScopeIds, hasPhaseAdminRole, isPhaseAdminFor } from '@/lib/supabase/queries/phase-admins';
import { isValidUuid } from '@/lib/utils/uuid';
import type { SessionPlayer } from '@/types/auth';
import type { PhaseMatch } from '@/types/league-phase-match';
import type { ResourceAdminGate } from './resource-gate';

type LivePhaseActor = Pick<SessionPlayer, 'playerId' | 'isAdmin'>;

export const getPhaseAwareLiveAccess = cache(async () => {
  const access = await getLiveAccess();
  if (!access?.player || access.isAnyAdmin || access.player.status !== 'active') return access;
  const isAnyAdmin = await hasPhaseAdminRole(access.player.playerId);
  return { ...access, isAnyAdmin };
});

export async function requirePhaseAwareAdmin(): Promise<SessionPlayer> {
  const player = await requirePlayer();
  if (!player.isAdmin && !player.isResourceAdmin && !await hasPhaseAdminRole(player.playerId)) {
    throw new AuthError('Admin access required', 403, 'forbidden');
  }
  return player;
}

export async function canAdministerPhaseAccess(actor: LivePhaseActor, phaseId: string): Promise<boolean> {
  if (actor.isAdmin) return true;
  return isPhaseAdminFor(actor.playerId, phaseId);
}

export async function requirePhaseAdmin(phaseId: string): Promise<SessionPlayer> {
  const player = await requirePlayer();
  if (!isValidUuid(phaseId)) {
    throw new UserFacingError('Phase not found', { status: 404, code: 'INVALID_PHASE_ID' });
  }
  if (!await canAdministerPhaseAccess(player, phaseId)) {
    throw new AuthError('Admin access required for this resource', 403, 'forbidden');
  }
  return player;
}

export async function gatePhaseAdmin(phaseId: string): Promise<ResourceAdminGate> {
  if (!isValidUuid(phaseId)) notFound();
  const access = await getLiveAccess();
  if (!access?.player) return { kind: 'guard' };
  if (!access.isSiteAdmin && access.player.status !== 'active') return { kind: 'guard' };
  const { playerId } = access.player;
  const allowed = await canAdministerPhaseAccess(access.player, phaseId);
  return allowed
    ? { kind: 'ok', playerId, isSiteAdmin: access.isSiteAdmin }
    : { kind: 'forbidden' };
}

export async function assertMayRecordPhaseResult(
  actor: LivePhaseActor,
  match: Pick<PhaseMatch, 'phase_id' | 'player_1_id' | 'player_2_id'>,
): Promise<{ readonly asAdmin: boolean }> {
  if (actor.isAdmin) return { asAdmin: true };
  if (actor.playerId === match.player_1_id || actor.playerId === match.player_2_id) return { asAdmin: false };
  if (!await canAdministerPhaseAccess(actor, match.phase_id)) throw new MatchSubmitForbiddenError();
  return { asAdmin: true };
}

export interface PhaseAdminScope {
  playerId: string;
  isSiteAdmin: boolean;
  seasonIds: string[] | null;
  phaseIds: string[] | null;
}

export async function getPhaseAdminScope(player: SessionPlayer): Promise<PhaseAdminScope> {
  if (player.isAdmin) {
    return { playerId: player.playerId, isSiteAdmin: true, seasonIds: null, phaseIds: null };
  }
  const ids = await getPhaseAdminScopeIds(player.playerId);
  return { playerId: player.playerId, isSiteAdmin: false, ...ids };
}
