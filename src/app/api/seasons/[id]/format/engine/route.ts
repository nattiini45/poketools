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
 * also after the start: it changes how the next round pairs and how the tables rank. Switching to `kit` also replays the league's finished matches
 * through the format over the next cron runs (events, points, stage ends, auto advance), which can write phase status,
 * enrollment and adjustments; switching away only stops new reactions. The legacy, shadow, kit diff is the safe way in.
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
    // The tables of the league (and the kit standings the public pages read) change with the engine, so the season tag
    // expires as soon as the write was attempted, also on the idempotent retry of a switch whose first call died after the
    // commit, and before any further read that can fail.
    let summary: SeasonFormatSummary | null = before;
    try {
      if (before.engine !== parsed.data.engine) summary = await setSeasonFormatEngine(id, parsed.data.engine);
    } finally {
      expireSeasonReads(id);
    }
    if (summary === null) throw new FormatStudioError('format_nothing_attached');

    if (before.engine !== summary.engine) {
      // The phases' own reads, best effort: the season tag above is already expired.
      const phases = await getKitPhases(id).catch(() => []);
      if (phases.length > 0) {
        expireSeasonReads(
          id,
          phases.map((phase) => phase.id),
        );
      }
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
