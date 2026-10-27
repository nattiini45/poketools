import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resolveTourOverlay } from '@/lib/pkmn/preset-rules.server';
import type { TourOverlayRules } from '@/lib/pkmn/preset-rules';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/pkmn/presets/[id]/tour-overlay
 *
 * Public: no auth required. The documented Smogon tournament extras of a draft preset (clauses to add or drop, moves,
 * items and abilities to ban), resolved to ids. The ruleset editor applies them to an existing document as ordinary,
 * editable entries ("Add Smogon tour bans"); the new-ruleset start applies them on the server. A preset without
 * documented extras, and an id the catalog does not know, answer 404. Static per deploy, so a CDN may cache it.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const overlay = resolveTourOverlay(id);
    if (overlay === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Rule preset not found', code: 'ruleset_preset_unknown' },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResult<TourOverlayRules>>(
      { success: true, data: overlay },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resolve the tour overlay');
  }
}
