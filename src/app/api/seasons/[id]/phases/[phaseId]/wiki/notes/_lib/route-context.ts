import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { AuthError, isSuperadmin, requireAuth } from '@/lib/auth/helpers';
import { CACHE } from '@/lib/api/cache';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { resolveLeaguePhaseRoute } from '@/lib/supabase/queries/phase-route-owners';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import seasonErrors from '@/i18n/messages/errors/seasons/en';

export type WikiPhaseParams = { id: string; phaseId: string };
export type WikiNoteParams = WikiPhaseParams & { noteId: string };
export type WikiReportParams = WikiPhaseParams & { reportId: string };

export { bindScopedPhaseWikiServices } from '@/lib/wiki/native-phase-services';

function phaseNotFound() {
  return new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { code: 'PHASE_NOT_FOUND', status: 404 });
}

export async function resolveWikiPhase(
  { id, phaseId, noteId, reportId }: WikiPhaseParams & { noteId?: string; reportId?: string },
  intent: 'read' | 'write',
  role: 'player' | 'admin' = 'player',
) {
  const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID')
    ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID')
    ?? (noteId === undefined ? null : rejectInvalidPathId(noteId, 'INVALID_NOTE_ID'))
    ?? (reportId === undefined ? null : rejectInvalidPathId(reportId, 'INVALID_WIKI_REPORT_ID'));
  if (invalid) return invalid;

  const session = await requireAuth();
  const player = session.player;
  if (!player) throw new AuthError('Not a registered player', 403, 'forbidden');
  if (role === 'admin' && !player.isAdmin) throw new AuthError('Admin access required', 403, 'forbidden');

  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') throw phaseNotFound();
  if (mode === 'frozen_legacy' || (mode === 'frozen_phase' && intent === 'write')) {
    throw new UserFacingError('League phases are temporarily unavailable during maintenance.', {
      code: 'phase_storage_unavailable',
      status: 503,
    });
  }
  const owner = await resolveLeaguePhaseRoute(id.toLowerCase(), phaseId.toLowerCase(), 'phase');
  if (owner?.kind !== 'phase') throw phaseNotFound();
  return { owner, player, isSuperadmin: isSuperadmin(session) };
}

export function parseWikiInput<T>(schema: ZodType<T>, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);
    throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
  }
  return parsed.data;
}

export async function phaseWikiRateLimit(bucket: 'wiki-notes' | 'wiki-report', playerId: string) {
  const result = await checkRateLimit(bucket, playerId, { limit: 10, windowSeconds: 24 * 60 * 60 });
  return result.allowed ? null : rateLimitedResponse(result.retryAfterSeconds);
}

export function phaseWikiResponse<T>(data: T, status = 200) {
  return NextResponse.json<ApiResult<T>>({ success: true, data }, { status, headers: CACHE.NONE });
}
