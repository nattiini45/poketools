import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { readBoundedJson } from '@/lib/format-studio/api-body';
import { seasonFormatEngineSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { SeasonFormatSummary } from '@/lib/format-studio/library-types';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getSeasonFormatSummary, setSeasonFormatEngine } from '@/lib/supabase/queries/season-formats';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ENGINE_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

/**
 * PUT /api/seasons/[id]/format/engine
 *
 * League admin (or site admin). Which engine runs the league's attached format: `legacy` (the code from before the
 * format kit), `shadow` (legacy tables, kit computed alongside for the admin diff) or `kit`. Allowed at any time,
 * also after the start: it changes how the next round pairs and how the tables rank, never a stored result.
 * 404 `season_not_found`, 404 `format_nothing_attached` (no format, or not a custom league).
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);

    const rate = await checkRateLimit('format-engine', admin.playerId, ENGINE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = seasonFormatEngineSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const season = await getSeasonById(id);
    if (season === null) throw new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
    if (season.format_type !== 'custom') throw new FormatStudioError('format_nothing_attached');

    const before = await getSeasonFormatSummary(id);
    if (before === null) throw new FormatStudioError('format_nothing_attached');
    const summary = before.engine === parsed.data.engine ? before : await setSeasonFormatEngine(id, parsed.data.engine);
    if (summary === null) throw new FormatStudioError('format_nothing_attached');

    if (before.engine !== summary.engine) {
      const phases = await getKitPhases(id);
      expireSeasonReads(
        id,
        phases.map((phase) => phase.id),
      );
      logAuditEvent({
        action: 'season.format.engine',
        actor_id: admin.playerId,
        actor_name: admin.name,
        resource_type: 'season',
        resource_id: id,
        metadata: { from: before.engine, to: summary.engine },
      });
    }

    return NextResponse.json<ApiResult<{ season_format: SeasonFormatSummary }>>({
      success: true,
      data: { season_format: summary },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to change the format engine');
  }
}
