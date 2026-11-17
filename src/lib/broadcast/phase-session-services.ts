import { requireCreator } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isValidUuid } from '@/lib/utils/uuid';
import { SOLO_PLAYER2_DEFAULT_NAME } from './solo-defaults';
import { loadPhaseCastMatch } from './phase-populate';
import * as storage from '@/lib/supabase/queries/phase-cast-sessions';
import type { PhaseCastSessionInsert, PhaseCastSessionUpdate } from '@/types/phase-cast-session';

export async function requireOwnedPhaseCastSession(id: string) {
  const player = await requireCreator();
  if (!isValidUuid(id)) throw new UserFacingError('Session not found', { code: 'INVALID_SESSION_ID', status: 404 });
  const session = await storage.getPhaseCastSessionById(id);
  if (!session) throw new UserFacingError('Session not found', { code: 'cast_session_not_found', status: 404 });
  if (session.owner_id !== player.playerId && !player.isAdmin) {
    throw new UserFacingError('Not authorized', { code: 'cast_session_forbidden', status: 403 });
  }
  return { player, session };
}

export function createPhaseCastServices() {
  return {
    async list(phaseId?: string) {
      const player = await requireCreator();
      return storage.listPhaseCastSessions(player.playerId, phaseId);
    },
    async create(input: PhaseCastSessionInsert) {
      const player = await requireCreator();
      if (!isValidUuid(input.phase_id)) throw new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
      return storage.createPhaseCastSession(player.playerId, input.mode === 'solo' ? {
        ...input, player1_id: input.player1_id ?? player.playerId,
        player1_name: input.player1_name ?? player.name, player1_avatar_url: input.player1_avatar_url ?? player.avatarUrl,
        player2_id: input.player2_id ?? null, player2_name: input.player2_name ?? SOLO_PLAYER2_DEFAULT_NAME,
        player2_avatar_url: input.player2_avatar_url ?? null,
      } : input);
    },
    async get(id: string) {
      return (await requireOwnedPhaseCastSession(id)).session;
    },
    async update(id: string, input: PhaseCastSessionUpdate) {
      const { player, session } = await requireOwnedPhaseCastSession(id);
      const updated = await storage.updatePhaseCastSession(session, input, session.owner_id === player.playerId ? 'owner' : 'admin');
      if (!updated) throw new UserFacingError('Cast session changed', { code: 'cast_session_changed', status: 409 });
      return updated;
    },
    async delete(id: string) {
      const { session } = await requireOwnedPhaseCastSession(id);
      if (!await storage.deletePhaseCastSession(session)) throw new UserFacingError('Cast session changed', { code: 'cast_session_changed', status: 409 });
    },
    async populate(id: string, matchId: string, phaseId?: string) {
      const { player, session } = await requireOwnedPhaseCastSession(id);
      const target = phaseId ?? session.phase_id;
      if (!isValidUuid(target)) throw new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
      if (!isValidUuid(matchId)) throw new UserFacingError('Match not found', { code: 'INVALID_MATCH_ID', status: 404 });
      return loadPhaseCastMatch(target, matchId, player);
    },
    clearMatchPointer: storage.clearPhaseCastSessionsMatchPointer,
  };
}
