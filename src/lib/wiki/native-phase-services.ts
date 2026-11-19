import 'server-only';
import { requireAuth, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { expirePhaseReads } from '@/lib/revalidation';
import { findLegacyPhaseAliasOwner, findNativePhaseAliasOwner, standaloneTournamentAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { findNativeWikiNoteOwner, findNativeWikiReportOwner, phaseWikiStorage } from '@/lib/supabase/queries/phase-wiki-notes';
import { getLegacyWikiReportTarget, getNoteById, getNoteReportStatus } from '@/lib/supabase/queries/wiki-notes';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { SessionPlayer } from '@/types/auth';
import { createPhaseWikiServices } from './phase-services';
import commonErrors from '@/i18n/messages/errors/common/en';
import seasonErrors from '@/i18n/messages/errors/seasons/en';
import wikiErrors from '@/i18n/messages/errors/stats/en';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';

type NativeWikiScope = {
  owner: Extract<CompetitionOwner, { kind: 'phase' }>;
  player: Pick<SessionPlayer, 'playerId' | 'name' | 'isAdmin'>;
  isSuperadmin?: boolean;
};

async function assertPhase(phaseId: string): Promise<void> {
  if (!await getPhaseById(phaseId)) {
    throw new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { status: 404, code: 'PHASE_NOT_FOUND' });
  }
}

export function createNativePhaseWikiServices(invalidate: (phaseId: string) => Promise<void>) {
  return createPhaseWikiServices({
    storage: phaseWikiStorage,
    assertPublicPhase: assertPhase,
    invalidate,
    requireActor: async phaseId => {
      const session = await requireAuth();
      if (!session.player) throw new AuthError('Not a registered player', 403, 'forbidden');
      await assertPhase(phaseId);
      return {
        playerId: session.player.playerId,
        isSiteAdmin: session.player.isAdmin,
        isSuperadmin: isSuperadmin(session),
      };
    },
  });
}

export function bindScopedPhaseWikiServices({ owner, player, isSuperadmin = false }: NativeWikiScope, request: Request) {
  async function assertScopedPhase(phaseId: string) {
    if (phaseId !== owner.phase_id) {
      throw new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { code: 'PHASE_NOT_FOUND', status: 404 });
    }
  }
  return createPhaseWikiServices({
    storage: phaseWikiStorage,
    assertPublicPhase: assertScopedPhase,
    requireActor: async phaseId => {
      await assertScopedPhase(phaseId);
      return { playerId: player.playerId, isSiteAdmin: player.isAdmin, isSuperadmin };
    },
    invalidate: async phaseId => expirePhaseReads(phaseId, owner.season_id),
    auditCommit: ({ action, resource, metadata }) => logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action,
      ...resource,
      metadata: { ...metadata, phase_id: owner.phase_id, season_id: owner.season_id },
      ip_address: request.headers.get('x-forwarded-for') ?? undefined,
    }),
  });
}

function frozenWikiWrite(): never {
  throw new UserFacingError(commonErrors.phase_storage_unavailable, { code: 'phase_storage_unavailable', status: 503 });
}

function wikiOwnerConflict(): never {
  throw new UserFacingError(wikiErrors.wiki_note_owner_conflict, { code: 'wiki_note_owner_conflict', status: 409 });
}

async function matchesRetiredWikiScope(scopeType: string, scopeId: string | null, owner: NativeWikiScope['owner']) {
  if (scopeType !== 'tournament' || scopeId !== owner.phase_id) return false;
  const scope = { phaseId: owner.phase_id };
  const [legacyOwner, standalone] = await Promise.all([
    findLegacyPhaseAliasOwner(scope), standaloneTournamentAliasExists(scope),
  ]);
  return !standalone && (!legacyOwner || legacyOwner.season_id === owner.season_id);
}

export async function resolveWikiNoteWrite(id: string) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') return { kind: 'legacy' as const, note: await getNoteById(id) };

  if (mode === 'frozen_legacy') {
    const note = await getNoteById(id);
    if (note?.scope_type === 'tournament' && note.scope_id && await findLegacyPhaseAliasOwner({ phaseId: note.scope_id })) {
      frozenWikiWrite();
    }
    return { kind: 'legacy' as const, note };
  }

  const [owner, note] = await Promise.all([findNativeWikiNoteOwner(id.toLowerCase()), getNoteById(id)]);
  if (owner) {
    if (note && !await matchesRetiredWikiScope(note.scope_type, note.scope_id, owner)) wikiOwnerConflict();
    if (mode === 'frozen_phase') frozenWikiWrite();
    return { kind: 'phase' as const, owner };
  }
  if (note?.scope_type === 'tournament') {
    const scopeId = note.scope_id;
    if (scopeId) {
      if (await findNativePhaseAliasOwner({ phaseId: scopeId }) || await findLegacyPhaseAliasOwner({ phaseId: scopeId })) {
        if (mode === 'frozen_phase') frozenWikiWrite();
        throw new UserFacingError(wikiErrors.wiki_note_not_found, { code: 'wiki_note_not_found', status: 404 });
      }
      if (await standaloneTournamentAliasExists({ phaseId: scopeId })) return { kind: 'legacy' as const, note };
    }
    throw new UserFacingError(wikiErrors.wiki_note_not_found, { code: 'wiki_note_not_found', status: 404 });
  }
  return { kind: 'legacy' as const, note };
}

export async function resolveWikiReportWrite(id: string) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') return { kind: 'legacy' as const, status: await getNoteReportStatus(id) };

  if (mode === 'frozen_legacy') {
    const report = await getLegacyWikiReportTarget(id);
    if (report?.note.scope_type === 'tournament' && report.note.scope_id
      && await findLegacyPhaseAliasOwner({ phaseId: report.note.scope_id })) frozenWikiWrite();
    return { kind: 'legacy' as const, status: report?.status ?? null };
  }

  const [native, report] = await Promise.all([findNativeWikiReportOwner(id.toLowerCase()), getLegacyWikiReportTarget(id)]);
  if (native) {
    if (report && (report.note_id !== native.noteId || report.reporter_id !== native.reporterId
      || !await matchesRetiredWikiScope(report.note.scope_type, report.note.scope_id, native.owner))) {
      throw new UserFacingError(wikiErrors.wiki_report_owner_conflict, { code: 'wiki_report_owner_conflict', status: 409 });
    }
    if (mode === 'frozen_phase') frozenWikiWrite();
    return { kind: 'phase' as const, owner: native.owner };
  }

  if (report?.note.scope_type === 'tournament') {
    const scopeId = report.note.scope_id;
    if (scopeId) {
      const scope = { phaseId: scopeId };
      if (await findNativePhaseAliasOwner(scope) || await findLegacyPhaseAliasOwner(scope)) {
        if (mode === 'frozen_phase') frozenWikiWrite();
        return { kind: 'legacy' as const, status: null };
      }
      if (await standaloneTournamentAliasExists(scope)) return { kind: 'legacy' as const, status: report.status };
    }
    return { kind: 'legacy' as const, status: null };
  }
  return { kind: 'legacy' as const, status: report?.status ?? null };
}

export async function resolveWikiCreateScope(phaseId: string) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') return null;
  const scope = { phaseId: phaseId.toLowerCase() };
  if (mode === 'frozen_legacy') {
    if (await findLegacyPhaseAliasOwner(scope)) frozenWikiWrite();
    return null;
  }

  const [native, legacy, standalone] = await Promise.all([
    findNativePhaseAliasOwner(scope), findLegacyPhaseAliasOwner(scope), standaloneTournamentAliasExists(scope),
  ]);
  if (native && (standalone || (legacy && legacy.season_id !== native.season_id))) wikiOwnerConflict();
  if ((native || legacy) && mode === 'frozen_phase') frozenWikiWrite();
  if (native) return native;
  if (standalone && !legacy) return null;
  if (legacy) throw new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { code: 'PHASE_NOT_FOUND', status: 404 });
  throw new UserFacingError(tournamentErrors.tournament_not_found, { code: 'tournament_not_found', status: 404 });
}
