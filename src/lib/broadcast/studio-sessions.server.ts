import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists, standaloneTournamentAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import {
  createCastSession, deleteIndependentCastSession, getIndependentCastSession,
  listIndependentCastSessions, updateIndependentCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import {
  createPhaseCastSession, deletePhaseCastSession, getPhaseCastSessionById,
  listPhaseCastSessions, updatePhaseCastSession,
} from '@/lib/supabase/queries/phase-cast-sessions';
import type {
  CastSessionPhaseRef, StudioCastSession, StudioCastSessionInsert, StudioCastSessionUpdate,
} from '@/types/phase-cast-session';
import { loadPhaseCastMatch } from './phase-populate';

export function castSessionBindingConflict() {
  return new UserFacingError('That match or phase cannot be linked to this session.', {
    code: 'cast_session_binding_conflict', status: 409,
  });
}

function castSessionChanged() {
  return new UserFacingError('Session changed in the meantime', { code: 'cast_session_changed', status: 409 });
}

export async function listStudioCastSessions(ownerId: string): Promise<StudioCastSession[]> {
  const [independent, phase] = await Promise.all([
    listIndependentCastSessions(ownerId), listPhaseCastSessions(ownerId),
  ]);
  return [...independent, ...phase].sort((a, b) =>
    Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id));
}

export async function getStudioCastSession(id: string): Promise<StudioCastSession | null> {
  const phase = await getPhaseCastSessionById(id);
  return phase ?? getIndependentCastSession(id);
}

async function assertPhaseRef({ season_id, phase_id, match_id }: CastSessionPhaseRef) {
  const owner = await findNativePhaseAliasOwner({ phaseId: phase_id, matchId: match_id ?? undefined });
  if (!owner || owner.season_id !== season_id || owner.phase_id !== phase_id) {
    throw match_id
      ? new UserFacingError('Match not found', { code: 'match_not_found', status: 404 })
      : new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
  }
}

async function assertStandaloneBinding(matchId: string | null, tournamentId: string | null) {
  if (matchId) {
    if (!await standaloneMatchAliasExists(matchId, tournamentId ?? undefined)) {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }
  } else if (tournamentId && !await standaloneTournamentAliasExists({ phaseId: tournamentId })) {
    throw new UserFacingError('Tournament not found', { code: 'tournament_not_found', status: 404 });
  }
}

export async function createStudioCastSession(ownerId: string, input: StudioCastSessionInsert): Promise<StudioCastSession> {
  const { phase_ref, match_id, tournament_id, season_id, ...fields } = input;
  if (phase_ref) {
    if (match_id !== undefined || tournament_id !== undefined || season_id !== undefined) throw castSessionBindingConflict();
    await assertPhaseRef(phase_ref);
    return createPhaseCastSession(ownerId, { ...fields, phase_id: phase_ref.phase_id, match_id: phase_ref.match_id }, phase_ref.season_id);
  }
  await assertStandaloneBinding(match_id ?? null, tournament_id ?? null);
  return createCastSession(ownerId, { ...fields, match_id, tournament_id, season_id });
}

export async function updateStudioCastSession(current: StudioCastSession, input: StudioCastSessionUpdate, playerId: string) {
  const { phase_ref, match_id, tournament_id, season_id, ...fields } = input;
  const actor = current.owner_id === playerId ? 'owner' : 'admin';
  const hasLegacyFields = match_id !== undefined || tournament_id !== undefined || season_id !== undefined;

  if ('phase_id' in current) {
    if (hasLegacyFields) throw castSessionBindingConflict();
    if (phase_ref) await assertPhaseRef(phase_ref);
    const result = await updatePhaseCastSession(
      current, { ...fields, phase_id: phase_ref?.phase_id, match_id: phase_ref?.match_id }, actor, phase_ref?.season_id,
    );
    if (!result) throw castSessionChanged();
    return result;
  }

  const target = phase_ref ?? current.phase_ref;
  if (target) {
    if (current.match_id || current.tournament_id || hasLegacyFields
      || (current.season_id !== null && current.season_id !== target.season_id)) {
      throw castSessionBindingConflict();
    }
    if (phase_ref) await assertPhaseRef(phase_ref);
  } else if (match_id !== undefined || tournament_id !== undefined) {
    await assertStandaloneBinding(
      match_id === undefined ? current.match_id : match_id,
      tournament_id === undefined ? current.tournament_id : tournament_id,
    );
  }
  const result = await updateIndependentCastSession(current, { ...fields, match_id, tournament_id, season_id }, phase_ref);
  if (!result) throw castSessionChanged();
  return result;
}

export async function deleteStudioCastSession(current: StudioCastSession) {
  const deleted = 'phase_id' in current ? await deletePhaseCastSession(current) : await deleteIndependentCastSession(current);
  if (!deleted) throw castSessionChanged();
}

export async function populateStudioPhaseMatch(
  current: StudioCastSession,
  ref: CastSessionPhaseRef & { match_id: string },
  actor: { playerId: string; isAdmin: boolean },
) {
  if (!('phase_id' in current) && (current.match_id !== null || current.tournament_id !== null
    || (current.season_id !== null && current.season_id !== ref.season_id))) {
    throw castSessionBindingConflict();
  }
  await assertPhaseRef(ref);
  const result = await loadPhaseCastMatch(ref.phase_id, ref.match_id, actor);
  if (result.match.season_id !== ref.season_id) {
    throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
  }
  return result;
}
